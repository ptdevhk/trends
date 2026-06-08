import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AuthStorage } from "../../apps/api/src/services/auth-storage.js";
import { resetResumeScreeningDb } from "../../apps/api/src/services/database.js";
import {
  runCasdoorWeComClaimsSmoke,
  runOptionalLiveCasdoorSmoke,
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
      status: "skipped_live_provider_smoke",
      missingEnv: [
        "CASDOOR_SMOKE_BASE_URL",
        "CASDOOR_SMOKE_CLIENT_ID",
        "CASDOOR_SMOKE_CLIENT_SECRET",
        "CASDOOR_SMOKE_REDIRECT_URI",
      ],
    });
  });
});
