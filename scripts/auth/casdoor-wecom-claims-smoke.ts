/**
 * Fixture-first smoke for Casdoor/WeCom provider claims and membership gating.
 *
 * Usage:
 *   bunx tsx scripts/auth/casdoor-wecom-claims-smoke.ts
 *   LIVE_PROVIDER_SMOKE=1 CASDOOR_SMOKE_BASE_URL=https://casdoor.example.com bunx tsx scripts/auth/casdoor-wecom-claims-smoke.ts
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { AuthStorage } from "../../apps/api/src/services/auth-storage.js";
import type { WorkspaceRole } from "../../apps/api/src/services/auth-types.js";
import { resetResumeScreeningDb } from "../../apps/api/src/services/database.js";

const REQUIRED_LIVE_ENV = [
  "CASDOOR_SMOKE_BASE_URL",
  "CASDOOR_SMOKE_CLIENT_ID",
  "CASDOOR_SMOKE_CLIENT_SECRET",
  "CASDOOR_SMOKE_REDIRECT_URI",
] as const;

type LiveEnvKey = typeof REQUIRED_LIVE_ENV[number];

type SmokeEnv = Record<string, string | undefined>;
type SmokeMembership = { workspaceSlug: string; role: WorkspaceRole };
type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;

export type LiveCasdoorSmokeConfig =
  | {
    enabled: false;
    status: "skipped_live_provider_smoke";
    reason: string;
    missingEnv?: LiveEnvKey[];
  }
  | {
    enabled: true;
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };

type LiveSmokeResult =
  | Extract<LiveCasdoorSmokeConfig, { enabled: false }>
  | {
    status: "live_provider_discovery_ok";
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    redirectUri: string;
    clientId: string;
  };

export type CasdoorWeComClaimsSmokeResult = {
  success: true;
  mode: "fixture";
  identity: {
    provider: "casdoor";
    identityKey: string;
    providerSubject: string;
    providerTenant: string;
    email: string;
    displayName: string;
  };
  denyByDefault: {
    workspaceMemberships: SmokeMembership[];
  };
  preapproval: {
    workspaceSlug: string;
    role: WorkspaceRole;
    active: boolean;
  };
  grants: {
    afterPreapproval: SmokeMembership[];
    afterRevocation: SmokeMembership[];
  };
  redactionsVerified: boolean;
  optionalLive: LiveSmokeResult;
};

type SmokeOptions = {
  projectRoot?: string;
  env?: SmokeEnv;
};

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readDiscoveryField(discovery: unknown, key: string): string | undefined {
  if (typeof discovery !== "object" || discovery === null || !(key in discovery)) {
    return undefined;
  }
  return readOptionalString(Object.getOwnPropertyDescriptor(discovery, key)?.value);
}

function assertSanitized(value: unknown): boolean {
  return !/(redacted-access-token|redacted-id-token|redacted-password|access_token|id_token|rawProfile|raw_profile)/i.test(JSON.stringify(value));
}

function buildProviderIdentityKey(identity: { provider: string; providerTenant: string; providerSubject: string }): string {
  return `${identity.provider}:${identity.providerTenant}:${identity.providerSubject}`;
}

function resolveSmokeProjectRoot(projectRoot: string | undefined): string {
  return projectRoot ?? mkdtempSync(path.join(tmpdir(), "trends-casdoor-wecom-smoke-"));
}

export function parseLiveCasdoorSmokeConfig(env: SmokeEnv): LiveCasdoorSmokeConfig {
  if (env.LIVE_PROVIDER_SMOKE !== "1") {
    return {
      enabled: false,
      status: "skipped_live_provider_smoke",
      reason: "LIVE_PROVIDER_SMOKE is not set",
    };
  }

  const missingEnv = REQUIRED_LIVE_ENV.filter((key) => !env[key]);
  if (missingEnv.length > 0) {
    return {
      enabled: false,
      status: "skipped_live_provider_smoke",
      reason: `Missing live provider env vars: ${missingEnv.join(", ")}`,
      missingEnv,
    };
  }

  const baseUrl = readOptionalString(env.CASDOOR_SMOKE_BASE_URL);
  const clientId = readOptionalString(env.CASDOOR_SMOKE_CLIENT_ID);
  const clientSecret = readOptionalString(env.CASDOOR_SMOKE_CLIENT_SECRET);
  const redirectUri = readOptionalString(env.CASDOOR_SMOKE_REDIRECT_URI);
  if (!baseUrl || !clientId || !clientSecret || !redirectUri) {
    const invalidEnv = REQUIRED_LIVE_ENV.filter((key) => !readOptionalString(env[key]));
    return {
      enabled: false,
      status: "skipped_live_provider_smoke",
      reason: `Missing live provider env vars: ${invalidEnv.join(", ")}`,
      missingEnv: invalidEnv,
    };
  }

  return {
    enabled: true,
    baseUrl,
    clientId,
    clientSecret,
    redirectUri,
  };
}

export function redactLiveCasdoorConfig(config: LiveCasdoorSmokeConfig): LiveCasdoorSmokeConfig | (Omit<Extract<LiveCasdoorSmokeConfig, { enabled: true }>, "clientSecret"> & { clientSecret: "[redacted]" }) {
  if (!config.enabled) {
    return config;
  }
  return {
    ...config,
    clientSecret: "[redacted]",
  };
}

export class LiveProviderValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: unknown,
  ) {
    super(message);
    this.name = "LiveProviderValidationError";
  }
}

function isSensitiveDiagnosticKey(key: string): boolean {
  return /secret|password|authorization|access_token|id_token|rawProfile|raw_profile|csrfToken|clientSecret|client_secret/i.test(key);
}

function redactDiagnosticValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticValue(item));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSensitiveDiagnosticKey(key) ? "[redacted]" : redactDiagnosticValue(item),
      ]),
    );
  }
  return value;
}

export function serializeSmokeError(error: unknown): {
  success: false;
  code?: string;
  message: string;
  details?: unknown;
} {
  if (error instanceof LiveProviderValidationError) {
    return {
      success: false,
      code: error.code,
      message: error.message,
      details: redactDiagnosticValue(error.details),
    };
  }
  return {
    success: false,
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function runLiveCasdoorValidation(
  config: Extract<LiveCasdoorSmokeConfig, { enabled: true }>,
  deps: { fetch?: FetchLike } = {},
): Promise<Extract<LiveSmokeResult, { status: "live_provider_discovery_ok" }>> {
  const discoveryUrl = new URL("/.well-known/openid-configuration", config.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const fetchImpl = deps.fetch ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(discoveryUrl, { signal: controller.signal });
    } catch (error) {
      throw new LiveProviderValidationError(
        "live_provider_discovery_failed",
        `Casdoor discovery request failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          baseUrl: config.baseUrl,
          config: redactLiveCasdoorConfig(config),
        },
      );
    }
    if (!response.ok) {
      throw new LiveProviderValidationError(
        "live_provider_discovery_failed",
        `Casdoor discovery failed with HTTP ${response.status}`,
        {
          baseUrl: config.baseUrl,
          status: response.status,
          config: redactLiveCasdoorConfig(config),
        },
      );
    }
    let discovery: unknown;
    try {
      discovery = await response.json();
    } catch (error) {
      throw new LiveProviderValidationError(
        "live_provider_discovery_invalid",
        `Casdoor discovery metadata is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        {
          baseUrl: config.baseUrl,
          config: redactLiveCasdoorConfig(config),
        },
      );
    }
    const issuer = readDiscoveryField(discovery, "issuer");
    const authorizationEndpoint = readDiscoveryField(discovery, "authorization_endpoint");
    const tokenEndpoint = readDiscoveryField(discovery, "token_endpoint");
    if (!issuer || !authorizationEndpoint || !tokenEndpoint) {
      throw new LiveProviderValidationError(
        "live_provider_discovery_invalid",
        "Casdoor discovery metadata is missing required OIDC fields",
        {
          baseUrl: config.baseUrl,
          fields: {
            issuer: typeof issuer,
            authorization_endpoint: typeof authorizationEndpoint,
            token_endpoint: typeof tokenEndpoint,
          },
          config: redactLiveCasdoorConfig(config),
        },
      );
    }
    return {
      status: "live_provider_discovery_ok",
      issuer,
      authorizationEndpoint,
      tokenEndpoint,
      redirectUri: config.redirectUri,
      clientId: config.clientId,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runOptionalLiveCasdoorSmoke(options: { env?: SmokeEnv; fetch?: FetchLike } = {}): Promise<LiveSmokeResult> {
  const config = parseLiveCasdoorSmokeConfig(options.env ?? process.env);
  if (!config.enabled) {
    return config;
  }
  return runLiveCasdoorValidation(config, { fetch: options.fetch });
}

export async function runCasdoorWeComClaimsSmoke(
  options: SmokeOptions = {},
): Promise<CasdoorWeComClaimsSmokeResult> {
  const storage = new AuthStorage(resolveSmokeProjectRoot(options.projectRoot));
  const user = storage.createUser({
    email: "operator@example.com",
    displayName: "WeCom Operator",
  });
  const identity = {
    provider: "casdoor" as const,
    identityKey: "casdoor:wecom-corp-001:wecom-user-42",
    providerSubject: "wecom-user-42",
    providerTenant: "wecom-corp-001",
    email: "operator@example.com",
    displayName: "WeCom Operator",
  };
  if (identity.identityKey !== buildProviderIdentityKey(identity)) {
    throw new Error("provider identity key fixture is inconsistent");
  }

  storage.linkIdentity({
    userId: user.id,
    provider: identity.provider,
    providerSubject: identity.providerSubject,
    providerTenant: identity.providerTenant,
    email: identity.email,
    displayName: identity.displayName,
    rawProfile: {
      sub: identity.providerSubject,
      tenant: identity.providerTenant,
      email: identity.email,
      name: identity.displayName,
      access_token: "redacted-access-token",
      id_token: "redacted-id-token",
      password: "redacted-password",
    },
  });

  const denyByDefaultMemberships = storage.listMemberships(user.id);

  storage.upsertMembership({ userId: user.id, workspaceSlug: "dev", role: "admin" });
  storage.preapproveProviderMembership({
    provider: identity.provider,
    providerSubject: identity.providerSubject,
    providerTenant: identity.providerTenant,
    workspaceSlug: "hr",
    role: "user",
    operatorId: "ops@example.com",
  });

  const preapproval = storage.listProviderMembershipPreapprovals({
    provider: identity.provider,
    workspaceSlug: "hr",
  }).find((record) => (
    record.providerSubject === identity.providerSubject
    && record.providerTenant === identity.providerTenant
  ));
  if (!preapproval) {
    throw new Error("provider membership preapproval was not applied");
  }

  const afterPreapproval = storage.listMemberships(user.id)
    .filter((membership) => membership.workspaceSlug === "hr");

  storage.revokeProviderMembershipPreapproval({
    provider: identity.provider,
    providerSubject: identity.providerSubject,
    providerTenant: identity.providerTenant,
    workspaceSlug: "hr",
    operatorId: "ops@example.com",
  });

  const afterRevocation = storage.listMemberships(user.id);
  const publicSurfaces = {
    identities: storage.listProviderIdentities({ provider: identity.provider }),
    preapprovals: storage.listProviderMembershipPreapprovals({ provider: identity.provider, includeRevoked: true }),
    grants: storage.listProviderMembershipGrants({ provider: identity.provider, includeRevoked: true }),
  };
  const optionalLive = await runOptionalLiveCasdoorSmoke({ env: options.env });
  const result: CasdoorWeComClaimsSmokeResult = {
    success: true,
    mode: "fixture",
    identity,
    denyByDefault: {
      workspaceMemberships: denyByDefaultMemberships.map((membership) => ({
        workspaceSlug: membership.workspaceSlug,
        role: membership.role,
      })),
    },
    preapproval: {
      workspaceSlug: preapproval.workspaceSlug,
      role: preapproval.role,
      active: preapproval.active,
    },
    grants: {
      afterPreapproval: afterPreapproval.map((membership) => ({
        workspaceSlug: membership.workspaceSlug,
        role: membership.role,
      })),
      afterRevocation: afterRevocation.map((membership) => ({
        workspaceSlug: membership.workspaceSlug,
        role: membership.role,
      })),
    },
    redactionsVerified: assertSanitized(publicSurfaces),
    optionalLive,
  };

  if (!result.redactionsVerified || !assertSanitized(result)) {
    throw new Error("provider smoke output exposed sensitive raw provider fields");
  }

  return result;
}

function isCliEntryPoint(): boolean {
  const entryPoint = process.argv[1];
  return Boolean(entryPoint && import.meta.url === pathToFileURL(entryPoint).href);
}

if (isCliEntryPoint()) {
  runCasdoorWeComClaimsSmoke()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error: unknown) => {
      console.error(JSON.stringify(serializeSmokeError(error), null, 2));
      process.exitCode = 1;
    })
    .finally(() => {
      resetResumeScreeningDb();
    });
}
