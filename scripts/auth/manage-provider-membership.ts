/**
 * Operator CLI for provider identity workspace membership preapprovals.
 *
 * Usage:
 *   bunx tsx scripts/auth/manage-provider-membership.ts list-identities --provider casdoor --output json
 *   bunx tsx scripts/auth/manage-provider-membership.ts preapprove --provider casdoor --provider-subject sub-1 --provider-tenant tenant-1 --workspace hr --role user --operator-id ops@example.com --output json
 */

import { pathToFileURL } from "node:url";

import { AuthStorage } from "../../apps/api/src/services/auth-storage.js";
import type {
  AuthProvider,
  WorkspaceMembership,
  WorkspaceRole,
} from "../../apps/api/src/services/auth-types.js";
import { resetResumeScreeningDb } from "../../apps/api/src/services/database.js";
import type {
  ProviderIdentityRecord,
  ProviderMembershipPreapprovalRecord,
} from "../../apps/api/src/services/auth-storage.js";

type OutputMode = "json" | "agent";
type ProviderMembershipAction = "list-identities" | "list-preapprovals" | "preapprove" | "revoke";

export type ProviderMembershipCommand =
  | {
    action: "list-identities";
    provider: AuthProvider;
    output: OutputMode;
    dryRun: false;
  }
  | {
    action: "list-preapprovals";
    provider: AuthProvider;
    workspaceSlug?: string;
    output: OutputMode;
    dryRun: false;
  }
  | {
    action: "preapprove";
    provider: AuthProvider;
    providerSubject: string;
    providerTenant: string;
    workspaceSlug: string;
    role: WorkspaceRole;
    operatorId: string;
    output: OutputMode;
    dryRun: boolean;
  }
  | {
    action: "revoke";
    provider: AuthProvider;
    providerSubject: string;
    providerTenant: string;
    workspaceSlug: string;
    operatorId: string;
    output: OutputMode;
    dryRun: boolean;
  };

export type ProviderMembershipCommandResult =
  | {
    success: true;
    action: "list-identities";
    identities: ProviderIdentityRecord[];
  }
  | {
    success: true;
    action: "list-preapprovals";
    preapprovals: ProviderMembershipPreapprovalRecord[];
  }
  | {
    success: true;
    dryRun: true;
    action: "preapprove";
    provider: AuthProvider;
    providerSubject: string;
    providerTenant: string;
    workspaceSlug: string;
    role: WorkspaceRole;
    operatorId: string;
  }
  | {
    success: true;
    dryRun: true;
    action: "revoke";
    provider: AuthProvider;
    providerSubject: string;
    providerTenant: string;
    workspaceSlug: string;
    operatorId: string;
  }
  | {
    success: true;
    action: "preapprove";
    preapproval: ProviderMembershipPreapprovalRecord;
    appliedMemberships: WorkspaceMembership[];
  }
  | {
    success: true;
    action: "revoke";
    revoked: ProviderMembershipPreapprovalRecord;
  };

type ExecuteOptions = {
  projectRoot?: string;
  storage?: AuthStorage;
};

function parseAction(value: string | undefined): ProviderMembershipAction {
  if (
    value === "list-identities"
    || value === "list-preapprovals"
    || value === "preapprove"
    || value === "revoke"
  ) {
    return value;
  }
  throw new Error("action must be list-identities, list-preapprovals, preapprove, or revoke");
}

function parseProvider(value: string | undefined): AuthProvider {
  if (value === "local" || value === "casdoor") {
    return value;
  }
  throw new Error("--provider must be local or casdoor");
}

function parseRole(value: string | undefined): WorkspaceRole {
  if (value === "user" || value === "admin") {
    return value;
  }
  throw new Error("--role must be user or admin");
}

function parseOutput(value: string | undefined): OutputMode {
  if (value === undefined || value === "json") {
    return "json";
  }
  if (value === "agent") {
    return "agent";
  }
  throw new Error("--output must be json or agent");
}

