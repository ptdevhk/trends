import { createHash, randomBytes, randomUUID } from "node:crypto";

import { config } from "./config.js";
import { getResumeScreeningDb } from "./database.js";
import { formatIsoOffsetInTimezone } from "./timezone.js";

type JsonRecord = Record<string, unknown>;

export type PublicShareTargetType = "search_run" | "analysis_snapshot";
export type PublicShareLookupStatus = "active" | "expired" | "revoked";

export type SearchRun = {
  id: string;
  workspaceSlug: string;
  sessionId?: string;
  query: JsonRecord;
  safeFilters: JsonRecord;
  resultSetHash: string;
  resumeKeys: string[];
  createdBy?: string;
  createdAt: string;
};

export type PublicShareSnapshotResult = {
  resumeKey: string;
  displayName?: string;
  headline?: string;
  location?: string;
  summary?: string;
  score?: number;
  recommendation?: string;
  highlights?: string[];
  concerns?: string[];
  skills?: string[];
  [key: string]: unknown;
};

export type PublicShareSnapshotPayload = {
  title?: string;
  description?: string;
  search?: {
    query?: string;
    filters?: JsonRecord;
  };
  results: PublicShareSnapshotResult[];
  [key: string]: unknown;
};

export type AnalysisSnapshot = {
  id: string;
  workspaceSlug: string;
  searchRunId: string;
  scoringMode: string;
  promptVersion: string;
  skillConfigVersion: string;
  modelProvider: string;
  modelName: string;
  resultSetHash: string;
  payload: PublicShareSnapshotPayload;
  createdBy?: string;
  createdAt: string;
};

export type PublicShare = {
  id: string;
  workspaceSlug: string;
  targetType: PublicShareTargetType;
  targetId: string;
  title?: string;
  description?: string;
  createdBy?: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  revokedBy?: string;
};

export type CreatedPublicShare = PublicShare & {
  token: string;
};

export type PublicShareLookupResult = {
  status: PublicShareLookupStatus;
  share: PublicShare;
  snapshot?: AnalysisSnapshot;
  searchRun?: SearchRun;
};

const PUBLIC_FILTER_KEYS = new Set([
  "maxExperience",
  "minExperience",
  "minRoleYears",
  "roleFilterType",
  "minAge",
  "maxAge",
  "education",
  "skills",
  "locations",
  "minSalary",
  "maxSalary",
  "minMatchScore",
  "recommendation",
  "sortBy",
  "sortOrder",
  "idOrNameSearch",
]);

function nowIso(): string {
  return formatIsoOffsetInTimezone(new Date(), config.timezone);
}

function normalizeWorkspaceSlug(workspaceSlug: string | undefined): string {
  return workspaceSlug?.trim() || "dev";
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRecord(value: unknown): JsonRecord {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    console.error("public-share-storage JSON record parse failed:", error);
    return {};
  }
}

function parseJsonStringArray(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item)).filter((item) => item.length > 0)
      : [];
  } catch (error) {
    console.error("public-share-storage JSON array parse failed:", error);
    return [];
  }
}

function sanitizePublicFilters(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    return {};
  }

  const sanitized: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!PUBLIC_FILTER_KEYS.has(key)) {
      continue;
    }

    const stringArray = normalizeStringArray(entry);
    if (stringArray) {
      sanitized[key] = stringArray;
      continue;
    }

    const number = normalizeNumber(entry);
    if (number !== undefined) {
      sanitized[key] = number;
      continue;
    }

    const string = normalizeOptionalString(entry);
    if (string) {
      sanitized[key] = string;
    }
  }
  return sanitized;
}

