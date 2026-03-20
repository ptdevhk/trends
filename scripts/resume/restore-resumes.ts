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
};

type RestoreMode = "upsert" | "replace";

type RestoreRuntime = {
  fetch: typeof fetch;
};

type RestoreFileSummary = {
  file: string;
  count: number;
  importResult: Record<string, unknown>;
};

export type RestoreRunSummary = {
  success: true;
  apiUrl: string;
  workspace: string;
  inputPath: string;
  mode: RestoreMode;
  reset: boolean;
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

function resolveMode(value: string | undefined): RestoreMode {
  const normalized = value?.trim().toLowerCase() || "upsert";
  if (normalized !== "upsert" && normalized !== "replace") {
    throw usageError(`invalid restore mode ${JSON.stringify(value)} (expected upsert|replace)`);
  }
  return normalized;
}

function usage(): string {
  return [
    "Usage:",
    "  make restore-resumes FILE=/abs/path/resume-backup.json [WORKSPACE=dev] [API_URL=http://localhost:3000]",
    "  make restore-resumes FILE=/abs/path/resume-backups/20260321-015304 [WORKSPACE=dev] [API_URL=http://localhost:3000]",
    "  make restore-resumes FILE=/abs/path/resume-backup.json MODE=replace YES=1 [WORKSPACE=dev] [API_URL=http://localhost:3000]",
    "",
    "Environment:",
    "  FILE        Required backup file path or directory containing backup files",
    "  MODE        Optional restore mode: upsert | replace (default: upsert)",
    "  YES         Required when MODE=replace; set YES=1 to confirm destructive reset",
    "  WORKSPACE   Optional workspace slug (default: dev)",
    "  API_URL     Optional API URL (default: http://localhost:3000)",
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
  if (!isRecord(parsed.metadata) || readResumeArray(parsed).length === 0) {
    throw new Error("invalid backup file: missing metadata or resume array");
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
): Promise<Response> {
  return await runtime.fetch(`${apiUrl.replace(/\/$/, "")}${pathName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Workspace-Slug": workspace,
    },
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

export async function runRestoreResumes(
  params: {
    apiUrl: string;
    workspace: string;
    filePath: string;
    mode: RestoreMode;
    confirm: boolean;
  },
  runtime: RestoreRuntime = { fetch: globalThis.fetch },
): Promise<RestoreRunSummary> {
  if (params.mode === "replace" && !params.confirm) {
    throw usageError("MODE=replace requires YES=1");
  }

  const restorePaths = await resolveRestorePaths(params.filePath);

  let resetResult: Record<string, unknown> | undefined;
  if (params.mode === "replace") {
    const resetResponse = await postJson(
      params.apiUrl,
      params.workspace,
      "/api/resumes/reset",
      {},
      runtime,
    );
    resetResult = await parseJsonRecord(resetResponse, "reset request failed");
  }

  const files: RestoreFileSummary[] = [];
  for (const restorePath of restorePaths) {
    const payload = await readRestorePayload(restorePath);
    const importResponse = await postJson(
      params.apiUrl,
      params.workspace,
      "/api/resumes/import",
      payload,
      runtime,
    );
    const importResult = await parseJsonRecord(
      importResponse,
      `import request failed for ${path.basename(restorePath)}`,
    );
    files.push({
      file: restorePath,
      count: readResumeArray(payload).length,
      importResult,
    });
  }

  return {
    success: true,
    apiUrl: params.apiUrl,
    workspace: params.workspace,
    inputPath: params.filePath,
    mode: params.mode,
    reset: params.mode === "replace",
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
