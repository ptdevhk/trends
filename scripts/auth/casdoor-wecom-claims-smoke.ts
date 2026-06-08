/**
 * Fixture-first smoke for Casdoor/WeCom provider claims and membership gating.
 *
 * Usage:
 *   bunx tsx scripts/auth/casdoor-wecom-claims-smoke.ts
 *   CASDOOR_SMOKE_BASE_URL=https://casdoor.example.com bunx tsx scripts/auth/casdoor-wecom-claims-smoke.ts
 */

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

type SmokeEnv = Record<LiveEnvKey, string | undefined>;
type SmokeMembership = { workspaceSlug: string; role: WorkspaceRole };

type LiveSmokeResult =
  | {
    status: "skipped_live_provider_smoke";
    missingEnv: LiveEnvKey[];
  }
  | {
    status: "live_provider_discovery_ok";
    issuer?: string;
    authorizationEndpoint?: string;
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
  env?: Partial<SmokeEnv>;
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

export async function runOptionalLiveCasdoorSmoke(options: { env?: Partial<SmokeEnv> } = {}): Promise<LiveSmokeResult> {
  const env = options.env ?? process.env;
  const missingEnv = REQUIRED_LIVE_ENV.filter((key) => !env[key]);
  if (missingEnv.length > 0) {
    return {
      status: "skipped_live_provider_smoke",
      missingEnv,
    };
  }

  const baseUrl = readOptionalString(env.CASDOOR_SMOKE_BASE_URL);
  if (!baseUrl) {
    return {
      status: "skipped_live_provider_smoke",
      missingEnv: ["CASDOOR_SMOKE_BASE_URL"],
    };
  }

  const discoveryUrl = new URL("/.well-known/openid-configuration", baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(discoveryUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Casdoor discovery failed with HTTP ${response.status}`);
    }
    const discovery: unknown = await response.json();
    return {
      status: "live_provider_discovery_ok",
      issuer: readDiscoveryField(discovery, "issuer"),
      authorizationEndpoint: readDiscoveryField(discovery, "authorization_endpoint"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runCasdoorWeComClaimsSmoke(
  options: SmokeOptions = {},
): Promise<CasdoorWeComClaimsSmokeResult> {
  const storage = new AuthStorage(options.projectRoot);
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
      console.error(error instanceof Error ? `Error: ${error.message}` : String(error));
      process.exitCode = 1;
    })
    .finally(() => {
      resetResumeScreeningDb();
    });
}
