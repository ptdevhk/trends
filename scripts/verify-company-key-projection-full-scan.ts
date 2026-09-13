#!/usr/bin/env npx tsx
/**
 * Reusable READ-ONLY full-cursor company-key projection evidence wrapper.
 *
 * Walks the resume corpus by repeatedly calling the public, read-only
 * `resumes:fieldCoverage` query with small pages and chaining cursors until
 * `hasMore: false`.
 *
 * Never invokes an action or mutation.
 *
 * Exit codes:
 *   0 - Clean scan complete: full corpus traversed to hasMore=false, staleCount == 0.
 *   1 - Config or invocation error (auth failure, bad JSON, command error, unapproved prod target, etc.)
 *   2 - Stale rows detected: scan completed cleanly, but staleCount > 0 or target epoch mismatch.
 *   3 - Incomplete scan: stopped due to page cap, cursor cycle, or zero progress before reaching hasMore=false.
 *
 * Schema: trends-company-key-projection-evidence/v1
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { CURRENT_COMPANY_KEY_PROJECTION_EPOCH } from "@trends/shared";

export const EVIDENCE_SCHEMA = "trends-company-key-projection-evidence/v1";
export const EVIDENCE_SCHEMA_VERSION = "v1";

export const EXIT_OK = 0;
export const EXIT_CONFIG_OR_INVOCATION_ERROR = 1;
export const EXIT_STALE_ROWS_DETECTED = 2;
export const EXIT_INCOMPLETE_SCAN = 3;

export type TargetRole = "local" | "preview" | "production";

export interface FullScanCliOptions {
  targetRole: TargetRole;
  limit: number;
  maxPages: number;
  pageSize: number;
  convexUrl?: string;
  deployment?: string;
  envFile?: string;
  repoRoot?: string;
  allowProduction: boolean;
  json: boolean;
}

export interface CommandExecutionInput {
  functionName: string;
  args: Record<string, unknown>;
  options: FullScanCliOptions;
  resolvedConvexDir: string;
}

export interface CommandExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandExecutor = (input: CommandExecutionInput) => Promise<CommandExecutionResult>;

export interface FullScanEvidenceSummary {
  pages: number;
  scannedRows: number;
  staleCount: number;
  missingCount: number;
  laggingCount: number;
  scanComplete: boolean;
}

export interface FullScanEvidence {
  schema: string;
  schemaVersion: string;
  appVersion: string;
  targetRole: TargetRole;
  status: "clean" | "stale_detected" | "incomplete_scan" | "error";
  exitCode: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  targetEpoch: number;
  currentEpoch: number | null;
  targetUrl?: string;
  deployment?: string;
  summary: FullScanEvidenceSummary;
  errors?: string[];
  warnings?: string[];
}

export interface RunFullScanParams {
  options: FullScanCliOptions;
  executor?: CommandExecutor;
  secretValues?: string[];
}

export interface RunFullScanResult {
  exitCode: number;
  evidence: FullScanEvidence;
}

export interface ProjectionResponsePage {
  currentCompanyKeyProjectionEpoch: number;
  hasMore: boolean;
  cursor: string | null;
  scanned: number;
  missingCompanyKeyProjection: number;
  laggingCompanyKeyProjection: number;
}

/**
 * Resolve the project application version from package.json without hardcoding.
 */
export function resolveAppVersion(repoRoot?: string): string {
  const root = repoRoot ?? process.cwd();
  const packageJsonPath = join(root, "package.json");
  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const parsed = JSON.parse(content);
    if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
      return parsed.version.trim();
    }
  } catch (error) {
    throw new Error(
      `Unable to resolve application version from ${packageJsonPath}: ${(error as Error).message}`,
    );
  }
  throw new Error(`Unable to resolve application version from ${packageJsonPath}: version is missing or invalid`);
}

/**
 * Safely extract only target-selector keys (CONVEX_URL, CONVEX_DEPLOYMENT)
 * from an env file without evaluating shell or leaking secrets.
 */
