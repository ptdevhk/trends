import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { z } from "@hono/zod-openapi";

import {
  formatLocationHierarchyLabel,
  isRecord,
  normalizeResumeLocationHierarchy,
  normalizeSeekProfileUrlForDisplay,
  inferSeekMarket,
  COLLECTION_GUARDS,
  applyCollectionGuards,
} from "@trends/shared";
import {
  ResumeImportItemSchema,
  ResumeImportRestoreStateSchema,
  ResumeImportMetadataSchema,
  ResumeImportRequestSchema,
  ResumeSubmitSummarySchema,
} from "../schemas/resumes.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { ActionStorage, type CandidateActionBackupRow } from "./action-storage.js";
import { recordSearchProfileSubmitRunStatus } from "./search-profile-run-status.js";

const JOB5156_HOST = "hr.job5156.com";
const EHIRE_51JOB_HOST = "ehire.51job.com";
const RESUME_IMPORT_CONVEX_BATCH_SIZE = 200;
const CANDIDATE_STATUS_RESTORE_BATCH_SIZE = 100;

type ResumeImportMetadata = z.infer<typeof ResumeImportMetadataSchema>;
export type ResumeImportItem = z.infer<typeof ResumeImportItemSchema>;
type ResumeImportRestoreState = z.infer<typeof ResumeImportRestoreStateSchema>;
export type ResumeImportRequest = z.infer<typeof ResumeImportRequestSchema>;
export type ResumeSubmitSummary = z.infer<typeof ResumeSubmitSummarySchema>;

type ConvexResumeRestoreState = {
  crawledAt?: number;
  isArchived?: boolean;
  archivedAt?: number;
  searchText?: string;
  primaryRuleScore?: number;
  ingestData?: unknown;
  analysis?: unknown;
  analyses?: unknown;
};

export type ResumeImportOptions = {
  recomputeDerivedFields?: boolean;
};

type ConvexResumeSubmitItem = {
  externalId: string;
  content: unknown;
  hash: string;
  source: string;
  tags: string[];
  restoreState?: ConvexResumeRestoreState;
};

export type NormalizedResumeImportPayload = {
  metadata: ResumeImportMetadata;
  resumes: ResumeImportItem[];
  source: string;
  tags: string[];
  options: ResumeImportOptions;
  convexResumes: ConvexResumeSubmitItem[];
};


