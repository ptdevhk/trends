import { config } from "./config.js";
import { callConvexQuery } from "./convex-utils.js";

/**
 * Unified audit timeline: industry_data_change_log + industry_maintenance_ledger,
 * sorted newest-first, optionally filtered by companyKey.
 */

export type AuditKind = "data_edit" | "maintenance";

export interface AuditTimelineItem {
  kind: AuditKind;
  at: number;
  companyKey?: string;
  summary: string;
  detail?: unknown;
  gitSha?: string | null;
  runId?: string;
  action?: string;
  actor?: string;
  entryId?: string;
  changeId?: string;
}

export interface AuditServiceDeps {
  listChanges: (input: {
    companyKey?: string;
    limit: number;
  }) => Promise<
    Array<{
      changeId: string;
      entryType: string;
      entryId: string;
      action: string;
      actor: string;
      before?: unknown;
      after?: unknown;
      companyKey?: string;
      gitSha?: string | null;
      createdAt: number;
    }>
  >;
  listLedger: (input: {
    companyKey?: string;
    limit: number;
  }) => Promise<
    Array<{
      runId: string;
      proposalId: string;
      companyKey?: string;
      action: string;
      reason: string;
      detail?: unknown;
      _creationTime?: number;
      createdAt?: number;
    }>
  >;
}

function writeSecret(): string {
  return config.auth.convexWriteSecret;
}

async function defaultListLedger(input: {
  companyKey?: string;
  limit: number;
}): Promise<
  Array<{
    runId: string;
    proposalId: string;
    companyKey?: string;
    action: string;
    reason: string;
    detail?: unknown;
    _creationTime?: number;
  }>
> {
  // Ledger has no by_company_key index: pull recent runs, then ledger per run, filter.
  const runs = (await callConvexQuery("companies:listIndustryMaintenanceRuns", {
    writeSecret: writeSecret(),
    limit: 50,
  })) as Array<{ runId: string }>;
  const rows: Array<{
    runId: string;
    proposalId: string;
    companyKey?: string;
    action: string;
    reason: string;
    detail?: unknown;
    _creationTime?: number;
  }> = [];
  for (const run of runs) {
    const ledger = (await callConvexQuery(
      "companies:listIndustryMaintenanceLedger",
      {
        writeSecret: writeSecret(),
        runId: run.runId,
        limit: 200,
      },
    )) as typeof rows;
    for (const row of ledger) {
      if (input.companyKey && row.companyKey !== input.companyKey) continue;
      rows.push(row);
    }
  }
  rows.sort(
    (a, b) => (b._creationTime ?? 0) - (a._creationTime ?? 0),
  );
  return rows.slice(0, input.limit);
}

function defaultDeps(): AuditServiceDeps {
  return {
    listChanges: async ({ companyKey, limit }) =>
      (await callConvexQuery("companies:listIndustryDataChanges", {
        writeSecret: writeSecret(),
        ...(companyKey ? { companyKey } : {}),
        limit,
      })) as Awaited<ReturnType<AuditServiceDeps["listChanges"]>>,
    listLedger: defaultListLedger,
  };
}

export async function listTimeline(
  input: { companyKey?: string; limit?: number } = {},
  deps: AuditServiceDeps = defaultDeps(),
): Promise<AuditTimelineItem[]> {
  const limit = Math.min(200, Math.max(1, Math.floor(input.limit ?? 50)));
  const companyKey = input.companyKey?.trim() || undefined;

  const [changes, ledger] = await Promise.all([
    deps.listChanges({ companyKey, limit }),
    deps.listLedger({ companyKey, limit }),
  ]);

  const items: AuditTimelineItem[] = [];

  for (const c of changes) {
    items.push({
      kind: "data_edit",
      at: c.createdAt,
      companyKey: c.companyKey,
      summary: `${c.action} ${c.entryType}/${c.entryId} by ${c.actor}`,
      detail: { before: c.before, after: c.after },
      gitSha: c.gitSha ?? null,
      action: c.action,
      actor: c.actor,
      entryId: c.entryId,
      changeId: c.changeId,
    });
  }

  for (const l of ledger) {
    items.push({
      kind: "maintenance",
      at: l.createdAt ?? l._creationTime ?? 0,
      companyKey: l.companyKey,
      summary: `${l.action}: ${l.reason}`,
      detail: l.detail,
      runId: l.runId,
      action: l.action,
    });
  }

  items.sort((a, b) => b.at - a.at);
  return items.slice(0, limit);
}