export function readTargetSelectorsFromEnvFile(envFilePath: string): { convexUrl?: string; deployment?: string } {
  if (!existsSync(envFilePath)) {
    throw new Error(`Specified env file does not exist: ${envFilePath}`);
  }

  const content = readFileSync(envFilePath, "utf-8");
  const lines = content.split("\n");
  let convexUrl: string | undefined;
  let deployment: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_0-9]+)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let val = match[2].trim();

    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    if (key === "CONVEX_URL" && !convexUrl) {
      convexUrl = val;
    } else if (key === "CONVEX_DEPLOYMENT" && !deployment) {
      deployment = val;
    }
  }

  return { convexUrl, deployment };
}

/**
 * Reconcile and validate target role against target URL and deployment selector.
 */
export function validateRoleAndTarget(
  targetRole: TargetRole,
  convexUrl: string | undefined,
  deployment: string | undefined,
  allowProduction: boolean,
): void {
  const normalizedUrl = convexUrl ? convexUrl.trim().toLowerCase() : "";
  const normalizedDeployment = deployment ? deployment.trim().toLowerCase() : "";

  const isProdUrl =
    (normalizedUrl.includes("pt-mes") && !normalizedUrl.includes("preview")) ||
    normalizedUrl.includes("trends.pt-mes.com") ||
    normalizedUrl.includes("prod.pt-mes.com");

  const isProdDeployment =
    normalizedDeployment === "prod" ||
    normalizedDeployment === "production" ||
    normalizedDeployment.startsWith("prod:") ||
    normalizedDeployment.includes("-prod") ||
    normalizedDeployment.includes("production");

  const isPreviewUrl =
    normalizedUrl.includes("preview.pt-mes.com") ||
    normalizedUrl.includes(":4210");

  const isPreviewDeployment =
    normalizedDeployment === "preview" ||
    normalizedDeployment.startsWith("preview:") ||
    normalizedDeployment.includes("-preview");

  if (targetRole === "local") {
    if (isProdUrl) {
      throw new Error(`Local role cannot target production URL: ${convexUrl}`);
    }
    if (isPreviewUrl) {
      throw new Error(`Local role cannot target preview URL: ${convexUrl}`);
    }
    if (isProdDeployment) {
      throw new Error(`Local role cannot target production deployment: ${deployment}`);
    }
    if (isPreviewDeployment) {
      throw new Error(`Local role cannot target preview deployment: ${deployment}`);
    }
    return;
  }

  if (targetRole === "preview") {
    if (normalizedUrl.includes(":3210")) {
      throw new Error(`Preview role cannot target port 3210 (local dev port or direct prod loopback): ${convexUrl}`);
    }
    if (isProdUrl) {
      throw new Error(`Preview role cannot target production URL: ${convexUrl}`);
    }
    if (isProdDeployment) {
      throw new Error(`Preview role cannot target production deployment: ${deployment}`);
    }
    return;
  }

  if (targetRole === "production") {
    if (!allowProduction) {
      throw new Error("Production role requires --allow-production acknowledgement.");
    }
    if (normalizedUrl.includes(":4210")) {
      throw new Error(`Production role cannot target port 4210 (preview port): ${convexUrl}`);
    }
    if (isPreviewUrl) {
      throw new Error(`Production role cannot target preview URL: ${convexUrl}`);
    }
    if (isPreviewDeployment) {
      throw new Error(`Production role cannot target preview deployment: ${deployment}`);
    }
    return;
  }

  throw new Error(`Unknown target role: ${targetRole}`);
}

/**
 * Redact secrets from text or JSON-like objects.
 */
export function redactSecrets(input: unknown, extraSecrets: string[] = []): unknown {
  const secretKeywords = [
    "secret",
    "token",
    "password",
    "key",
    "authorization",
    "cookie",
    "bearer",
  ];

  const sanitizeString = (str: string): string => {
    let result = str;
    for (const s of extraSecrets) {
      if (s && s.length > 3) {
        result = result.split(s).join("[REDACTED]");
      }
    }
    result = result.replace(
      /(?:CONVEX_WRITE_SECRET|writeSecret|AUTH_BOOTSTRAP_PASSWORD|password|apiKey|api_key|token)[=:\s]+["']?([^\s"',;]+)["']?/gi,
      (match, p1) => match.replace(p1, "[REDACTED]"),
    );
    result = result.replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, "Bearer [REDACTED]");
    return result;
  };

  if (typeof input === "string") {
    return sanitizeString(input);
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSecrets(item, extraSecrets));
  }

  if (input !== null && typeof input === "object") {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const lowerKey = k.toLowerCase();
      const isSensitive = secretKeywords.some((kw) => lowerKey.includes(kw));
      if (isSensitive) {
        res[k] = "[REDACTED]";
      } else {
        res[k] = redactSecrets(v, extraSecrets);
      }
    }
    return res;
  }

  return input;
}

