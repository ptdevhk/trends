/**
 * Operator CLI for provider identity workspace membership preapprovals.
 *
 * Usage:
 *   bunx tsx scripts/auth/manage-provider-membership.ts list-identities --provider casdoor --output json
 *   bunx tsx scripts/auth/manage-provider-membership.ts export-audit --provider casdoor --workspace hr --status all --output json
 *   bunx tsx scripts/auth/manage-provider-membership.ts preapprove --provider casdoor --provider-subject sub-1 --provider-tenant tenant-1 --workspace hr --role user --operator-id ops@example.com --output json
 */

import { pathToFileURL } from "node:url";

import { formatWorkspaceSlugList, isValidWorkspace } from "@trends/shared";

import { AuthEventStorage } from "../../apps/api/src/services/auth-event-storage.js";
import { AuthStorage } from "../../apps/api/src/services/auth-storage.js";
import type { AuthEvent } from "../../apps/api/src/services/auth-event-types.js";
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
type ProviderMembershipAction = "list-identities" | "list-preapprovals" | "export-audit" | "preapprove" | "revoke";
type ProviderAuditStatus = "active" | "revoked" | "all";

type ProviderAuditFilters = {
  provider?: AuthProvider;
  workspaceSlug?: string;
  status: ProviderAuditStatus;
  from?: string;
  to?: string;
};

type ProviderAuditEvent = Pick<AuthEvent, "id" | "type" | "userId" | "provider" | "workspaceSlug" | "sessionId" | "reason" | "createdAt"> & {
  metadata?: Record<string, string | number | boolean | null>;
};

type ProviderAuditPreapprovalRecord = ProviderMembershipPreapprovalRecord & {
  relatedAuthEventIds: string[];
};

type ProviderAuditGrantRecord = ProviderMembershipGrantRecord & {
  relatedAuthEventIds: string[];
};

type ProviderMembershipAuditExport = {
  identities: ProviderIdentityRecord[];
  preapprovals: ProviderAuditPreapprovalRecord[];
  grants: ProviderAuditGrantRecord[];
  events: ProviderAuditEvent[];
};

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
    action: "export-audit";
    provider?: AuthProvider;
    workspaceSlug?: string;
    status: ProviderAuditStatus;
    from?: string;
    to?: string;
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
    action: "export-audit";
    filters: ProviderAuditFilters;
    audit: ProviderMembershipAuditExport;
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
  eventStorage?: AuthEventStorage;
};