function sanitizeSnapshotResult(value: unknown): PublicShareSnapshotResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const resumeKey = normalizeOptionalString(value.resumeKey);
  if (!resumeKey) {
    return null;
  }

  const result: PublicShareSnapshotResult = { resumeKey };
  const displayName = normalizeOptionalString(value.displayName ?? value.name);
  const headline = normalizeOptionalString(value.headline);
  const location = normalizeOptionalString(value.location);
  const summary = normalizeOptionalString(value.summary);
  const score = normalizeNumber(value.score);
  const recommendation = normalizeOptionalString(value.recommendation);
  const highlights = normalizeStringArray(value.highlights);
  const concerns = normalizeStringArray(value.concerns);
  const skills = normalizeStringArray(value.skills);

  if (displayName) result.displayName = displayName;
  if (headline) result.headline = headline;
  if (location) result.location = location;
  if (summary) result.summary = summary;
  if (score !== undefined) result.score = score;
  if (recommendation) result.recommendation = recommendation;
  if (highlights) result.highlights = highlights;
  if (concerns) result.concerns = concerns;
  if (skills) result.skills = skills;
  return result;
}

export function sanitizePublicSnapshotPayload(value: unknown): PublicShareSnapshotPayload {
  const input = isRecord(value) ? value : {};
  const results = Array.isArray(input.results)
    ? input.results
        .map((entry) => sanitizeSnapshotResult(entry))
        .filter((entry): entry is PublicShareSnapshotResult => entry !== null)
    : [];

  const payload: PublicShareSnapshotPayload = { results };
  const title = normalizeOptionalString(input.title);
  const description = normalizeOptionalString(input.description);
  const search = isRecord(input.search) ? input.search : {};
  const query = normalizeOptionalString(search.query);
  const filters = sanitizePublicFilters(search.filters);

  if (title) payload.title = title;
  if (description) payload.description = description;
  if (query || Object.keys(filters).length > 0) {
    payload.search = {};
    if (query) payload.search.query = query;
    if (Object.keys(filters).length > 0) payload.search.filters = filters;
  }

  return payload;
}

export function hashPublicShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generatePublicShareToken(): string {
  return randomBytes(32).toString("base64url");
}

function normalizeSearchRun(row: JsonRecord): SearchRun {
  return {
    id: String(row.id),
    workspaceSlug: row.workspace_slug ? String(row.workspace_slug) : "dev",
    sessionId: row.session_id ? String(row.session_id) : undefined,
    query: parseJsonRecord(row.query_json),
    safeFilters: parseJsonRecord(row.safe_filters_json),
    resultSetHash: String(row.result_set_hash),
    resumeKeys: parseJsonStringArray(row.resume_keys_json),
    createdBy: row.created_by ? String(row.created_by) : undefined,
    createdAt: String(row.created_at),
  };
}

function normalizeAnalysisSnapshot(row: JsonRecord): AnalysisSnapshot {
  return {
    id: String(row.id),
    workspaceSlug: row.workspace_slug ? String(row.workspace_slug) : "dev",
    searchRunId: String(row.search_run_id),
    scoringMode: String(row.scoring_mode),
    promptVersion: String(row.prompt_version),
    skillConfigVersion: String(row.skill_config_version),
    modelProvider: String(row.model_provider),
    modelName: String(row.model_name),
    resultSetHash: String(row.result_set_hash),
    payload: sanitizePublicSnapshotPayload(parseJsonRecord(row.sanitized_payload_json)),
    createdBy: row.created_by ? String(row.created_by) : undefined,
    createdAt: String(row.created_at),
  };
}

function normalizePublicShare(row: JsonRecord): PublicShare {
  const targetType = String(row.target_type) === "search_run" ? "search_run" : "analysis_snapshot";
  return {
    id: String(row.id),
    workspaceSlug: row.workspace_slug ? String(row.workspace_slug) : "dev",
    targetType,
    targetId: String(row.target_id),
    title: row.title ? String(row.title) : undefined,
    description: row.description ? String(row.description) : undefined,
    createdBy: row.created_by ? String(row.created_by) : undefined,
    createdAt: String(row.created_at),
    expiresAt: row.expires_at ? String(row.expires_at) : undefined,
    revokedAt: row.revoked_at ? String(row.revoked_at) : undefined,
    revokedBy: row.revoked_by ? String(row.revoked_by) : undefined,
  };
}