/**
 * Build CLI arguments for running convex action via spawnSync without shell execution.
 */
export function buildConvexRunCommandArgs(params: {
  functionName: string;
  args: Record<string, unknown>;
  options: FullScanCliOptions;
}): { file: string; args: string[] } {
  const commandArgs = [
    "convex",
    "run",
    params.functionName,
    JSON.stringify(params.args),
  ];

  if (params.options.convexUrl) {
    commandArgs.push("--url", params.options.convexUrl);
  }
  if (params.options.deployment) {
    commandArgs.push("--deployment", params.options.deployment);
  }
  if (params.options.envFile) {
    commandArgs.push("--env-file", params.options.envFile);
  }

  return {
    file: "npx",
    args: commandArgs,
  };
}

/**
 * Default command executor using spawnSync (no shell invocation).
 */
export const defaultCliCommandExecutor: CommandExecutor = async ({
  functionName,
  args,
  options,
  resolvedConvexDir,
}) => {
  const { file, args: cmdArgs } = buildConvexRunCommandArgs({
    functionName,
    args,
    options,
  });

  const childEnv = { ...process.env };
  if (options.convexUrl && !childEnv.CONVEX_URL) {
    childEnv.CONVEX_URL = options.convexUrl;
  }
  if (options.deployment && !childEnv.CONVEX_DEPLOYMENT) {
    childEnv.CONVEX_DEPLOYMENT = options.deployment;
  }

  const result = spawnSync(file, cmdArgs, {
    cwd: resolvedConvexDir,
    encoding: "utf-8",
    timeout: 120000,
    maxBuffer: 50 * 1024 * 1024,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnv,
  });

  if (result.error) {
    return {
      exitCode: 1,
      stdout: result.stdout || "",
      stderr: result.error.message || String(result.error),
    };
  }

  return {
    exitCode: result.status ?? (result.signal ? 1 : 0),
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
};

/**
 * Extract a single unambiguous top-level JSON object from Convex CLI output.
 * Rejects output with multiple top-level JSON values or unparseable text.
 */
export function extractJsonFromConvexOutput(output: string): any {
  const trimmed = output.trim();
  const parsedObjects: any[] = [];

  let inString = false;
  let escapeNext = false;
  let depth = 0;
  let startIdx = -1;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (char === "\\") {
        escapeNext = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      if (depth === 0) {
        startIdx = i;
      }
      depth++;
    } else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0 && startIdx !== -1) {
        const potentialJson = trimmed.slice(startIdx, i + 1);
        try {
          const parsed = JSON.parse(potentialJson);
          parsedObjects.push(parsed);
        } catch {
          // Incomplete or invalid JSON chunk
        }
        startIdx = -1;
      } else if (depth < 0) {
        depth = 0;
        startIdx = -1;
      }
    }
  }

  if (parsedObjects.length === 0) {
    throw new Error(`Could not find valid JSON in Convex output: ${trimmed.slice(-300)}`);
  }

  if (parsedObjects.length > 1) {
    throw new Error(
      `Ambiguous output: multiple top-level JSON values detected in Convex output (${parsedObjects.length} found)`,
    );
  }

  return parsedObjects[0];
}

/**
 * Validate response page against strict schema rules.
 */
