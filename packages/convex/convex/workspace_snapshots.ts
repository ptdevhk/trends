import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";

/**
 * Workspace portability snapshots (P2–P4).
 *
 * Envelope: JSON, schemaVersion 1, profile `hr-ops` (candidate_status +
 * candidate_blocks) or `full` (+ search_profiles, workspace_config).
 * Secrets are never exported; secret-like config keys are refused on import.
 * The resume corpus stays with the existing resume backup and is never part
 * of a snapshot.
 */

export const SNAPSHOT_SCHEMA_VERSION = 1 as const;

const CANDIDATE_STATUS_VALUES = [
  "new",
  "shortlisted",
  "rejected",
  "contacted",
  "interviewing",
  "interviewed_pass",
  "interviewed_reject",
  "appeal_submitted",
  "human_review",
  "upheld",
  "reversed",
  "offer",
  "hired",
  "withdrawn",
] as const;

const SECRET_KEY_PATTERN = /(secret|token|password|apikey|api_key|credential)/i;

export function isSecretConfigKey(configKey: string): boolean {
  return SECRET_KEY_PATTERN.test(configKey);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type ValidatedRow = {
  fields: Record<string, unknown>;
};

function validateCandidateStatusRow(row: unknown, workspaceSlug: string): ValidatedRow {
  if (!isRecord(row)) {
    throw new Error("candidate_status row must be an object");
  }
  const identityKey = readString(row.identityKey);
  if (!identityKey) {
    throw new Error("candidate_status row missing non-empty identityKey");
  }
  const status = readString(row.status);
  if (!status || !(CANDIDATE_STATUS_VALUES as readonly string[]).includes(status)) {
    throw new Error(`candidate_status row has invalid status: ${String(row.status)}`);
  }
  const updatedAt = readNumber(row.updatedAt);
  if (updatedAt === null) {
    throw new Error("candidate_status row missing numeric updatedAt");
  }
  const fields: Record<string, unknown> = {
    identityKey,
    workspaceSlug,
    status,
    updatedAt,
  };
  if (readString(row.notes) !== null) fields.notes = row.notes;
  if (readString(row.updatedBy) !== null) fields.updatedBy = row.updatedBy;
  if (Array.isArray(row.history)) {
    fields.history = row.history.filter(isRecord).map((entry) => {
      const entryStatus = readString(entry.status);
      const entryUpdatedAt = readNumber(entry.updatedAt);
      if (!entryStatus || entryUpdatedAt === null) {
        throw new Error("candidate_status history entry missing status/updatedAt");
      }
      const out: Record<string, unknown> = { status: entryStatus, updatedAt: entryUpdatedAt };
      if (readString(entry.notes) !== null) out.notes = entry.notes;
      return out;
    });
  }
  return { fields };
}

function validateCandidateBlockRow(row: unknown, workspaceSlug: string): ValidatedRow {
  if (!isRecord(row)) {
    throw new Error("candidate_blocks row must be an object");
  }
  const identityKey = readString(row.identityKey);
  if (!identityKey) {
    throw new Error("candidate_blocks row missing non-empty identityKey");
  }
  const blockedAt = readNumber(row.blockedAt);
  if (blockedAt === null) {
    throw new Error("candidate_blocks row missing numeric blockedAt");
  }
  const fields: Record<string, unknown> = {
    identityKey,
    workspaceSlug,
    blockedAt,
  };
  if (readString(row.reason) !== null) fields.reason = row.reason;
  if (readString(row.blockedBy) !== null) fields.blockedBy = row.blockedBy;
  return { fields };
}

function validateSearchProfileRow(row: unknown, workspaceSlug: string): ValidatedRow {
  if (!isRecord(row)) {
    throw new Error("search_profiles row must be an object");
  }
  const name = readString(row.name);
  if (!name) {
    throw new Error("search_profiles row missing non-empty name");
  }
  const fields: Record<string, unknown> = {
    name,
    workspaceSlug,
  };
  if (readString(row.profileId) !== null) fields.profileId = row.profileId;
  if (isRecord(row.criteria)) {
    const keywords = Array.isArray(row.criteria.keywords)
      ? row.criteria.keywords.filter((k): k is string => typeof k === "string")
      : [];
    const locations = Array.isArray(row.criteria.locations)
      ? row.criteria.locations.filter((l): l is string => typeof l === "string")
      : [];
    fields.criteria = { keywords, locations };
  }
  if (readNumber(row.lastRunAt) !== null) fields.lastRunAt = row.lastRunAt;
  if (readNumber(row.createdAt) !== null) fields.createdAt = row.createdAt;
  if (readNumber(row.updatedAt) !== null) fields.updatedAt = row.updatedAt;
  if (readString(row.templateHash) !== null) fields.templateHash = row.templateHash;
  if (row.profile !== undefined) fields.profile = row.profile;
  return { fields };
}

function validateWorkspaceConfigRow(row: unknown, workspaceSlug: string): ValidatedRow {
  if (!isRecord(row)) {
    throw new Error("workspace_config row must be an object");
  }
  const configKey = readString(row.configKey);
  if (!configKey) {
    throw new Error("workspace_config row missing non-empty configKey");
  }
  if (isSecretConfigKey(configKey)) {
    throw new Error(`workspace_config import refused: secret-like configKey "${configKey}"`);
  }
  const updatedAt = readNumber(row.updatedAt);
  if (updatedAt === null) {
    throw new Error("workspace_config row missing numeric updatedAt");
  }
  const fields: Record<string, unknown> = {
    workspaceSlug,
    configKey,
    configValue: row.configValue ?? null,
    updatedAt,
  };
  return { fields };
}

type SnapshotTableName = "candidate_status" | "candidate_blocks" | "search_profiles" | "workspace_config";
type SnapshotIndexName = "by_workspace_identity" | "by_workspace" | "by_workspace_key";

type EqBuilder = { eq: (field: string, value: string) => EqBuilder };

/** Minimal db shape for dynamic table/index names; Convex's static typing
 * only exposes indexes common to a table-name union. */
type DynamicDb = {
  query: (table: string) => {
    withIndex: (
      index: string,
      q: (builder: EqBuilder) => unknown,
    ) => {
      collect: () => Promise<unknown[]>;
    };
  };
  delete: (id: unknown) => Promise<void>;
};

type TableGroup = "candidateStatus" | "candidateBlocks" | "searchProfiles" | "workspaceConfig";

type SnapshotTableMeta = {
  table: SnapshotTableName;
  index: SnapshotIndexName;
  key: TableGroup;
  /** Natural key used for merge: rows conflict when (workspaceSlug, keyField) match. */
  keyField: "identityKey" | "name" | "configKey";
};

const TABLE_META: Record<TableGroup, SnapshotTableMeta> = {
  candidateStatus: { table: "candidate_status", index: "by_workspace_identity", key: "candidateStatus", keyField: "identityKey" },
  candidateBlocks: { table: "candidate_blocks", index: "by_workspace_identity", key: "candidateBlocks", keyField: "identityKey" },
  searchProfiles: { table: "search_profiles", index: "by_workspace", key: "searchProfiles", keyField: "name" },
  workspaceConfig: { table: "workspace_config", index: "by_workspace", key: "workspaceConfig", keyField: "configKey" },
};

async function collectWorkspaceRows(
  ctx: QueryCtx,
  tableName: SnapshotTableName,
  indexName: SnapshotIndexName,
  workspaceSlug: string,
): Promise<Record<string, unknown>[]> {
  const db = ctx.db as unknown as DynamicDb;
  const rows = await db
    .query(tableName)
    .withIndex(indexName, (q) => q.eq("workspaceSlug", workspaceSlug))
    .collect();
  return rows.map((row) => {
    const { _creationTime, ...rest } = row as Record<string, unknown> & { _creationTime: unknown };
    void _creationTime;
    return rest;
  });
}

async function deleteAllForWorkspace(
  ctx: MutationCtx,
  tableName: SnapshotTableName,
  indexName: SnapshotIndexName,
  workspaceSlug: string,
): Promise<number> {
  const db = ctx.db as unknown as DynamicDb;
  const rows = await db
    .query(tableName)
    .withIndex(indexName, (q) => q.eq("workspaceSlug", workspaceSlug))
    .collect();
  for (const row of rows) {
    await db.delete((row as { _id: unknown })._id);
  }
  return rows.length;
}

/** Look up an existing row by natural key (workspaceSlug + keyField) so merge
 * is idempotent across re-imports and across workspaces — real Convex ids
 * cannot be used for matching because they are not portable between
 * environments. Returns the first match (index order) or null. */
async function findExistingByNaturalKey(
  ctx: MutationCtx,
  meta: SnapshotTableMeta,
  workspaceSlug: string,
  fields: Record<string, unknown>,
): Promise<{ _id: unknown } | null> {
  const keyValue = fields[meta.keyField];
  if (typeof keyValue !== "string") {
    return null;
  }
  const db = ctx.db as unknown as DynamicDb;
  if (meta.keyField === "configKey") {
    const rows = await db
      .query(meta.table)
      .withIndex("by_workspace_key", (q) => q.eq("workspaceSlug", workspaceSlug).eq("configKey", keyValue))
      .collect();
    return (rows[0] as { _id: unknown } | undefined) ?? null;
  }
  if (meta.keyField === "identityKey") {
    const rows = await db
      .query(meta.table)
      .withIndex("by_workspace_identity", (q) => q.eq("workspaceSlug", workspaceSlug).eq("identityKey", keyValue))
      .collect();
    return (rows[0] as { _id: unknown } | undefined) ?? null;
  }
  // search_profiles has no composite index on (workspaceSlug, name).
  const rows = await db
    .query(meta.table)
    .withIndex("by_workspace", (q) => q.eq("workspaceSlug", workspaceSlug))
    .collect();
  const match = (rows as Array<Record<string, unknown>>).find((row) => row.name === keyValue);
  return (match as { _id: unknown } | undefined) ?? null;
}

export const exportWorkspaceSnapshot = query({
  args: {
    workspaceSlug: v.string(),
    profile: v.union(v.literal("hr-ops"), v.literal("full")),
  },
  handler: async (ctx, args) => {
    const candidateStatus = await collectWorkspaceRows(ctx, "candidate_status", "by_workspace_identity", args.workspaceSlug);
    const candidateBlocks = await collectWorkspaceRows(ctx, "candidate_blocks", "by_workspace_identity", args.workspaceSlug);

    let searchProfiles: Record<string, unknown>[] = [];
    let workspaceConfig: Record<string, unknown>[] = [];
    if (args.profile === "full") {
      searchProfiles = await collectWorkspaceRows(ctx, "search_profiles", "by_workspace", args.workspaceSlug);
      workspaceConfig = await collectWorkspaceRows(ctx, "workspace_config", "by_workspace", args.workspaceSlug);
      workspaceConfig = workspaceConfig.filter((row) => {
        const configKey = readString(row.configKey);
        return configKey !== null && !isSecretConfigKey(configKey);
      });
    }

    return {
      tables: {
        candidateStatus,
        candidateBlocks,
        searchProfiles,
        workspaceConfig,
      },
    };
  },
});

export const importWorkspaceSnapshot = mutation({
  args: {
    workspaceSlug: v.string(),
    profile: v.union(v.literal("hr-ops"), v.literal("full")),
    mode: v.union(v.literal("replace"), v.literal("merge")),
    tables: v.object({
      candidateStatus: v.array(v.any()),
      candidateBlocks: v.array(v.any()),
      searchProfiles: v.array(v.any()),
      workspaceConfig: v.array(v.any()),
    }),
  },
  handler: async (ctx, args) => {
    const includeFull = args.profile === "full";
    if (!includeFull) {
      for (const table of ["searchProfiles", "workspaceConfig"] as const) {
        if (args.tables[table].length > 0) {
          throw new Error(`hr-ops import refused: unexpected ${table} rows (use profile full)`);
        }
      }
    }

    const applied = { candidateStatus: 0, candidateBlocks: 0, searchProfiles: 0, workspaceConfig: 0 };
    const deleted = { candidateStatus: 0, candidateBlocks: 0, searchProfiles: 0, workspaceConfig: 0 };

    const validators = {
      candidateStatus: (row: unknown) => validateCandidateStatusRow(row, args.workspaceSlug),
      candidateBlocks: (row: unknown) => validateCandidateBlockRow(row, args.workspaceSlug),
      searchProfiles: (row: unknown) => validateSearchProfileRow(row, args.workspaceSlug),
      workspaceConfig: (row: unknown) => validateWorkspaceConfigRow(row, args.workspaceSlug),
    } as const;

    const tableMeta = TABLE_META;

    for (const [group, meta] of Object.entries(tableMeta) as [TableGroup, SnapshotTableMeta][]) {
      if (group === "searchProfiles" || group === "workspaceConfig") {
        if (!includeFull) {
          continue;
        }
      }
      const rows = args.tables[meta.key];
      if (args.mode === "replace") {
        deleted[meta.key] = await deleteAllForWorkspace(ctx, meta.table, meta.index, args.workspaceSlug);
      }
      for (const rawRow of rows) {
        const { fields } = validators[group](rawRow);
        let replacedExisting = false;
        if (args.mode === "merge") {
          const existing = await findExistingByNaturalKey(ctx, meta, args.workspaceSlug, fields);
          if (existing) {
            await ctx.db.replace(existing._id as never, fields as never);
            replacedExisting = true;
          }
        }
        if (!replacedExisting) {
          await ctx.db.insert(meta.table, fields as never);
        }
        applied[meta.key] += 1;
      }
    }

    return {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      profile: args.profile,
      workspaceSlug: args.workspaceSlug,
      mode: args.mode,
      applied,
      deleted,
    };
  },
});
