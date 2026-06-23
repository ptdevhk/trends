import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseTruthy,
  readPortableBackupFile,
  resolveApiUrl,
  resolveWorkspace,
} from "./operator-utils.ts";

type RestorePayload = {
  metadata?: Record<string, unknown>;
  resumes?: unknown[];
  data?: unknown[];
  candidateActions?: unknown[];
  candidateStatus?: unknown[];
};

type RestoreMode = "replace" | "merge";

type RestoreAuth = {
  cookie: string;
  csrfToken: string;
};

type RestoreRuntime = {
  fetch: typeof fetch;
};

type RestoreFileSummary = {
  file: string;
  count: number;
  importResult: Record<string, unknown>;
};

const IMPORT_CHUNK_SIZE = 50;
const IMPORT_RETRY_DELAY_MS = 5_000;
const IMPORT_MAX_RETRIES = 3;

type RestoreResetSummary = {
  success: true;
  count: number;
  partial: boolean;
  deleted: Record<string, number>;
};

type RestoreRunSummary = {
  success: true;
  apiUrl: string;
  workspace: string;
  inputPath: string;
  mode: RestoreMode;
  reset: boolean;
  recomputeDerivedFields: boolean;
  autoBackupPath?: string;
  resetResult?: Record<string, unknown>;
  files: RestoreFileSummary[];
};

const SOURCE_RESTORE_ORDER = ["job5156", "seek", "51job-manual"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readResumeArray(payload: RestorePayload): unknown[] {
  if (Array.isArray(payload.resumes)) {
    return payload.resumes;
  }
  if (Array.isArray(payload.data)) {
    return payload.data;
  }
  return [];
}

function extractSessionCookie(response: Response): string | undefined {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    return undefined;
  }
  const match = /(?:^|,\s*)(trends_session=[^;]+)/i.exec(setCookie);
  return match?.[1]?.trim() || undefined;
}

async function loginToApi(
  apiUrl: string,
  runtime: RestoreRuntime,
): Promise<RestoreAuth> {
  const username = process.env.TRENDS_AUTH_USERNAME?.trim();
  const password = process.env.TRENDS_AUTH_PASSWORD?.trim();
  if (!username || !password) {
    throw new Error("TRENDS_AUTH_USERNAME and TRENDS_AUTH_PASSWORD are required for authenticated restore");
  }

  const loginUrl = `${apiUrl.replace(/\/$/, "")}/api/auth/login`;
  const response = await runtime.fetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`auth login failed (${response.status}): ${text.trim() || "no response body"}`);
  }

  const body = (await response.json()) as Record<string, unknown>;
  const csrfToken = typeof body.csrfToken === "string" ? body.csrfToken : undefined;
  if (!csrfToken) {
    throw new Error("auth login response missing csrfToken");
  }

  const cookie = extractSessionCookie(response);
  if (!cookie) {
    throw new Error("auth login response missing session cookie");
  }

  return { cookie, csrfToken };
}

function resolveMode(value: string | undefined): RestoreMode {
  const normalized = value?.trim().toLowerCase() || "replace";
  if (normalized === "upsert") {
    return "merge";
  }
  if (normalized !== "replace" && normalized !== "merge") {
    throw usageError(`invalid restore mode ${JSON.stringify(value)} (expected replace|merge; upsert is an alias for merge)`);
  }
  return normalized;
}

function usage(): string {
  return [
    "Usage:",
    "  make restore-resumes FILE=/abs/path/resume-backup.json [WORKSPACE=dev] [API_URL=http://localhost:3000]",
    "  make restore-resumes FILE=/abs/path/resume-backups/20260321-015304 [WORKSPACE=dev] [API_URL=http://localhost:3000]",
    "  make restore-resumes FILE=/abs/path/resume-backup.json MODE=replace YES=1 [WORKSPACE=dev] [API_URL=http://localhost:3000]",
    "  make restore-resumes FILE=/abs/path/resume-backup.json MODE=merge [WORKSPACE=dev] [API_URL=http://localhost:3000]",
    "  make restore-resumes FILE=/abs/path/resume-backup.json RECOMPUTE_DERIVED_FIELDS=1 [WORKSPACE=dev] [API_URL=http://localhost:3000]",
    "",
    "Environment:",
    "  FILE        Required backup file path or directory containing backup files",
    "  MODE        Optional restore mode: replace | merge (default: replace; upsert is an alias for merge)",
    "  YES         Required when MODE=replace; set YES=1 to confirm destructive reset",
    "  SKIP_AUTO_BACKUP  Optional; set to 1 to skip auto-backup before replace reset",
    "  RECOMPUTE_DERIVED_FIELDS  Optional; set to 1 to drop preserved computed fields and force current ingest recomputation",
    "  WORKSPACE   Optional workspace slug (default: dev)",
    "  API_URL     Optional API URL (default: http://localhost:3000)",
    "  TRENDS_AUTH_USERNAME  Optional; when set with TRENDS_AUTH_PASSWORD, logs in to API before restore",
    "  TRENDS_AUTH_PASSWORD  Optional; password for authenticated restore (paired with TRENDS_AUTH_USERNAME)",
  ].join("\n");
}

