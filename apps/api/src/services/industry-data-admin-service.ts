import { config } from "./config.js";
import { callConvexMutation, callConvexQuery } from "./convex-utils.js";
import {
  regenerateAndCommit,
  type CommitDeps,
  type IndustryDataSnapshot,
} from "./industry-data-generator.js";
import {
  type EntryType,
  type IndustryDataEntryInput,
  IndustryDataEntryInputSchema,
  validateEntryData,
} from "./industry-data-validators.js";
import type {
  BrandEntry,
  CompanyEntry,
  KeywordEntry,
} from "./industry-data-service.js";

/**
 * Admin write path for industry data: validate → Convex upsert/delete + change log
 * → regenerate files + best-effort git commit → set gitSha on the change row.
 */

export interface IndustryDataEntry {
  entryType: EntryType;
  entryId: string;
  data: unknown;
  sortOrder?: number;
  createdAt?: number;
  updatedAt?: number;
  updatedBy?: string;
}

export interface WriteResult {
  entry: IndustryDataEntry | null;
  gitSha: string | null;
  warning?: string;
  changeId: string;
}

export interface AdminServiceDeps {
  upsertEntry: (input: {
    entryType: EntryType;
    entryId: string;
    data: unknown;
    sortOrder?: number;
    actor: string;
  }) => Promise<{ entryId: string }>;
  deleteEntry: (input: {
    entryId: string;
    actor: string;
  }) => Promise<{ ok: true }>;
  getEntry: (entryId: string) => Promise<IndustryDataEntry | null>;
  listEntries: (entryType?: EntryType) => Promise<IndustryDataEntry[]>;
  appendChange: (input: {
    changeId: string;
    entryType: string;
    entryId: string;
    action: "create" | "update" | "delete";
    actor: string;
    before?: unknown;
    after?: unknown;
    companyKey?: string;
    gitSha?: string | null;
  }) => Promise<{ changeId: string }>;
  setChangeGitSha: (input: {
    changeId: string;
    gitSha: string;
  }) => Promise<{ ok: true }>;
  regenerateAndCommit: (
    actor: string,
    entries: IndustryDataSnapshot,
  ) => Promise<{ sha: string | null; warning?: string; written: string[] }>;
}