function resolveLookupStatus(share: PublicShare, now: string): PublicShareLookupStatus {
  if (share.revokedAt) {
    return "revoked";
  }

  if (share.expiresAt) {
    const expiresAt = Date.parse(share.expiresAt);
    const current = Date.parse(now);
    if (Number.isFinite(expiresAt) && Number.isFinite(current) && expiresAt <= current) {
      return "expired";
    }
  }

  return "active";
}

export class PublicShareStorage {
  private readonly db;

  constructor(projectRoot?: string) {
    this.db = getResumeScreeningDb(projectRoot);
  }

  createSearchRun(params: {
    workspaceSlug: string;
    sessionId?: string;
    query: JsonRecord;
    safeFilters: JsonRecord;
    resultSetHash: string;
    resumeKeys: string[];
    createdBy?: string;
    createdAt?: string;
  }): SearchRun {
    const run: SearchRun = {
      id: randomUUID(),
      workspaceSlug: normalizeWorkspaceSlug(params.workspaceSlug),
      sessionId: normalizeOptionalString(params.sessionId),
      query: { ...params.query },
      safeFilters: sanitizePublicFilters(params.safeFilters),
      resultSetHash: params.resultSetHash,
      resumeKeys: [...params.resumeKeys],
      createdBy: normalizeOptionalString(params.createdBy),
      createdAt: params.createdAt ?? nowIso(),
    };

    this.db.prepare(`
      INSERT INTO search_runs (
        id,
        workspace_slug,
        session_id,
        query_json,
        safe_filters_json,
        result_set_hash,
        resume_keys_json,
        created_by,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id,
      run.workspaceSlug,
      run.sessionId ?? null,
      JSON.stringify(run.query),
      JSON.stringify(run.safeFilters),
      run.resultSetHash,
      JSON.stringify(run.resumeKeys),
      run.createdBy ?? null,
      run.createdAt
    );

    return run;
  }

  listSearchRunsForSession(params: {
    workspaceSlug: string;
    sessionId: string;
    limit?: number;
  }): SearchRun[] {
    const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
    const rows = this.db.prepare(`
      SELECT *
      FROM search_runs
      WHERE workspace_slug = ? AND session_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(normalizeWorkspaceSlug(params.workspaceSlug), params.sessionId, limit) as JsonRecord[];

    return rows.map((row) => normalizeSearchRun(row));
  }

  getSearchRun(id: string): SearchRun | null {
    const row = this.db
      .prepare("SELECT * FROM search_runs WHERE id = ?")
      .get(id) as JsonRecord | undefined;
    return row ? normalizeSearchRun(row) : null;
  }

  createAnalysisSnapshot(params: {
    workspaceSlug: string;
    searchRunId: string;
    scoringMode: string;
    promptVersion: string;
    skillConfigVersion: string;
    modelProvider: string;
    modelName: string;
    resultSetHash: string;
    payload: PublicShareSnapshotPayload;
    createdBy?: string;
    createdAt?: string;
  }): AnalysisSnapshot {
    const snapshot: AnalysisSnapshot = {
      id: randomUUID(),
      workspaceSlug: normalizeWorkspaceSlug(params.workspaceSlug),
      searchRunId: params.searchRunId,
      scoringMode: params.scoringMode,
      promptVersion: params.promptVersion,
      skillConfigVersion: params.skillConfigVersion,
      modelProvider: params.modelProvider,
      modelName: params.modelName,
      resultSetHash: params.resultSetHash,
      payload: sanitizePublicSnapshotPayload(params.payload),
      createdBy: normalizeOptionalString(params.createdBy),
      createdAt: params.createdAt ?? nowIso(),
    };

    this.db.prepare(`
      INSERT INTO analysis_snapshots (
        id,
        workspace_slug,
        search_run_id,
        scoring_mode,
        prompt_version,
        skill_config_version,
        model_provider,
        model_name,
        result_set_hash,
        sanitized_payload_json,
        created_by,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.id,
      snapshot.workspaceSlug,
      snapshot.searchRunId,
      snapshot.scoringMode,
      snapshot.promptVersion,
      snapshot.skillConfigVersion,
      snapshot.modelProvider,
      snapshot.modelName,
      snapshot.resultSetHash,
      JSON.stringify(snapshot.payload),
      snapshot.createdBy ?? null,
      snapshot.createdAt
    );

    return snapshot;
  }

  getAnalysisSnapshot(id: string): AnalysisSnapshot | null {
    const row = this.db
      .prepare("SELECT * FROM analysis_snapshots WHERE id = ?")
      .get(id) as JsonRecord | undefined;
    return row ? normalizeAnalysisSnapshot(row) : null;
  }

  listAnalysisSnapshotsForRun(searchRunId: string, limit = 20): AnalysisSnapshot[] {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const rows = this.db.prepare(`
      SELECT *
      FROM analysis_snapshots
      WHERE search_run_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(searchRunId, boundedLimit) as JsonRecord[];

    return rows.map((row) => normalizeAnalysisSnapshot(row));
  }

  createPublicShare(params: {
    workspaceSlug: string;
    targetType: PublicShareTargetType;
    targetId: string;
    title?: string;
    description?: string;
    createdBy?: string;
    createdAt?: string;
    expiresAt?: string;
  }): CreatedPublicShare {
    const token = generatePublicShareToken();
    const share: CreatedPublicShare = {
      id: randomUUID(),
      token,
      workspaceSlug: normalizeWorkspaceSlug(params.workspaceSlug),
      targetType: params.targetType,
      targetId: params.targetId,
      title: normalizeOptionalString(params.title),
      description: normalizeOptionalString(params.description),
      createdBy: normalizeOptionalString(params.createdBy),
      createdAt: params.createdAt ?? nowIso(),
      expiresAt: normalizeOptionalString(params.expiresAt),
    };

    this.db.prepare(`
      INSERT INTO public_shares (
        id,
        token_hash,
        workspace_slug,
        target_type,
        target_id,
        title,
        description,
        created_by,
        created_at,
        expires_at,
        revoked_at,
        revoked_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `).run(
      share.id,
      hashPublicShareToken(token),
      share.workspaceSlug,
      share.targetType,
      share.targetId,
      share.title ?? null,
      share.description ?? null,
      share.createdBy ?? null,
      share.createdAt,
      share.expiresAt ?? null
    );

    return share;
  }

  revokePublicShare(params: {
    shareId: string;
    revokedBy?: string;
    revokedAt?: string;
  }): PublicShare | null {
    const revokedAt = params.revokedAt ?? nowIso();
    this.db.prepare(`
      UPDATE public_shares
      SET revoked_at = ?, revoked_by = ?
      WHERE id = ?
    `).run(revokedAt, normalizeOptionalString(params.revokedBy) ?? null, params.shareId);

    const row = this.db
      .prepare("SELECT * FROM public_shares WHERE id = ?")
      .get(params.shareId) as JsonRecord | undefined;
    return row ? normalizePublicShare(row) : null;
  }

  lookupPublicShareByToken(
    token: string,
    options: { now?: string } = {}
  ): PublicShareLookupResult | null {
    const normalizedToken = normalizeOptionalString(token);
    if (!normalizedToken) {
      return null;
    }

    const row = this.db
      .prepare("SELECT * FROM public_shares WHERE token_hash = ?")
      .get(hashPublicShareToken(normalizedToken)) as JsonRecord | undefined;
    if (!row) {
      return null;
    }

    const share = normalizePublicShare(row);
    const snapshot = share.targetType === "analysis_snapshot"
      ? this.getAnalysisSnapshot(share.targetId) ?? undefined
      : undefined;
    const searchRun = share.targetType === "search_run"
      ? this.getSearchRun(share.targetId) ?? undefined
      : snapshot
        ? this.getSearchRun(snapshot.searchRunId) ?? undefined
        : undefined;

    return {
      status: resolveLookupStatus(share, options.now ?? nowIso()),
      share,
      snapshot,
      searchRun,
    };
  }
}