function parseAction(value: string | undefined): ProviderMembershipAction {
  if (
    value === "list-identities"
    || value === "list-preapprovals"
    || value === "export-audit"
    || value === "preapprove"
    || value === "revoke"
  ) {
    return value;
  }
  throw new Error("action must be list-identities, list-preapprovals, export-audit, preapprove, or revoke");
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

function parseAuditStatus(value: string | undefined): ProviderAuditStatus {
  if (value === undefined || value === "all") {
    return "all";
  }
  if (value === "active" || value === "revoked") {
    return value;
  }
  throw new Error("--status must be active, revoked, or all");
}

function parseWorkspace(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (isValidWorkspace(value)) {
    return value;
  }
  throw new Error(`--workspace must be one of: ${formatWorkspaceSlugList()}`);
}

function parseIsoFilter(name: string, value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${name} must be a valid date/time`);
  }
  return value;
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
  let status: ProviderAuditStatus = "all";
  let from: string | undefined;
  let to: string | undefined;
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
        workspaceSlug = parseWorkspace(readFlagValue(argv, i, arg));
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
      case "--status":
        status = parseAuditStatus(readFlagValue(argv, i, arg));
        i++;
        break;
      case "--from":
        from = parseIsoFilter(arg, readFlagValue(argv, i, arg));
        i++;
        break;
      case "--to":
        to = parseIsoFilter(arg, readFlagValue(argv, i, arg));
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
  if (action === "export-audit") {
    return {
      action,
      provider,
      workspaceSlug,
      status,
      from,
      to,
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

function toTime(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function hasTimestampInRange(values: Array<string | undefined>, filters: ProviderAuditFilters): boolean {
  const from = toTime(filters.from);
  const to = toTime(filters.to);
  if (from === undefined && to === undefined) {
    return true;
  }
  return values.some((value) => {
    const timestamp = toTime(value);
    if (timestamp === undefined) {
      return false;
    }
    return (from === undefined || timestamp >= from) && (to === undefined || timestamp <= to);
  });
}

function matchesAuditStatus(active: boolean, status: ProviderAuditStatus): boolean {
  return status === "all" || (status === "active" ? active : !active);
}

function providerAuditKey(input: { provider: AuthProvider; providerSubject: string; providerTenant: string | null }): string {
  return `${input.provider}\u0000${input.providerTenant ?? ""}\u0000${input.providerSubject}`;
}

function isSensitiveMetadataKey(key: string): boolean {
  return /secret|password|authorization|access_token|id_token|rawProfile|raw_profile|token|clientSecret|client_secret/i.test(key);
}

function redactMetadata(metadata: AuthEvent["metadata"]): ProviderAuditEvent["metadata"] {
  if (!metadata) {
    return undefined;
  }
  const entries = Object.entries(metadata).filter(([key]) => !isSensitiveMetadataKey(key));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function eventMatchesProviderRecord(
  event: AuthEvent,
  record: { provider: AuthProvider; providerSubject: string; providerTenant: string; workspaceSlug: string },
): boolean {
  const metadata = event.metadata;
  return (
    event.provider === record.provider
    && event.workspaceSlug === record.workspaceSlug
    && metadata?.providerSubject === record.providerSubject
    && metadata?.providerTenant === record.providerTenant
  );
}

function eventMatchesAuditFilters(event: AuthEvent, filters: ProviderAuditFilters): boolean {
  return (
    (!filters.provider || event.provider === filters.provider)
    && (!filters.workspaceSlug || event.workspaceSlug === filters.workspaceSlug)
    && hasTimestampInRange([event.createdAt], filters)
  );
}

function toAuditFilters(command: Extract<ProviderMembershipCommand, { action: "export-audit" }>): ProviderAuditFilters {
  return {
    provider: command.provider,
    workspaceSlug: command.workspaceSlug,
    status: command.status,
    from: command.from,
    to: command.to,
  };
}

function toAuditEvent(event: AuthEvent): ProviderAuditEvent {
  return {
    id: event.id,
    type: event.type,
    userId: event.userId,
    provider: event.provider,
    workspaceSlug: event.workspaceSlug,
    sessionId: event.sessionId,
    reason: event.reason,
    metadata: redactMetadata(event.metadata),
    createdAt: event.createdAt,
  };
}

function buildProviderMembershipAuditExport(
  command: Extract<ProviderMembershipCommand, { action: "export-audit" }>,
  options: ExecuteOptions,
): ProviderMembershipAuditExport {
  const storage = options.storage ?? new AuthStorage(options.projectRoot);
  const eventStorage = options.eventStorage ?? new AuthEventStorage(options.projectRoot);
  const filters = toAuditFilters(command);

  const events = eventStorage.listRecent({ limit: 1_000 })
    .filter((event) => eventMatchesAuditFilters(event, filters));

  const preapprovals = storage.listProviderMembershipPreapprovals({
    provider: command.provider,
    workspaceSlug: command.workspaceSlug,
    includeRevoked: true,
  }).filter((record) => (
    matchesAuditStatus(record.active, command.status)
    && hasTimestampInRange([record.createdAt, record.updatedAt, record.revokedAt], filters)
  ));

  const grants = storage.listProviderMembershipGrants({
    provider: command.provider,
    workspaceSlug: command.workspaceSlug,
    includeRevoked: true,
  }).filter((record) => (
    matchesAuditStatus(record.active, command.status)
    && hasTimestampInRange([record.grantedAt, record.revokedAt], filters)
  ));

  const selectedKeys = new Set([
    ...preapprovals.map(providerAuditKey),
    ...grants.map(providerAuditKey),
  ]);
  const shouldScopeIdentitiesToSelectedRecords = Boolean(command.workspaceSlug) || command.status !== "all";
  const identities = storage.listProviderIdentities({ provider: command.provider })
    .filter((identity) => hasTimestampInRange([identity.updatedAt], filters))
    .filter((identity) => !shouldScopeIdentitiesToSelectedRecords || selectedKeys.has(providerAuditKey(identity)));

  const relatedEventIds = (record: {
    provider: AuthProvider;
    providerSubject: string;
    providerTenant: string;
    workspaceSlug: string;
  }) => events
    .filter((event) => eventMatchesProviderRecord(event, record))
    .map((event) => event.id);

  const preapprovalsWithEvents = preapprovals.map((record) => ({
    ...record,
    relatedAuthEventIds: relatedEventIds(record),
  }));
  const grantsWithEvents = grants.map((record) => ({
    ...record,
    relatedAuthEventIds: relatedEventIds(record),
  }));
  const selectedEventIds = new Set([
    ...preapprovalsWithEvents.flatMap((record) => record.relatedAuthEventIds),
    ...grantsWithEvents.flatMap((record) => record.relatedAuthEventIds),
  ]);

  return {
    identities,
    preapprovals: preapprovalsWithEvents,
    grants: grantsWithEvents,
    events: events.filter((event) => selectedEventIds.has(event.id)).map(toAuditEvent),
  };
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

  if (command.action === "export-audit") {
    const audit = buildProviderMembershipAuditExport(command, options);
    return {
      success: true,
      action: command.action,
      filters: toAuditFilters(command),
      audit,
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
  if (result.action === "export-audit") {
    return `provider audit export: ${result.audit.preapprovals.length} preapprovals, ${result.audit.grants.length} grants, ${result.audit.events.length} events`;
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
