import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthStorage } from "../../apps/api/src/services/auth-storage.js";
import { resetResumeScreeningDb } from "../../apps/api/src/services/database.js";
import {
  LiveProviderValidationError,
  parseLiveCasdoorSmokeConfig,
  redactLiveCasdoorConfig,
  runCasdoorWeComClaimsSmoke,
  runLiveCasdoorValidation,
  runOptionalLiveCasdoorSmoke,
  serializeSmokeError,
} from "./casdoor-wecom-claims-smoke.js";

describe("casdoor-wecom-claims-smoke", () => {
  afterEach(() => {
    resetResumeScreeningDb();
  });

  it("proves fixture claims are deny-by-default, preapproved, revoked, and sanitized", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-casdoor-wecom-smoke-"));

    const result = await runCasdoorWeComClaimsSmoke({ projectRoot: root });

    expect(result).toMatchObject({
      success: true,
      mode: "fixture",
      identity: {
        provider: "casdoor",
        identityKey: "casdoor:wecom-corp-001:wecom-user-42",
        providerSubject: "wecom-user-42",
        providerTenant: "wecom-corp-001",
        email: "operator@example.com",
        displayName: "WeCom Operator",
      },
      denyByDefault: {
        workspaceMemberships: [],
      },
      preapproval: {
        workspaceSlug: "hr",
        role: "user",
        active: true,
      },
      grants: {
        afterPreapproval: [
          { workspaceSlug: "hr", role: "user" },
        ],
        afterRevocation: [
          { workspaceSlug: "dev", role: "admin" },
        ],
      },
      redactionsVerified: true,
      optionalLive: {
        status: "skipped_live_provider_smoke",
      },
    });

    const storage = new AuthStorage(root);
    expect(storage.listProviderMembershipGrants({ provider: "casdoor", includeRevoked: true })).toMatchObject([
      {
        provider: "casdoor",
        providerSubject: "wecom-user-42",
        providerTenant: "wecom-corp-001",
        workspaceSlug: "hr",
        active: false,
      },
    ]);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/redacted-access-token|redacted-id-token|redacted-password|access_token|id_token|rawProfile|raw_profile/i);
  });

  it("skips optional live mode when Casdoor smoke environment is incomplete", async () => {
    await expect(runOptionalLiveCasdoorSmoke({ env: {} })).resolves.toEqual({
      enabled: false,
      status: "skipped_live_provider_smoke",
      reason: "LIVE_PROVIDER_SMOKE is not set",
    });
  });

  it("skips live validation when opt-in is absent", () => {
    expect(parseLiveCasdoorSmokeConfig({})).toEqual({
      enabled: false,
      status: "skipped_live_provider_smoke",
      reason: "LIVE_PROVIDER_SMOKE is not set",
    });
  });

  it("skips live validation when opt-in is present but required env vars are missing", () => {
    const config = parseLiveCasdoorSmokeConfig({
      LIVE_PROVIDER_SMOKE: "1",
      CASDOOR_SMOKE_BASE_URL: "https://casdoor.example.test",
    });

    expect(config.enabled).toBe(false);
    expect(config.status).toBe("skipped_live_provider_smoke");
    expect(config.reason).toContain("CASDOOR_SMOKE_CLIENT_ID");
    expect(config.reason).toContain("CASDOOR_SMOKE_CLIENT_SECRET");
    expect(config.reason).toContain("CASDOOR_SMOKE_REDIRECT_URI");
  });

  it("enables live validation only when all required env vars are present", () => {
    expect(parseLiveCasdoorSmokeConfig({
      LIVE_PROVIDER_SMOKE: "1",
      CASDOOR_SMOKE_BASE_URL: "https://casdoor.example.test",
      CASDOOR_SMOKE_CLIENT_ID: "client-id",
      CASDOOR_SMOKE_CLIENT_SECRET: "client-secret",
      CASDOOR_SMOKE_REDIRECT_URI: "https://trends.example.test/api/auth/oidc/callback",
    })).toMatchObject({
      enabled: true,
      baseUrl: "https://casdoor.example.test",
      clientId: "client-id",
      redirectUri: "https://trends.example.test/api/auth/oidc/callback",
    });
  });

  it("redacts live provider secrets from diagnostics", () => {
    const redacted = redactLiveCasdoorConfig({
      enabled: true,
      baseUrl: "https://casdoor.example.test",
      clientId: "client-id",
      clientSecret: "super-secret-value",
      redirectUri: "https://trends.example.test/api/auth/oidc/callback",
    });

    expect(JSON.stringify(redacted)).not.toContain("super-secret-value");
    expect(redacted.clientSecret).toBe("[redacted]");
  });

  it("fails live validation with redacted diagnostics when discovery fails", async () => {
    const fetchMock = vi.fn(async () => new Response("not found", { status: 404 }));

    await expect(runLiveCasdoorValidation(
      {
        enabled: true,
        baseUrl: "https://casdoor.example.test",
        clientId: "client-id",
        clientSecret: "super-secret-value",
        redirectUri: "https://trends.example.test/api/auth/oidc/callback",
      },
      { fetch: fetchMock },
    )).rejects.toMatchObject({
      code: "live_provider_discovery_failed",
      details: {
        config: {
          clientSecret: "[redacted]",
        },
      },
    });

    const calls = JSON.stringify(fetchMock.mock.calls);
    expect(calls).not.toContain("super-secret-value");
  });

  it("returns live discovery metadata when opt-in config is valid", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      issuer: "https://casdoor.example.test",
      authorization_endpoint: "https://casdoor.example.test/login/oauth/authorize",
      token_endpoint: "https://casdoor.example.test/api/login/oauth/access_token",
    }), { status: 200 }));

    await expect(runLiveCasdoorValidation(
      {
        enabled: true,
        baseUrl: "https://casdoor.example.test",
        clientId: "client-id",
        clientSecret: "super-secret-value",
        redirectUri: "https://trends.example.test/api/auth/oidc/callback",
      },
      { fetch: fetchMock },
    )).resolves.toEqual({
      status: "live_provider_discovery_ok",
      issuer: "https://casdoor.example.test",
      authorizationEndpoint: "https://casdoor.example.test/login/oauth/authorize",
      tokenEndpoint: "https://casdoor.example.test/api/login/oauth/access_token",
      redirectUri: "https://trends.example.test/api/auth/oidc/callback",
      clientId: "client-id",
    });
  });

  it("wraps live discovery network failures with redacted diagnostics", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network unavailable");
    });

    await expect(runLiveCasdoorValidation(
      {
        enabled: true,
        baseUrl: "https://casdoor.example.test",
        clientId: "client-id",
        clientSecret: "super-secret-value",
        redirectUri: "https://trends.example.test/api/auth/oidc/callback",
      },
      { fetch: fetchMock },
    )).rejects.toMatchObject({
      code: "live_provider_discovery_failed",
      details: {
        config: {
          clientSecret: "[redacted]",
        },
      },
    });
  });

  it("serializes live validation errors without leaking secrets", () => {
    const serialized = serializeSmokeError(new LiveProviderValidationError(
      "live_provider_discovery_failed",
      "Casdoor discovery failed with HTTP 404",
      {
        config: {
          enabled: true,
          baseUrl: "https://casdoor.example.test",
          clientId: "client-id",
          clientSecret: "super-secret-value",
          redirectUri: "https://trends.example.test/api/auth/oidc/callback",
        },
      },
    ));

    expect(serialized).toMatchObject({
      success: false,
      code: "live_provider_discovery_failed",
      message: "Casdoor discovery failed with HTTP 404",
      details: {
        config: {
          clientSecret: "[redacted]",
        },
      },
    });
    expect(JSON.stringify(serialized)).not.toContain("super-secret-value");
  });
});