function usageError(message: string): Error {
  return new Error(`${message}\n\n${usage()}`);
}

function isSupportedBackupPath(fileName: string): boolean {
  const normalized = fileName.trim().toLowerCase();
  return normalized.endsWith(".json") || normalized.endsWith(".tar.gz");
}

function readRestoreOrder(filePath: string): number {
  const fileName = path.basename(filePath);
  const sourceIndex = SOURCE_RESTORE_ORDER.findIndex((source) =>
    fileName.startsWith(`resume-backup-${source}-`),
  );
  return sourceIndex >= 0 ? sourceIndex : SOURCE_RESTORE_ORDER.length;
}

function compareRestorePaths(left: string, right: string): number {
  const sourceOrderDiff = readRestoreOrder(left) - readRestoreOrder(right);
  if (sourceOrderDiff !== 0) {
    return sourceOrderDiff;
  }
  return path.basename(left).localeCompare(path.basename(right));
}

async function resolveRestorePaths(inputPath: string): Promise<string[]> {
  const resolvedInputPath = inputPath.trim();
  if (!resolvedInputPath) {
    throw usageError("FILE is required");
  }

  const entry = await stat(resolvedInputPath);
  if (!entry.isDirectory()) {
    return [resolvedInputPath];
  }

  const children = await readdir(resolvedInputPath, { withFileTypes: true });
  const files = children
    .filter((child) => child.isFile() && isSupportedBackupPath(child.name))
    .map((child) => path.join(resolvedInputPath, child.name))
    .sort(compareRestorePaths);

  if (files.length === 0) {
    throw usageError(`no restore backup files found in directory ${JSON.stringify(resolvedInputPath)}`);
  }

  return files;
}