function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    return `{${keys.map((key) => `${key}:${stableStringify(value[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function readEnvVarFromFile(filePath: string, key: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx < 0) continue;
      const currentKey = trimmed.slice(0, idx).trim();
      if (currentKey !== key) continue;
      const value = trimmed.slice(idx + 1).trim();
      return value.replace(/^['"]|['"]$/g, "");
    }
    return null;
  } catch (error) {
    logger.error("Failed to read env var from file", error, { service: "resume-import-service", filePath, key });
    return null;
  }
}

export function resolveConvexUrl(): string {
  if (process.env.CONVEX_URL) return process.env.CONVEX_URL;
  if (process.env.VITE_CONVEX_URL) return process.env.VITE_CONVEX_URL;

  const candidateFiles = [
    path.join(config.projectRoot, "packages", "convex", ".env.local"),
    path.join(config.projectRoot, "apps", "web", ".env.local"),
    path.join(config.projectRoot, ".env.local"),
    path.join(config.projectRoot, ".env"),
  ];

  for (const filePath of candidateFiles) {
    const direct = readEnvVarFromFile(filePath, "CONVEX_URL");
    if (direct) return direct;
    const vite = readEnvVarFromFile(filePath, "VITE_CONVEX_URL");
    if (vite) return vite;
  }

  return "http://127.0.0.1:3210";
}

function normalizeOptionalString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeSourceHost(value: string | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeTagList(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const tags = Array.from(
    new Set(
      values
        .map((value) => normalizeOptionalString(value))
        .filter((value): value is string => value !== null),
    ),
  );

  return tags.length > 0 ? tags : undefined;
}

function normalizeImportMetadata(metadata: ResumeImportMetadata): ResumeImportMetadata {
  const searchKeyword = normalizeOptionalString(metadata.searchCriteria?.keyword);
  const searchLocation = normalizeOptionalString(metadata.searchCriteria?.location);

  return ResumeImportMetadataSchema.parse({
    ...metadata,
    sourceKey: normalizeOptionalString(metadata.sourceKey) ?? undefined,
    sourceHost: normalizeSourceHost(metadata.sourceHost) ?? undefined,
    keyword: normalizeOptionalString(metadata.keyword) ?? searchKeyword ?? undefined,
    location: normalizeOptionalString(metadata.location) ?? searchLocation ?? undefined,
    searchProfileId: normalizeOptionalString(metadata.searchProfileId) ?? undefined,
    searchCriteria: metadata.searchCriteria
      ? {
          ...metadata.searchCriteria,
          keyword: searchKeyword ?? undefined,
          location: searchLocation ?? undefined,
        }
      : undefined,
  });
}

function resolveResumeSource(metadata: ResumeImportMetadata): string {
  const sourceHost = normalizeSourceHost(metadata.sourceHost);
  if (sourceHost) {
    return sourceHost;
  }

  const sourceKey = normalizeSourceHost(metadata.sourceKey);
  if (sourceKey === "job5156") {
    return JOB5156_HOST;
  }
  if (sourceKey === "51job") {
    return EHIRE_51JOB_HOST;
  }

  try {
    return new URL(metadata.sourceUrl).hostname.toLowerCase();
  } catch (error) {
    logger.error("Failed to parse resume source URL", error, { service: "resume-import-service", sourceUrl: metadata.sourceUrl });
    return sourceKey || JOB5156_HOST;
  }
}

function normalizeCandidateId(value: string | undefined): string | null {
  return normalizeOptionalString(value);
}

function normalizeRestoreState(
  value: ResumeImportRestoreState | undefined,
  options: ResumeImportOptions = {},
): ConvexResumeRestoreState | undefined {
  if (!value) {
    return undefined;
  }

  const normalized: ConvexResumeRestoreState = {};
  if (typeof value.crawledAt === "number" && Number.isFinite(value.crawledAt)) {
    normalized.crawledAt = value.crawledAt;
  }

  if (typeof value.isArchived === "boolean") {
    normalized.isArchived = value.isArchived;
    if (value.isArchived && typeof value.archivedAt === "number" && Number.isFinite(value.archivedAt)) {
      normalized.archivedAt = value.archivedAt;
    }
  } else if (typeof value.archivedAt === "number" && Number.isFinite(value.archivedAt)) {
    normalized.archivedAt = value.archivedAt;
  }

  if (!options.recomputeDerivedFields) {
    const searchText = normalizeOptionalString(value.searchText);
    if (searchText) {
      normalized.searchText = searchText;
    }

    if (typeof value.primaryRuleScore === "number" && Number.isFinite(value.primaryRuleScore)) {
      normalized.primaryRuleScore = value.primaryRuleScore;
    }

    if (value.ingestData !== undefined) {
      normalized.ingestData = value.ingestData;
    }

    if (value.analysis !== undefined) {
      normalized.analysis = value.analysis;
    }

    if (value.analyses !== undefined) {
      normalized.analyses = value.analyses;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function buildResumeExternalId(resume: ResumeImportItem, source: string, hash: string): string {
  const explicitExternalId = normalizeCandidateId(resume.externalId);
  if (explicitExternalId) {
    return explicitExternalId;
  }

  const profileId = normalizeCandidateId(resume.profileId);
  if (profileId) {
    return `${source}:profile:${profileId}`;
  }

  const resumeId = normalizeCandidateId(resume.resumeId);
  if (resumeId) {
    return `${source}:resume:${resumeId}`;
  }

  const perUserId = normalizeCandidateId(resume.perUserId);
  if (perUserId) {
    return `${source}:user:${perUserId}`;
  }

  return `${source}:hash:${hash}`;
}

function buildNormalizedResumeContent(
  resume: ResumeImportItem,
  seekContext?: { sourceHost: string; jobId?: string },
): Record<string, unknown> {
  const { sourceHost: _sourceHost, tags: _tags, restoreState: _restoreState, ...content } = resume;
  const locationHierarchy = normalizeResumeLocationHierarchy(resume);
  const rawLocation = typeof content.location === "string" ? content.location.trim() : "";
  const location = rawLocation || (locationHierarchy ? formatLocationHierarchyLabel(locationHierarchy) : "");

  // Normalize seek profileUrl — upgrade UUID URLs to name-search format
  let profileUrl = content.profileUrl;
  if (typeof profileUrl === "string" && seekContext?.sourceHost) {
    const candidateName = typeof content.name === "string" ? content.name.trim() : "";
    const market = inferSeekMarket(seekContext.sourceHost);
    const roleTitles = typeof content.jobIntention === "string" ? content.jobIntention.trim() : undefined;
    const normalized = normalizeSeekProfileUrlForDisplay(profileUrl, candidateName, market, roleTitles);
    if (normalized && normalized !== profileUrl) {
      // Build recommended URL if we have a jobId and numeric profileId
      if (seekContext.jobId) {
        try {
          const parsed = new URL(normalized);
          const profileIdMatch = parsed.pathname.match(/\/candidates\/(\d+)$/);
          if (profileIdMatch?.[1]) {
            profileUrl = `https://${parsed.hostname}/candidates/recommended?jobId=${seekContext.jobId}&openProfileId=${profileIdMatch[1]}`;
          } else {
            profileUrl = normalized;
          }
        } catch {
          profileUrl = normalized;
        }
      } else {
        profileUrl = normalized;
      }
    }
  }

  return {
    ...content,
    ...(typeof profileUrl === "string" && profileUrl ? { profileUrl } : {}),
    location,
    ...(locationHierarchy ? { locationHierarchy } : {}),
  };
}

async function submitResumesToConvex(args: { resumes: ConvexResumeSubmitItem[] }): Promise<{
  submitted: number;
  deduped: number;
  inserted: number;
  updated: number;
  unchanged: number;
}> {
  const totals = {
    submitted: 0,
    deduped: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
  };

  for (let index = 0; index < args.resumes.length; index += RESUME_IMPORT_CONVEX_BATCH_SIZE) {
    const batch = args.resumes.slice(index, index + RESUME_IMPORT_CONVEX_BATCH_SIZE);
    // Keep each Convex mutation comfortably below the per-execution read limit.
    const value = await callConvexFunction("mutation", "resume_tasks:submitResumes", {
      resumes: batch,
    });
    if (!isRecord(value)) {
      throw new Error("Invalid submitResumes response from Convex");
    }

    totals.submitted += typeof value.submitted === "number" ? value.submitted : 0;
    totals.deduped += typeof value.deduped === "number" ? value.deduped : 0;
    totals.inserted += typeof value.inserted === "number" ? value.inserted : 0;
    totals.updated += typeof value.updated === "number" ? value.updated : 0;
    totals.unchanged += typeof value.unchanged === "number" ? value.unchanged : 0;
  }

  return totals;
}

function isBrowserExtensionGenerated(metadata: ResumeImportMetadata): boolean {
  return typeof metadata.generatedBy === "string" &&
    metadata.generatedBy.trim().toLowerCase().startsWith("browser-extension");
}

function resolveCollectionGuardSourceKey(source: string): string | null {
  if (COLLECTION_GUARDS[source]) return source;
  if (source === JOB5156_HOST) return "job5156";
  if (source === EHIRE_51JOB_HOST) return "51job";
  if (source === "seek" || source?.endsWith(".employer.seek.com")) return "seek";
  return null;
}

function applyImportCollectionGuards(
  content: Record<string, unknown>,
  metadata: ResumeImportMetadata,
  source: string,
): Record<string, unknown> {
  if (!isBrowserExtensionGenerated(metadata)) return content;
  const guardSourceKey = resolveCollectionGuardSourceKey(source);
  if (!guardSourceKey) return content;
  const guardFields = COLLECTION_GUARDS[guardSourceKey] ?? [];
  return applyCollectionGuards(content, guardFields);
}

export function normalizeResumeImportPayload(input: ResumeImportRequest): NormalizedResumeImportPayload {
  const parsedInput = ResumeImportRequestSchema.parse(input);
  const metadata = normalizeImportMetadata(parsedInput.metadata);
  const resumes = parsedInput.resumes ?? parsedInput.data ?? [];
  const options: ResumeImportOptions = {
    recomputeDerivedFields: parsedInput.options?.recomputeDerivedFields === true,
  };
  const tag = normalizeOptionalString(metadata.searchProfileId) ?? normalizeOptionalString(metadata.keyword);
  const defaultTags = tag ? [tag] : [];
  const source = resolveResumeSource(metadata);

  const isSeekSource = source.endsWith(".employer.seek.com") || source === "seek";
  const seekJobId = metadata.collectionContext?.jobId;

  const convexResumes = resumes.map((resume) => {
    const itemSource = normalizeSourceHost(resume.sourceHost) ?? source;
    const itemTags = normalizeTagList(resume.tags) ?? defaultTags;
    const normalizedContent = buildNormalizedResumeContent(
      resume,
      isSeekSource ? { sourceHost: itemSource, jobId: seekJobId } : undefined,
    );
    const content = isRecord(normalizedContent)
      ? applyImportCollectionGuards(normalizedContent, metadata, itemSource)
      : normalizedContent;
    const hash = crypto.createHash("sha256").update(stableStringify(content), "utf8").digest("hex");
    const externalId = buildResumeExternalId(resume, itemSource, hash);

    return {
      externalId,
      content,
      hash,
      source: itemSource,
      tags: itemTags,
      restoreState: normalizeRestoreState(resume.restoreState, options),
    };
  });

  return {
    metadata,
    resumes,
    source,
    tags: defaultTags,
    options,
    convexResumes,
  };
}

export async function submitNormalizedResumeImport(
  payload: NormalizedResumeImportPayload,
): Promise<ResumeSubmitSummary> {
  const result = await submitResumesToConvex({ resumes: payload.convexResumes });

  return ResumeSubmitSummarySchema.parse({
    success: true,
    submitted: result.submitted,
    inserted: result.inserted,
    updated: result.updated,
    unchanged: result.unchanged,
    deduped: result.deduped,
  });
}

export type CandidateStateReplayResult = {
  statusReplayed: number;
  actionsReplayed: number;
  actionsDeduped: number;
};

type CandidateStatusBackupEntry = {
  identityKey: string;
  status: string;
  notes?: string;
  updatedBy?: string;
  updatedAt: number;
  history?: Array<{ status: string; updatedAt: number; notes?: string }>;
};

async function callConvexFunction(
  endpoint: "mutation" | "query",
  pathName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const convexUrl = resolveConvexUrl().replace(/\/$/, "");
  const response = await fetch(`${convexUrl}/api/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ path: pathName, args }),
  });

  if (!response.ok) {
    const text = typeof response.text === "function" ? await response.text() : "";
    throw new Error(`Convex ${endpoint} failed (${response.status}): ${text}`);
  }

  const payload = await response.json() as unknown;
  if (!isRecord(payload)) {
    throw new Error(`Invalid ${pathName} response from Convex`);
  }
  if (payload.status !== "success") {
    throw new Error(typeof payload.errorMessage === "string"
      ? payload.errorMessage
      : `Convex ${endpoint} failed for ${pathName}`);
  }
  return payload.value;
}

function requireCompleteRestoreResult(value: unknown, requested: number): number {
  if (!isRecord(value)) {
    throw new Error("Invalid candidate_status:restoreBatch response from Convex");
  }
  const unresolved = Array.isArray(value.unresolvedIdentityKeys)
    && value.unresolvedIdentityKeys.every((identityKey) => typeof identityKey === "string")
    ? value.unresolvedIdentityKeys as string[]
    : null;
  const restored = value.restored;
  const inserted = value.inserted;
  const updated = value.updated;
  const responseRequested = value.requested;
  if (
    unresolved === null
    || typeof restored !== "number"
    || typeof inserted !== "number"
    || typeof updated !== "number"
    || typeof responseRequested !== "number"
  ) {
    throw new Error("Invalid candidate_status:restoreBatch response from Convex");
  }
  if (
    responseRequested !== requested
    || restored !== requested
    || inserted + updated !== restored
    || unresolved.length > 0
  ) {
    throw new Error(
      `Candidate status restore was partial or unresolved: requested=${requested} restored=${restored} unresolved=${unresolved.join(",")}`,
    );
  }
  return restored;
}

function exactCandidateState(entry: CandidateStatusBackupEntry): Record<string, unknown> {
  return {
    status: entry.status,
    ...(entry.notes !== undefined ? { notes: entry.notes } : {}),
    ...(entry.updatedBy !== undefined ? { updatedBy: entry.updatedBy } : {}),
    updatedAt: entry.updatedAt,
    ...(entry.history !== undefined ? { history: entry.history } : {}),
  };
}

async function reconcileCandidateStatus(
  candidateStatus: CandidateStatusBackupEntry[],
  workspaceSlug: string,
): Promise<void> {
  const expectedByIdentity = new Map<string, CandidateStatusBackupEntry>();
  for (const entry of candidateStatus) {
    expectedByIdentity.set(entry.identityKey.trim(), entry);
  }
  const identityKeys = Array.from(expectedByIdentity.keys());
  const actualByIdentity = new Map<string, CandidateStatusBackupEntry>();

  for (let offset = 0; offset < identityKeys.length; offset += CANDIDATE_STATUS_RESTORE_BATCH_SIZE) {
    const batch = identityKeys.slice(offset, offset + CANDIDATE_STATUS_RESTORE_BATCH_SIZE);
    const value = await callConvexFunction("query", "candidate_status:getByIdentities", {
      workspaceSlug,
      identityKeys: batch,
      writeSecret: config.auth.convexWriteSecret,
    });
    if (!Array.isArray(value)) {
      throw new Error("Invalid candidate_status:getByIdentities response from Convex");
    }
    for (const row of value) {
      if (!isRecord(row) || typeof row.identityKey !== "string") {
        throw new Error("Invalid candidate status row during reconciliation");
      }
      const identityKey = row.identityKey.trim();
      if (!batch.includes(identityKey) || actualByIdentity.has(identityKey)) {
        throw new Error(`Candidate status reconciliation returned an unexpected identity: ${identityKey}`);
      }
      actualByIdentity.set(identityKey, {
        identityKey,
        status: typeof row.status === "string" ? row.status : "",
        ...(typeof row.notes === "string" ? { notes: row.notes } : {}),
        ...(typeof row.updatedBy === "string" ? { updatedBy: row.updatedBy } : {}),
        updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : Number.NaN,
        ...(Array.isArray(row.history) ? {
          history: row.history as CandidateStatusBackupEntry["history"],
        } : {}),
      });
    }
  }

  for (const [identityKey, expected] of expectedByIdentity) {
    const actual = actualByIdentity.get(identityKey);
    if (!actual || !isDeepStrictEqual(exactCandidateState(actual), exactCandidateState(expected))) {
      throw new Error(`Candidate status reconciliation failed for ${identityKey}`);
    }
  }
}

export async function replayCandidateState(params: {
  candidateStatus?: CandidateStatusBackupEntry[];
  candidateActions?: CandidateActionBackupRow[];
  workspaceSlug: string;
  mode: "replace" | "merge";
}): Promise<CandidateStateReplayResult> {
  const { candidateStatus, candidateActions, workspaceSlug, mode } = params;
  const result: CandidateStateReplayResult = {
    statusReplayed: 0,
    actionsReplayed: 0,
    actionsDeduped: 0,
  };

  if (candidateStatus && candidateStatus.length > 0) {
    for (let offset = 0; offset < candidateStatus.length; offset += CANDIDATE_STATUS_RESTORE_BATCH_SIZE) {
      const batch = candidateStatus.slice(offset, offset + CANDIDATE_STATUS_RESTORE_BATCH_SIZE);
      const value = await callConvexFunction("mutation", "candidate_status:restoreBatch", {
        workspaceSlug,
        allowOrphan: true,
        items: batch,
        writeSecret: config.auth.convexWriteSecret,
      });
      result.statusReplayed += requireCompleteRestoreResult(value, batch.length);
    }
    await reconcileCandidateStatus(candidateStatus, workspaceSlug);
  }

  if (candidateActions && candidateActions.length > 0) {
    const actionStorage = new ActionStorage(config.projectRoot);
    const replayResult = actionStorage.replayActions({
      actions: candidateActions,
      mode,
    });
    result.actionsReplayed = replayResult.replayed;
    result.actionsDeduped = replayResult.deduped;
    if (result.actionsReplayed + result.actionsDeduped !== candidateActions.length) {
      throw new Error(
        `Candidate action replay count mismatch: expected=${candidateActions.length} replayed=${result.actionsReplayed} deduped=${result.actionsDeduped}`,
      );
    }
  }

  return result;
}

export async function submitResumeImport(input: ResumeImportRequest, workspaceSlug?: string): Promise<{
  success: true;
  submitted: number;
  inserted: number;
  updated: number;
  unchanged: number;
  deduped: number;
  statusReplayed: number;
  actionsReplayed: number;
  actionsDeduped: number;
}> {
  const normalized = normalizeResumeImportPayload(input);
  const resumeResult = await submitNormalizedResumeImport(normalized);

  const resolvedWorkspace = workspaceSlug ?? "dev";
  if (normalized.metadata.searchProfileId && normalized.convexResumes.length > 0) {
    recordSearchProfileSubmitRunStatus({
      workspaceSlug: resolvedWorkspace,
      profileId: normalized.metadata.searchProfileId,
      submitted: resumeResult.submitted,
    });
  }

  const stateResult = await replayCandidateState({
    candidateStatus: input.candidateStatus,
    candidateActions: input.candidateActions,
    workspaceSlug: resolvedWorkspace,
    mode: "merge",
  });

  return {
    ...resumeResult,
    statusReplayed: stateResult.statusReplayed,
    actionsReplayed: stateResult.actionsReplayed,
    actionsDeduped: stateResult.actionsDeduped,
  };
}