export function validateProjectionResponsePage(
  page: unknown,
  expectedEpoch: number | null,
): ProjectionResponsePage {
  if (!page || typeof page !== "object" || Array.isArray(page)) {
    throw new Error("Invalid response structure: expected an object");
  }

  const p = page as Record<string, unknown>;

  if (typeof p.hasMore !== "boolean") {
    throw new Error(`Response hasMore must be a boolean; received ${typeof p.hasMore}`);
  }

  if (typeof p.scanned !== "number" || !Number.isInteger(p.scanned) || p.scanned < 0) {
    throw new Error(`Response scanned must be a non-negative integer; received ${p.scanned}`);
  }

  if (
    typeof p.missingCompanyKeyProjection !== "number"
    || !Number.isInteger(p.missingCompanyKeyProjection)
    || p.missingCompanyKeyProjection < 0
  ) {
    throw new Error(
      `Response missingCompanyKeyProjection must be a non-negative integer; received ${p.missingCompanyKeyProjection}`,
    );
  }

  if (
    typeof p.laggingCompanyKeyProjection !== "number"
    || !Number.isInteger(p.laggingCompanyKeyProjection)
    || p.laggingCompanyKeyProjection < 0
  ) {
    throw new Error(
      `Response laggingCompanyKeyProjection must be a non-negative integer; received ${p.laggingCompanyKeyProjection}`,
    );
  }

  if (
    typeof p.currentCompanyKeyProjectionEpoch !== "number"
    || !Number.isInteger(p.currentCompanyKeyProjectionEpoch)
  ) {
    throw new Error(
      `Response currentCompanyKeyProjectionEpoch must be a finite integer; received ${p.currentCompanyKeyProjectionEpoch}`,
    );
  }

  if (
    expectedEpoch !== null
    && p.currentCompanyKeyProjectionEpoch !== expectedEpoch
  ) {
    throw new Error(
      `Inconsistent currentCompanyKeyProjectionEpoch across pages: expected ${expectedEpoch}, received ${p.currentCompanyKeyProjectionEpoch}`,
    );
  }

  if (p.hasMore) {
    if (typeof p.cursor !== "string" || p.cursor.length === 0) {
      throw new Error("Response cursor must be a non-empty string when hasMore is true");
    }
  } else {
    if (p.cursor !== null && p.cursor !== undefined) {
      throw new Error("Response cursor must be null or absent when hasMore is false");
    }
  }

  return {
    currentCompanyKeyProjectionEpoch: p.currentCompanyKeyProjectionEpoch as number,
    hasMore: p.hasMore as boolean,
    cursor: (p.cursor as string | null) ?? null,
    scanned: p.scanned as number,
    missingCompanyKeyProjection: p.missingCompanyKeyProjection as number,
    laggingCompanyKeyProjection: p.laggingCompanyKeyProjection as number,
  };
}

/**
 * Execute the full cursor scan loop.
 */