function requireFlag(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseProviderMembershipArgs(argv: string[]): ProviderMembershipCommand {
  const action = parseAction(argv[0]);
  let provider: AuthProvider | undefined;
  let providerSubject: string | undefined;
  let providerTenant: string | undefined;
  let workspaceSlug: string | undefined;
  let role: WorkspaceRole | undefined;
  let operatorId: string | undefined;
  let output: OutputMode = "json";
  let dryRun = false;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--provider":
        provider = parseProvider(readFlagValue(argv, i, arg));
        i++;
        break;
      case "--provider-subject":
        providerSubject = readFlagValue(argv, i, arg);
        i++;
        break;
      case "--provider-tenant":
        providerTenant = readFlagValue(argv, i, arg);
        i++;
        break;
      case "--workspace":
        workspaceSlug = readFlagValue(argv, i, arg);
        i++;
        break;
      case "--role":
        role = parseRole(readFlagValue(argv, i, arg));
        i++;
        break;
      case "--operator-id":
        operatorId = readFlagValue(argv, i, arg);
        i++;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--output":
        output = parseOutput(readFlagValue(argv, i, arg));
        i++;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const requiredProvider = provider ?? parseProvider(undefined);
  if (action === "list-identities") {
    return {
      action,
      provider: requiredProvider,
      output,
      dryRun: false,
    };
  }
  if (action === "list-preapprovals") {
    return {
      action,
      provider: requiredProvider,
      workspaceSlug,
      output,
      dryRun: false,
    };
  }
  if (action === "preapprove") {
    return {
      action,
      provider: requiredProvider,
      providerSubject: requireFlag("--provider-subject", providerSubject),
      providerTenant: requireFlag("--provider-tenant", providerTenant),
      workspaceSlug: requireFlag("--workspace", workspaceSlug),
      role: role ?? parseRole(undefined),
      operatorId: requireFlag("--operator-id", operatorId),
      output,
      dryRun,
    };
  }

  return {
    action,
    provider: requiredProvider,
    providerSubject: requireFlag("--provider-subject", providerSubject),
    providerTenant: requireFlag("--provider-tenant", providerTenant),
    workspaceSlug: requireFlag("--workspace", workspaceSlug),
    operatorId: requireFlag("--operator-id", operatorId),
    output,
    dryRun,
  };
}

function findPreapproval(
  storage: AuthStorage,
  command: Extract<ProviderMembershipCommand, { action: "preapprove" | "revoke" }>,
): ProviderMembershipPreapprovalRecord {
  const preapproval = storage.listProviderMembershipPreapprovals({
    provider: command.provider,
    workspaceSlug: command.workspaceSlug,
    includeRevoked: true,
  }).find((record) => (
    record.providerSubject === command.providerSubject
    && record.providerTenant === command.providerTenant
  ));

  if (!preapproval) {
    throw new Error("provider membership preapproval was not found after operation");
  }
  return preapproval;
}

function listAppliedMemberships(
  storage: AuthStorage,
  command: Extract<ProviderMembershipCommand, { action: "preapprove" }>,
): WorkspaceMembership[] {
  const identity = storage.findIdentity(
    command.provider,
    command.providerSubject,
    command.providerTenant,
  );
  if (!identity) {
    return [];
  }
  return storage.listMemberships(identity.userId).filter(
    (membership) => membership.workspaceSlug === command.workspaceSlug,
  );
}

export function executeProviderMembershipCommand(
  command: ProviderMembershipCommand,
  options: ExecuteOptions = {},
): ProviderMembershipCommandResult {
  if (command.action === "preapprove" && command.dryRun) {
    return {
      success: true,
      dryRun: true,
      action: command.action,
      provider: command.provider,
      providerSubject: command.providerSubject,
      providerTenant: command.providerTenant,
      workspaceSlug: command.workspaceSlug,
      role: command.role,
      operatorId: command.operatorId,
    };
  }
  if (command.action === "revoke" && command.dryRun) {
    return {
      success: true,
      dryRun: true,
      action: command.action,
      provider: command.provider,
      providerSubject: command.providerSubject,
      providerTenant: command.providerTenant,
      workspaceSlug: command.workspaceSlug,
      operatorId: command.operatorId,
    };
  }

  const storage = options.storage ?? new AuthStorage(options.projectRoot);

  if (command.action === "list-identities") {
    return {
      success: true,
      action: command.action,
      identities: storage.listProviderIdentities({ provider: command.provider }),
    };
  }

  if (command.action === "list-preapprovals") {
    return {
      success: true,
      action: command.action,
      preapprovals: storage.listProviderMembershipPreapprovals({
        provider: command.provider,
        workspaceSlug: command.workspaceSlug,
      }),
    };
  }

  if (command.action === "preapprove") {
    storage.preapproveProviderMembership({
      provider: command.provider,
      providerSubject: command.providerSubject,
      providerTenant: command.providerTenant,
      workspaceSlug: command.workspaceSlug,
      role: command.role,
      operatorId: command.operatorId,
    });

    return {
      success: true,
      action: command.action,
      preapproval: findPreapproval(storage, command),
      appliedMemberships: listAppliedMemberships(storage, command),
    };
  }

  storage.revokeProviderMembershipPreapproval({
    provider: command.provider,
    providerSubject: command.providerSubject,
    providerTenant: command.providerTenant,
    workspaceSlug: command.workspaceSlug,
    operatorId: command.operatorId,
  });

  return {
    success: true,
    action: command.action,
    revoked: findPreapproval(storage, command),
  };
}

function formatAgentResult(result: ProviderMembershipCommandResult): string {
  if (result.action === "list-identities") {
    return `provider identities: ${result.identities.length}`;
  }
  if (result.action === "list-preapprovals") {
    return `provider preapprovals: ${result.preapprovals.length}`;
  }
  if (result.action === "preapprove" && "dryRun" in result) {
    return `dry run: preapprove ${result.provider}:${result.providerSubject} for ${result.workspaceSlug} as ${result.role}`;
  }
  if (result.action === "revoke" && "dryRun" in result) {
    return `dry run: revoke ${result.provider}:${result.providerSubject} from ${result.workspaceSlug}`;
  }
  if (result.action === "preapprove") {
    return `preapproved ${result.preapproval.provider}:${result.preapproval.providerSubject} for ${result.preapproval.workspaceSlug} as ${result.preapproval.role}`;
  }
  return `revoked ${result.revoked.provider}:${result.revoked.providerSubject} from ${result.revoked.workspaceSlug}`;
}

function printResult(result: ProviderMembershipCommandResult, output: OutputMode): void {
  if (output === "agent") {
    console.log(formatAgentResult(result));
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

function isCliEntryPoint(): boolean {
  const entryPoint = process.argv[1];
  return Boolean(entryPoint && import.meta.url === pathToFileURL(entryPoint).href);
}

async function main(): Promise<void> {
  const command = parseProviderMembershipArgs(process.argv.slice(2));
  const result = executeProviderMembershipCommand(command);
  printResult(result, command.output);
}

if (isCliEntryPoint()) {
  main()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? `Error: ${error.message}` : String(error));
      process.exitCode = 1;
    })
    .finally(() => {
      resetResumeScreeningDb();
    });
}