function changeId(): string {
  return `chg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function writeSecret(): string {
  return config.auth.convexWriteSecret;
}

function defaultDeps(commitDeps: CommitDeps = {}): AdminServiceDeps {
  return {
    upsertEntry: async (input) =>
      (await callConvexMutation("companies:upsertIndustryDataEntry", {
        ...input,
        writeSecret: writeSecret(),
      })) as { entryId: string },
    deleteEntry: async (input) =>
      (await callConvexMutation("companies:deleteIndustryDataEntry", {
        ...input,
        writeSecret: writeSecret(),
      })) as { ok: true },
    getEntry: async (entryId) =>
      (await callConvexQuery("companies:getIndustryDataEntry", {
        entryId,
        writeSecret: writeSecret(),
      })) as IndustryDataEntry | null,
    listEntries: async (entryType) =>
      (await callConvexQuery("companies:listIndustryDataEntries", {
        ...(entryType ? { entryType } : {}),
        writeSecret: writeSecret(),
      })) as IndustryDataEntry[],
    appendChange: async (input) =>
      (await callConvexMutation("companies:appendIndustryDataChange", {
        ...input,
        writeSecret: writeSecret(),
      })) as { changeId: string },
    setChangeGitSha: async (input) =>
      (await callConvexMutation("companies:setIndustryDataChangeGitSha", {
        ...input,
        writeSecret: writeSecret(),
      })) as { ok: true },
    regenerateAndCommit: async (actor, entries) =>
      regenerateAndCommit(config.projectRoot, actor, entries, commitDeps),
  };
}

function toSnapshot(entries: IndustryDataEntry[]): IndustryDataSnapshot {
  const companies: CompanyEntry[] = [];
  const keywords: KeywordEntry[] = [];
  const brands: BrandEntry[] = [];
  const companyUrls: string[] = [];
  const sorted = [...entries].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );
  for (const e of sorted) {
    if (e.entryType === "company") companies.push(e.data as CompanyEntry);
    else if (e.entryType === "keyword") keywords.push(e.data as KeywordEntry);
    else if (e.entryType === "brand") brands.push(e.data as BrandEntry);
    else if (e.entryType === "url") {
      const u = e.data;
      companyUrls.push(typeof u === "string" ? u : String((u as { url?: string })?.url ?? ""));
    }
  }
  return { companies, keywords, brands, companyUrls: companyUrls.filter(Boolean) };
}

async function afterWrite(
  deps: AdminServiceDeps,
  actor: string,
  changeIdValue: string,
): Promise<{ gitSha: string | null; warning?: string }> {
  const all = await deps.listEntries();
  const result = await deps.regenerateAndCommit(actor, toSnapshot(all));
  if (result.sha) {
    await deps.setChangeGitSha({ changeId: changeIdValue, gitSha: result.sha });
  }
  return { gitSha: result.sha, warning: result.warning };
}

export async function createEntry(
  input: IndustryDataEntryInput & { actor: string },
  deps: AdminServiceDeps = defaultDeps(),
): Promise<WriteResult> {
  const parsed = IndustryDataEntryInputSchema.parse(input);
  const data = validateEntryData(parsed.entryType, parsed.data);
  const existing = await deps.getEntry(parsed.entryId);
  if (existing) {
    throw Object.assign(new Error(`Entry already exists: ${parsed.entryId}`), {
      status: 409,
    });
  }
  await deps.upsertEntry({
    entryType: parsed.entryType,
    entryId: parsed.entryId,
    data,
    sortOrder: parsed.sortOrder,
    actor: input.actor,
  });
  const cid = changeId();
  await deps.appendChange({
    changeId: cid,
    entryType: parsed.entryType,
    entryId: parsed.entryId,
    action: "create",
    actor: input.actor,
    after: data,
    companyKey: parsed.companyKey,
  });
  const { gitSha, warning } = await afterWrite(deps, input.actor, cid);
  return {
    entry: {
      entryType: parsed.entryType,
      entryId: parsed.entryId,
      data,
      sortOrder: parsed.sortOrder,
      updatedBy: input.actor,
    },
    gitSha,
    warning,
    changeId: cid,
  };
}

export async function updateEntry(
  input: {
    entryId: string;
    entryType: EntryType;
    data: unknown;
    actor: string;
    sortOrder?: number;
    companyKey?: string;
  },
  deps: AdminServiceDeps = defaultDeps(),
): Promise<WriteResult> {
  const data = validateEntryData(input.entryType, input.data);
  const before = await deps.getEntry(input.entryId);
  await deps.upsertEntry({
    entryType: input.entryType,
    entryId: input.entryId,
    data,
    sortOrder: input.sortOrder,
    actor: input.actor,
  });
  const cid = changeId();
  await deps.appendChange({
    changeId: cid,
    entryType: input.entryType,
    entryId: input.entryId,
    action: before ? "update" : "create",
    actor: input.actor,
    before: before?.data,
    after: data,
    companyKey: input.companyKey,
  });
  const { gitSha, warning } = await afterWrite(deps, input.actor, cid);
  return {
    entry: {
      entryType: input.entryType,
      entryId: input.entryId,
      data,
      sortOrder: input.sortOrder,
      updatedBy: input.actor,
    },
    gitSha,
    warning,
    changeId: cid,
  };
}

export async function deleteEntry(
  input: { entryId: string; actor: string; companyKey?: string },
  deps: AdminServiceDeps = defaultDeps(),
): Promise<WriteResult> {
  const before = await deps.getEntry(input.entryId);
  await deps.deleteEntry({ entryId: input.entryId, actor: input.actor });
  const cid = changeId();
  await deps.appendChange({
    changeId: cid,
    entryType: before?.entryType ?? "company",
    entryId: input.entryId,
    action: "delete",
    actor: input.actor,
    before: before?.data,
    companyKey: input.companyKey,
  });
  const { gitSha, warning } = await afterWrite(deps, input.actor, cid);
  return { entry: null, gitSha, warning, changeId: cid };
}

/**
 * Bulk import, all-or-nothing: validate every entry first; only then upsert.
 * One regenerate+commit at the end; shared gitSha applied to every change row.
 */
export async function importEntries(
  input: { entries: IndustryDataEntryInput[]; actor: string },
  deps: AdminServiceDeps = defaultDeps(),
): Promise<{ imported: number; gitSha: string | null; warning?: string; changeIds: string[] }> {
  const validated = input.entries.map((raw) => {
    const parsed = IndustryDataEntryInputSchema.parse(raw);
    const data = validateEntryData(parsed.entryType, parsed.data);
    return { ...parsed, data };
  });

  const changeIds: string[] = [];
  for (const e of validated) {
    const existing = await deps.getEntry(e.entryId);
    await deps.upsertEntry({
      entryType: e.entryType,
      entryId: e.entryId,
      data: e.data,
      sortOrder: e.sortOrder,
      actor: input.actor,
    });
    const cid = changeId();
    changeIds.push(cid);
    await deps.appendChange({
      changeId: cid,
      entryType: e.entryType,
      entryId: e.entryId,
      action: existing ? "update" : "create",
      actor: input.actor,
      before: existing?.data,
      after: e.data,
      companyKey: e.companyKey,
    });
  }

  const all = await deps.listEntries();
  const result = await deps.regenerateAndCommit(input.actor, toSnapshot(all));
  if (result.sha) {
    for (const cid of changeIds) {
      await deps.setChangeGitSha({ changeId: cid, gitSha: result.sha });
    }
  }
  return {
    imported: validated.length,
    gitSha: result.sha,
    warning: result.warning,
    changeIds,
  };
}

export async function exportEntries(
  entryType?: EntryType,
  deps: AdminServiceDeps = defaultDeps(),
): Promise<IndustryDataEntry[]> {
  return deps.listEntries(entryType);
}

export async function listEntries(
  entryType?: EntryType,
  deps: AdminServiceDeps = defaultDeps(),
): Promise<IndustryDataEntry[]> {
  return deps.listEntries(entryType);
}

export async function setSchedulePaused(
  paused: boolean,
  deps?: { setPaused?: (paused: boolean) => Promise<{ paused: boolean }> },
): Promise<{ paused: boolean }> {
  if (deps?.setPaused) return deps.setPaused(paused);
  return (await callConvexMutation("companies:setIndustryMaintenanceSchedulePaused", {
    paused,
    writeSecret: writeSecret(),
  })) as { paused: boolean };
}

export async function getSchedulePaused(
  deps?: { getPaused?: () => Promise<{ paused: boolean }> },
): Promise<{ paused: boolean }> {
  if (deps?.getPaused) return deps.getPaused();
  return (await callConvexQuery("companies:getIndustryMaintenanceSchedulePaused", {
    writeSecret: writeSecret(),
  })) as { paused: boolean };
}

/** Test helper: expose defaultDeps with injectable commit. */
export function createAdminServiceDeps(commitDeps: CommitDeps = {}): AdminServiceDeps {
  return defaultDeps(commitDeps);
}