export async function runFullScan(params: RunFullScanParams): Promise<RunFullScanResult> {
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const options = params.options;
  const executor = params.executor ?? defaultCliCommandExecutor;

  // Clone secret array to avoid mutating caller array
  const extraSecrets = [...(params.secretValues ?? [])];

  if (process.env.CONVEX_WRITE_SECRET) {
    extraSecrets.push(process.env.CONVEX_WRITE_SECRET);
  }
  if (process.env.AUTH_BOOTSTRAP_PASSWORD) {
    extraSecrets.push(process.env.AUTH_BOOTSTRAP_PASSWORD);
  }

  const repoRoot = options.repoRoot ?? process.cwd();
  const appVersion = resolveAppVersion(repoRoot);
  const convexDir = existsSync(join(repoRoot, "packages", "convex"))
    ? join(repoRoot, "packages", "convex")
    : repoRoot;

  // Resolve target url and deployment
  let resolvedUrl = options.convexUrl ?? process.env.CONVEX_URL;
  let resolvedDeployment = options.deployment ?? process.env.CONVEX_DEPLOYMENT;

  if (options.envFile) {
    try {
      const selectors = readTargetSelectorsFromEnvFile(options.envFile);
      if (resolvedUrl && selectors.convexUrl && resolvedUrl !== selectors.convexUrl) {
        throw new Error(
          `Conflicting CONVEX_URL selectors: explicit/inherited target differs from ${options.envFile}`,
        );
      }
      if (resolvedDeployment && selectors.deployment && resolvedDeployment !== selectors.deployment) {
        throw new Error(
          `Conflicting CONVEX_DEPLOYMENT selectors: explicit/inherited target differs from ${options.envFile}`,
        );
      }
      if (!resolvedUrl && selectors.convexUrl) {
        resolvedUrl = selectors.convexUrl;
      }
      if (!resolvedDeployment && selectors.deployment) {
        resolvedDeployment = selectors.deployment;
      }
    } catch (envErr) {
      const errMsg = `Failed to read env file: ${(envErr as Error).message}`;
      const finishedAt = new Date();
      return {
        exitCode: EXIT_CONFIG_OR_INVOCATION_ERROR,
        evidence: {
          schema: EVIDENCE_SCHEMA,
          schemaVersion: EVIDENCE_SCHEMA_VERSION,
          appVersion,
          targetRole: options.targetRole,
          status: "error",
          exitCode: EXIT_CONFIG_OR_INVOCATION_ERROR,
          startedAt: startedAtIso,
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          targetEpoch: CURRENT_COMPANY_KEY_PROJECTION_EPOCH,
          currentEpoch: null,
          targetUrl: resolvedUrl ? String(redactSecrets(resolvedUrl, extraSecrets)) : undefined,
          deployment: resolvedDeployment ? String(redactSecrets(resolvedDeployment, extraSecrets)) : undefined,
          summary: {
            pages: 0,
            scannedRows: 0,
            staleCount: 0,
            missingCount: 0,
            laggingCount: 0,
            scanComplete: false,
          },
          errors: [errMsg],
        },
      };
    }
  }

  // Target role validation
  try {
    validateRoleAndTarget(
      options.targetRole,
      resolvedUrl,
      resolvedDeployment,
      options.allowProduction,
    );
  } catch (roleErr) {
    const errorMsg = (roleErr as Error).message;
    const finishedAt = new Date();
    const evidence: FullScanEvidence = {
      schema: EVIDENCE_SCHEMA,
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      appVersion,
      targetRole: options.targetRole,
      status: "error",
      exitCode: EXIT_CONFIG_OR_INVOCATION_ERROR,
      startedAt: startedAtIso,
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      targetEpoch: CURRENT_COMPANY_KEY_PROJECTION_EPOCH,
      currentEpoch: null,
      targetUrl: resolvedUrl ? String(redactSecrets(resolvedUrl, extraSecrets)) : undefined,
      deployment: resolvedDeployment ? String(redactSecrets(resolvedDeployment, extraSecrets)) : undefined,
      summary: {
        pages: 0,
        scannedRows: 0,
        staleCount: 0,
        missingCount: 0,
        laggingCount: 0,
        scanComplete: false,
      },
      errors: [errorMsg],
    };

    return {
      exitCode: EXIT_CONFIG_OR_INVOCATION_ERROR,
      evidence,
    };
  }

  let cursor: string | null = null;
  let hasMore = true;
  let pageCount = 0;
  let totalScannedRows = 0;
  let totalMissingCount = 0;
  let totalLaggingCount = 0;
  let detectedEpoch: number | null = null;
  let scanComplete = false;
  const seenCursors = new Set<string>();
  const errors: string[] = [];
  const warnings: string[] = [];

  let status: FullScanEvidence["status"] = "clean";
  let exitCode = EXIT_OK;

  while (hasMore) {
    if (pageCount >= options.maxPages) {
      const msg = `Scan aborted: Reached maximum pages limit / page cap (${options.maxPages}) before cursor scan completed (hasMore=true).`;
      errors.push(msg);
      status = "incomplete_scan";
      exitCode = EXIT_INCOMPLETE_SCAN;
      break;
    }

    if (cursor) {
      if (seenCursors.has(cursor)) {
        const msg = `Scan aborted: Detected cursor cycle or repeating cursor '${cursor}'.`;
        errors.push(msg);
        status = "incomplete_scan";
        exitCode = EXIT_INCOMPLETE_SCAN;
        break;
      }
      seenCursors.add(cursor);
    }

    pageCount++;

    const callArgs: Record<string, unknown> = {
      batchSize: options.pageSize,
      ...(cursor ? { cursor } : {}),
    };

    let result: CommandExecutionResult;
    try {
      result = await executor({
        functionName: "resumes:fieldCoverage",
        args: callArgs,
        options,
        resolvedConvexDir: convexDir,
      });
    } catch (err) {
      const msg = `Command execution threw an unhandled error: ${(err as Error).message}`;
      errors.push(String(redactSecrets(msg, extraSecrets)));
      status = "error";
      exitCode = EXIT_CONFIG_OR_INVOCATION_ERROR;
      break;
    }

    if (result.exitCode !== 0) {
      const errMsg = `Convex command failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`;
      errors.push(String(redactSecrets(errMsg, extraSecrets)));
      status = "error";
      exitCode = EXIT_CONFIG_OR_INVOCATION_ERROR;
      break;
    }

    let parsedJson: unknown;
    try {
      parsedJson = extractJsonFromConvexOutput(result.stdout);
    } catch (parseErr) {
      const errMsg = `Failed to parse response JSON: ${(parseErr as Error).message}`;
      errors.push(String(redactSecrets(errMsg, extraSecrets)));
      status = "error";
      exitCode = EXIT_CONFIG_OR_INVOCATION_ERROR;
      break;
    }

    let page: ProjectionResponsePage;
    try {
      page = validateProjectionResponsePage(parsedJson, detectedEpoch);
    } catch (schemaErr) {
      const errMsg = `Response schema validation failed: ${(schemaErr as Error).message}`;
      errors.push(String(redactSecrets(errMsg, extraSecrets)));
      status = "error";
      exitCode = EXIT_CONFIG_OR_INVOCATION_ERROR;
      break;
    }

    detectedEpoch = page.currentCompanyKeyProjectionEpoch;
    totalScannedRows += page.scanned;
    totalMissingCount += page.missingCompanyKeyProjection;
    totalLaggingCount += page.laggingCompanyKeyProjection;

    if (page.hasMore && page.scanned === 0) {
      const msg = "Scan aborted: No progress made (scannedRows=0 while hasMore=true).";
      errors.push(msg);
      status = "incomplete_scan";
      exitCode = EXIT_INCOMPLETE_SCAN;
      break;
    }

    if (!page.hasMore) {
      hasMore = false;
      scanComplete = true;
      break;
    }

    cursor = page.cursor;
  }

  const totalStaleCount = totalMissingCount + totalLaggingCount;
  const finishedAt = new Date();

  if (scanComplete) {
    const epochMismatched = detectedEpoch !== null && detectedEpoch !== CURRENT_COMPANY_KEY_PROJECTION_EPOCH;
    if (epochMismatched) {
      errors.push(
        `Target epoch (${CURRENT_COMPANY_KEY_PROJECTION_EPOCH}) does not match backend currentEpoch (${detectedEpoch}); epoch mismatch indicates outdated deployment or definitions.`,
      );
    }

    if (totalStaleCount > 0 || epochMismatched) {
      status = "stale_detected";
      exitCode = EXIT_STALE_ROWS_DETECTED;
    } else {
      status = "clean";
      exitCode = EXIT_OK;
    }
  }

  const rawEvidence: FullScanEvidence = {
    schema: EVIDENCE_SCHEMA,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    appVersion,
    targetRole: options.targetRole,
    status,
    exitCode,
    startedAt: startedAtIso,
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    targetEpoch: CURRENT_COMPANY_KEY_PROJECTION_EPOCH,
    currentEpoch: detectedEpoch,
    targetUrl: resolvedUrl ? String(redactSecrets(resolvedUrl, extraSecrets)) : undefined,
    deployment: resolvedDeployment ? String(redactSecrets(resolvedDeployment, extraSecrets)) : undefined,
    summary: {
      pages: pageCount,
      scannedRows: totalScannedRows,
      staleCount: totalStaleCount,
      missingCount: totalMissingCount,
      laggingCount: totalLaggingCount,
      scanComplete,
    },
    ...(errors.length > 0 ? { errors } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };

  const sanitizedEvidence = redactSecrets(rawEvidence, extraSecrets) as FullScanEvidence;

  return {
    exitCode,
    evidence: sanitizedEvidence,
  };
}

/**
 * Parse CLI options.
 */
export function parseCliArgs(argv: string[]): FullScanCliOptions {
  let targetRole: TargetRole | undefined;
  let limit = 200;
  let maxPages = 100;
  let convexUrl: string | undefined;
  let deployment: string | undefined;
  let envFile: string | undefined;
  let repoRoot: string | undefined;
  let allowProduction = false;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--target-role") {
      const val = argv[++i];
      if (val !== "local" && val !== "preview" && val !== "production") {
        throw new Error(`Invalid --target-role: '${val}'. Must be local, preview, or production.`);
      }
      targetRole = val;
    } else if (arg.startsWith("--target-role=")) {
      const val = arg.split("=")[1];
      if (val !== "local" && val !== "preview" && val !== "production") {
        throw new Error(`Invalid --target-role: '${val}'. Must be local, preview, or production.`);
      }
      targetRole = val as TargetRole;
    } else if (arg === "--limit" || arg === "--page-size") {
      const val = argv[++i];
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit value: ${val}`);
      }
      limit = parsed;
    } else if (arg.startsWith("--limit=") || arg.startsWith("--page-size=")) {
      const val = arg.split("=")[1];
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit value: ${val}`);
      }
      limit = parsed;
    } else if (arg === "--max-pages") {
      const val = argv[++i];
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new Error(`Invalid --max-pages value: ${val}`);
      }
      maxPages = parsed;
    } else if (arg.startsWith("--max-pages=")) {
      const val = arg.split("=")[1];
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new Error(`Invalid --max-pages value: ${val}`);
      }
      maxPages = parsed;
    } else if (arg === "--convex-url") {
      convexUrl = argv[++i];
    } else if (arg.startsWith("--convex-url=")) {
      convexUrl = arg.split("=")[1];
    } else if (arg === "--deployment") {
      deployment = argv[++i];
    } else if (arg.startsWith("--deployment=")) {
      deployment = arg.split("=")[1];
    } else if (arg === "--env-file") {
      envFile = argv[++i];
    } else if (arg.startsWith("--env-file=")) {
      envFile = arg.split("=")[1];
    } else if (arg === "--repo-root") {
      repoRoot = argv[++i];
    } else if (arg.startsWith("--repo-root=")) {
      repoRoot = arg.split("=")[1];
    } else if (arg === "--allow-production") {
      allowProduction = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "-h" || arg === "--help") {
      console.log(`
Usage: verify-company-key-projection-full-scan.ts --target-role local|preview|production [options]

Required:
  --target-role <role>   Role of target deployment: 'local', 'preview', or 'production'

Options:
  --limit <n>            Read-only query page size per call (default: 200)
  --max-pages <n>        Maximum pages to traverse (default: 100)
  --convex-url <url>     Convex deployment URL (or CONVEX_URL env)
  --deployment <sel>     Convex deployment selector (e.g. dev, preview, or deployment name)
  --env-file <path>      Path to environment file (safely reads only target selectors)
  --repo-root <path>     Workspace repository root path
  --allow-production     Explicit acknowledgement required when --target-role is production
  --json                 Output evidence JSON to stdout
  -h, --help             Show this help message
      `);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!targetRole) {
    throw new Error("Flag --target-role local|preview|production is required.");
  }

  if (allowProduction && targetRole !== "production") {
    throw new Error("--allow-production can only be used with --target-role production.");
  }

  if (targetRole !== "local" && !convexUrl && !deployment && !envFile) {
    throw new Error(
      `An explicit target selector (--convex-url, --deployment, or --env-file) is required for --target-role ${targetRole}.`,
    );
  }

  return {
    targetRole,
    limit,
    maxPages,
    pageSize: limit,
    convexUrl,
    deployment,
    envFile,
    repoRoot,
    allowProduction,
    json,
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const { exitCode, evidence } = await runFullScan({ options });

  if (options.json) {
    console.log(JSON.stringify(evidence, null, 2));
  } else {
    console.log(`Company-Key Projection Full Scan Evidence:`);
    console.log(`  Schema:       ${evidence.schema} (${evidence.schemaVersion})`);
    console.log(`  App Version:  ${evidence.appVersion}`);
    console.log(`  Target Role:  ${evidence.targetRole}`);
    console.log(`  Status:       ${evidence.status}`);
    console.log(`  Exit Code:    ${evidence.exitCode}`);
    console.log(`  Target Epoch: ${evidence.targetEpoch} (current: ${evidence.currentEpoch})`);
    console.log(`  Pages:        ${evidence.summary.pages}`);
    console.log(`  Scanned Rows: ${evidence.summary.scannedRows}`);
    console.log(`  Stale Count:  ${evidence.summary.staleCount}`);
    console.log(`  Missing:      ${evidence.summary.missingCount}`);
    console.log(`  Lagging:      ${evidence.summary.laggingCount}`);
    console.log(`  Scan Complete:${evidence.summary.scanComplete}`);
    if (evidence.errors && evidence.errors.length > 0) {
      console.error(`  Errors:`);
      for (const err of evidence.errors) {
        console.error(`    - ${err}`);
      }
    }
  }

  process.exit(exitCode);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`Unexpected failure: ${(err as Error).message}`);
    process.exit(EXIT_CONFIG_OR_INVOCATION_ERROR);
  });
}
