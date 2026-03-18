import { readFile } from "node:fs/promises";

import { resolveApiUrl, resolveWorkspace, parseTruthy } from "./operator-utils.ts";

type RestorePayload = {
  metadata?: Record<string, unknown>;
  resumes?: unknown[];
  data?: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveMode(value: string | undefined): "upsert" | "replace" {
  const normalized = value?.trim().toLowerCase() || "upsert";
  if (normalized !== "upsert" && normalized !== "replace") {
    throw new Error(`invalid restore mode ${JSON.stringify(value)} (expected upsert|replace)`);
  }
  return normalized;
}

async function postJson(apiUrl: string, workspace: string, pathName: string, body: unknown): Promise<Response> {
  return await fetch(`${apiUrl.replace(/\/$/, "")}${pathName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Workspace-Slug": workspace,
    },
    body: JSON.stringify(body),
  });
}

async function main(): Promise<void> {
  const apiUrl = resolveApiUrl();
  const workspace = resolveWorkspace();
  const filePath = process.env.FILE?.trim();
  if (!filePath) {
    throw new Error("FILE is required");
  }

  const mode = resolveMode(process.env.MODE);
  const confirm = parseTruthy(process.env.YES);
  if (mode === "replace" && !confirm) {
    throw new Error("MODE=replace requires YES=1");
  }

  const raw = await readFile(filePath, "utf8");
  let parsed: RestorePayload;
  try {
    const decoded = JSON.parse(raw) as unknown;
    if (!isRecord(decoded)) {
      throw new Error("backup file is not an object");
    }
    parsed = decoded as RestorePayload;
  } catch (error) {
    throw new Error(`invalid backup file: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed.metadata) || (Array.isArray(parsed.resumes) ? parsed.resumes.length === 0 : Array.isArray(parsed.data) ? parsed.data.length === 0 : true)) {
    throw new Error("invalid backup file: missing metadata or resume array");
  }

  let resetResult: Record<string, unknown> | undefined;
  if (mode === "replace") {
    const resetResponse = await postJson(apiUrl, workspace, "/api/resumes/reset", {});
    const resetText = await resetResponse.text();
    if (!resetResponse.ok) {
      throw new Error(`reset request failed (${resetResponse.status}): ${resetText.trim() || "no response body"}`);
    }
    const decodedReset = JSON.parse(resetText) as unknown;
    if (!isRecord(decodedReset)) {
      throw new Error("invalid reset response");
    }
    resetResult = decodedReset;
  }

  const importResponse = await postJson(apiUrl, workspace, "/api/resumes/import", parsed);
  const importText = await importResponse.text();
  if (!importResponse.ok) {
    throw new Error(`import request failed (${importResponse.status}): ${importText.trim() || "no response body"}`);
  }

  const decodedImport = JSON.parse(importText) as unknown;
  if (!isRecord(decodedImport)) {
    throw new Error("invalid import response");
  }
  const importResult = decodedImport;
  console.log(JSON.stringify({
    success: true,
    apiUrl,
    workspace,
    file: filePath,
    mode,
    reset: mode === "replace",
    resetResult,
    importResult,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