function parseRestorePayload(raw: string): RestorePayload {
  try {
    const decoded = JSON.parse(raw) as unknown;
    if (!isRecord(decoded)) {
      throw new Error("backup file is not an object");
    }
    return decoded as RestorePayload;
  } catch (error) {
    throw new Error(`invalid backup file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateRestorePayload(parsed: RestorePayload): void {
  const hasResumes = readResumeArray(parsed).length > 0;
  const hasActions = Array.isArray(parsed.candidateActions) && parsed.candidateActions.length > 0;
  const hasStatus = Array.isArray(parsed.candidateStatus) && parsed.candidateStatus.length > 0;
  if (!isRecord(parsed.metadata) || (!hasResumes && !hasActions && !hasStatus)) {
    throw new Error("invalid backup file: missing metadata or any data array");
  }
}

async function readRestorePayload(filePath: string): Promise<RestorePayload> {
  const raw = await readPortableBackupFile(filePath);
  const parsed = parseRestorePayload(raw);
  validateRestorePayload(parsed);
  return parsed;
}

async function postJson(
  apiUrl: string,
  workspace: string,
  pathName: string,
  body: unknown,
  runtime: RestoreRuntime,
  auth?: RestoreAuth,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Workspace-Slug": workspace,
  };
  if (auth) {
    headers.Cookie = auth.cookie;
    headers["X-CSRF-Token"] = auth.csrfToken;
  }
  return await runtime.fetch(`${apiUrl.replace(/\/$/, "")}${pathName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function parseJsonRecord(
  response: Response,
  errorPrefix: string,
): Promise<Record<string, unknown>> {
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`${errorPrefix} (${response.status}): ${responseText.trim() || "no response body"}`);
  }

  const decoded = JSON.parse(responseText) as unknown;
  if (!isRecord(decoded)) {
    throw new Error(`invalid response for ${errorPrefix}`);
  }
  return decoded;
}

function readResetCount(result: Record<string, unknown>): number {
  const count = result.count;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

function mergeDeletedCounts(target: Record<string, number>, deleted: unknown): void {
  if (!isRecord(deleted)) {
    return;
  }

  for (const [key, value] of Object.entries(deleted)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    target[key] = (target[key] ?? 0) + value;
  }
}

const RESET_RETRY_DELAY_MS = 5_000;
const RESET_MAX_RETRIES = 5;

async function resetResumesFully(
  apiUrl: string,
  workspace: string,
  runtime: RestoreRuntime,
  auth?: RestoreAuth,
): Promise<RestoreResetSummary> {
  let totalCount = 0;
  const deleted: Record<string, number> = {};

  while (true) {
    const resetResponse = await postJson(
      apiUrl,
      workspace,
      "/api/resumes/reset",
      {},
      runtime,
      auth,
    );
    if (!resetResponse.ok) {
      const text = await resetResponse.text();
      const isTransient = resetResponse.status === 503
        || resetResponse.status === 500
        || text.includes("OptimisticConcurrencyControlFailure")
        || text.includes("TooManyWrites");
      if (isTransient) {
        for (let attempt = 1; attempt <= RESET_MAX_RETRIES; attempt++) {
          console.log(`  reset transient error (attempt ${attempt}/${RESET_MAX_RETRIES}), retrying in ${RESET_RETRY_DELAY_MS / 1000}s…`);
          await new Promise((resolve) => setTimeout(resolve, RESET_RETRY_DELAY_MS));
          const retryResponse = await postJson(
            apiUrl,
            workspace,
            "/api/resumes/reset",
            {},
            runtime,
            auth,
          );
          if (retryResponse.ok) {
            const retryResult = await parseJsonRecord(retryResponse, "reset request failed");
            totalCount += readResetCount(retryResult);
            mergeDeletedCounts(deleted, retryResult.deleted);
            if (retryResult.partial !== true) {
              return { success: true, count: totalCount, partial: false, deleted };
            }
            break;
          }
          if (attempt === RESET_MAX_RETRIES) {
            throw new Error(`reset request failed after ${RESET_MAX_RETRIES} retries: ${text.trim()}`);
          }
        }
        continue;
      }
      throw new Error(`reset request failed (${resetResponse.status}): ${text.trim()}`);
    }

    const resetResult = await parseJsonRecord(resetResponse, "reset request failed");
    totalCount += readResetCount(resetResult);
    mergeDeletedCounts(deleted, resetResult.deleted);

    if (resetResult.partial !== true) {
      return {
        success: true,
        count: totalCount,
        partial: false,
        deleted,
      };
    }
  }
}

async function autoBackupBeforeReplace(
  apiUrl: string,
  workspace: string,
  runtime: RestoreRuntime,
  auth?: RestoreAuth,
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const autoBackupPath = `output/resume-backups/auto-pre-restore-${workspace}-${timestamp}.json`;

  const backupResponse = await postJson(
    apiUrl,
    workspace,
    "/api/resumes/backup",
    {},
    runtime,
    auth,
  );

  if (!backupResponse.ok) {
    const text = await backupResponse.text();
    throw new Error(`auto-backup failed (${backupResponse.status}): ${text.trim() || "no response body"} — aborting replace. Set SKIP_AUTO_BACKUP=1 to override.`);
  }

  const backupData = await backupResponse.text();
  const fs = await import("node:fs/promises");
  await fs.writeFile(autoBackupPath, backupData, "utf8");

  return autoBackupPath;
}

async function resetCandidateActions(
  apiUrl: string,
  workspace: string,
  runtime: RestoreRuntime,
  auth?: RestoreAuth,
): Promise<number> {
  const response = await postJson(
    apiUrl,
    workspace,
    "/api/resumes/candidate-actions/reset",
    { workspaceSlug: workspace },
    runtime,
    auth,
  );
  const result = await parseJsonRecord(response, "candidate-actions reset failed");
  return typeof result.deleted === "number" ? result.deleted : 0;
}

export async function runRestoreResumes(
  params: {
    apiUrl: string;
    workspace: string;
    filePath: string;
    mode: RestoreMode;
    confirm: boolean;
    recomputeDerivedFields: boolean;
    skipAutoBackup?: boolean;
  },
  runtime: RestoreRuntime = { fetch: globalThis.fetch },
): Promise<RestoreRunSummary> {
  if (params.mode === "replace" && !params.confirm) {
    throw usageError("MODE=replace requires YES=1");
  }

  let auth: RestoreAuth | undefined;
  if (process.env.TRENDS_AUTH_USERNAME?.trim()) {
    auth = await loginToApi(params.apiUrl, runtime);
    console.log(`  authenticated as ${process.env.TRENDS_AUTH_USERNAME.trim()}`);
  }

  const restorePaths = await resolveRestorePaths(params.filePath);

  let autoBackupPath: string | undefined;
  let resetResult: Record<string, unknown> | undefined;
  if (params.mode === "replace") {
    if (!params.skipAutoBackup) {
      autoBackupPath = await autoBackupBeforeReplace(
        params.apiUrl,
        params.workspace,
        runtime,
        auth,
      );
    }

    resetResult = await resetResumesFully(
      params.apiUrl,
      params.workspace,
      runtime,
      auth,
    );

    await resetCandidateActions(
      params.apiUrl,
      params.workspace,
      runtime,
      auth,
    );
  }

  const files: RestoreFileSummary[] = [];
  for (const restorePath of restorePaths) {
    const payload = await readRestorePayload(restorePath);
    const resumes = readResumeArray(payload);
    const totalResumes = resumes.length;

    if (totalResumes <= IMPORT_CHUNK_SIZE) {
      const importResponse = await postJson(
        params.apiUrl,
        params.workspace,
        "/api/resumes/import",
        {
          ...payload,
          ...(params.recomputeDerivedFields ? { options: { recomputeDerivedFields: true } } : {}),
        },
        runtime,
        auth,
      );
      const importResult = await parseJsonRecord(
        importResponse,
        `import request failed for ${path.basename(restorePath)}`,
      );
      files.push({ file: restorePath, count: totalResumes, importResult });
      continue;
    }

    // Chunked import for large payloads to avoid Convex write limits and timeouts
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let deduped = 0;
    let chunkFailed = false;

    for (let offset = 0; offset < totalResumes; offset += IMPORT_CHUNK_SIZE) {
      const chunk = resumes.slice(offset, offset + IMPORT_CHUNK_SIZE);
      const chunkPayload = {
        metadata: payload.metadata,
        resumes: chunk,
        ...(payload.candidateActions && offset === 0 ? { candidateActions: payload.candidateActions } : {}),
        ...(payload.candidateStatus && offset === 0 ? { candidateStatus: payload.candidateStatus } : {}),
        ...(params.recomputeDerivedFields ? { options: { recomputeDerivedFields: true } } : {}),
      };

      let lastError: string | undefined;
      let succeeded = false;

      for (let attempt = 1; attempt <= IMPORT_MAX_RETRIES; attempt++) {
        try {
          const importResponse = await postJson(
            params.apiUrl,
            params.workspace,
            "/api/resumes/import",
            chunkPayload,
            runtime,
            auth,
          );
          const importResult = await parseJsonRecord(
            importResponse,
            `import chunk ${offset} failed for ${path.basename(restorePath)}`,
          );
          inserted += typeof importResult.inserted === "number" ? importResult.inserted : 0;
          updated += typeof importResult.updated === "number" ? importResult.updated : 0;
          unchanged += typeof importResult.unchanged === "number" ? importResult.unchanged : 0;
          deduped += typeof importResult.deduped === "number" ? importResult.deduped : 0;
          succeeded = true;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          if (attempt < IMPORT_MAX_RETRIES) {
            console.log(`  import chunk ${offset} attempt ${attempt} failed, retrying in ${IMPORT_RETRY_DELAY_MS / 1000}s…`);
            await new Promise((resolve) => setTimeout(resolve, IMPORT_RETRY_DELAY_MS));
          }
        }
      }

      if (!succeeded) {
        console.error(`  import chunk ${offset} failed after ${IMPORT_MAX_RETRIES} retries: ${lastError}`);
        chunkFailed = true;
        break;
      }

      const progress = Math.min(offset + chunk.length, totalResumes);
      if (progress % 500 < IMPORT_CHUNK_SIZE || progress === totalResumes) {
        console.log(`  ${path.basename(restorePath)}: ${progress}/${totalResumes} (inserted:${inserted} updated:${updated})`);
      }
    }

    files.push({
      file: restorePath,
      count: totalResumes,
      importResult: chunkFailed
        ? { success: false, inserted, updated, unchanged, deduped, error: "one or more chunks failed" }
        : { success: true, inserted, updated, unchanged, deduped },
    });
  }

  return {
    success: true,
    apiUrl: params.apiUrl,
    workspace: params.workspace,
    inputPath: params.filePath,
    mode: params.mode,
    reset: params.mode === "replace",
    recomputeDerivedFields: params.recomputeDerivedFields,
    autoBackupPath,
    resetResult,
    files,
  };
}

async function main(): Promise<void> {
  const summary = await runRestoreResumes({
    apiUrl: resolveApiUrl(),
    workspace: resolveWorkspace(),
    filePath: process.env.FILE?.trim() || "",
    mode: resolveMode(process.env.MODE),
    confirm: parseTruthy(process.env.YES),
    recomputeDerivedFields: parseTruthy(process.env.RECOMPUTE_DERIVED_FIELDS),
    skipAutoBackup: parseTruthy(process.env.SKIP_AUTO_BACKUP),
  });

  console.log(JSON.stringify(summary, null, 2));
}

const isMainModule = process.argv[1]
  ? path.resolve(fileURLToPath(import.meta.url)) ===
    path.resolve(process.argv[1])
  : false;

if (isMainModule) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
