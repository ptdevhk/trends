import { execFile as execFileCallback } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { resolveApiUrl, resolveWorkspace, splitCsv } from "./operator-utils.ts";

const execFileAsync = promisify(execFileCallback);

const DEFAULT_COUNT = 20;
const DEFAULT_WAIT_TIMEOUT_SEC = 600;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_OUT_DIR = "output/resume-backups";
const DEFAULT_MANUAL_FILE = "~/Downloads/51job.rar";
const DEFAULT_JOB5156_URL = "http://localhost:5173/dev/resumes?location=China&keyword=CNC+%E9%94%80%E5%94%AE&minAge=25&maxAge=40";
const DEFAULT_SEEK_URL = "http://localhost:5173/dev/resumes?location=Kuala+Lumpur+MY&keyword=CNC+Sales";

export const SOURCE_ALIASES = ["job5156", "seek", "51job-manual"] as const;
export type SourceAlias = (typeof SOURCE_ALIASES)[number];

const SOURCE_HOSTS: Record<SourceAlias, string> = {
  job5156: "hr.job5156.com",
  seek: "hk.employer.seek.com",
  "51job-manual": "51job-manual",
};

type SnapshotCliArgs = {
  apiUrl: string;
  workspace: string;
  count: number;
  outDir: string;
  sources: SourceAlias[];
  job5156Url: string;
  seekUrl: string;
  manualFile: string;
  waitTimeoutSec: number;
  openBrowser: boolean;
};

export type SnapshotOptions = SnapshotCliArgs & {
  repoRoot: string;
};

type ResumeBackupEnvelope = {
  metadata?: Record<string, unknown>;
  resumes?: unknown[];
  data?: unknown[];
};

type ResumeResetResponse = {
  success?: boolean;
  count?: number;
  partial?: boolean;
  deleted?: Record<string, number>;
};

type ManualImportSummary = {
  uploadedFiles?: number;
  discoveredFiles?: number;
  parsedResumes?: number;
  imported?: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  deduped?: number;
  skipped?: number;
  failed?: number;
};

type ManualImportResponse = {
  success?: boolean;
  error?: string;
  summary?: ManualImportSummary;
  warnings?: string[];
};

type ExecOptions = {
  cwd?: string;
};

type ExecResult = {
  stdout: string;
  stderr: string;
};

export type SnapshotSourceResult = {
  alias: SourceAlias;
  sourceHost: string;
  file: string;
  count: number;
  launchUrl?: string;
  manualFile?: string;
  resetCount: number;
  resetPartial: boolean;
  observedCount: number;
  manualImportSummary?: ManualImportSummary;
};

export type SnapshotRunSummary = {
  success: true;
  apiUrl: string;
  workspace: string;
  repoRoot: string;
  runStamp: string;
  outputDir: string;
  countPerSource: number;
  sources: SnapshotSourceResult[];
};

type SnapshotRuntime = {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  exec: (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;
  fetch: typeof fetch;
  promptEnter: (message: string) => Promise<void>;
  openUrl: (url: string) => Promise<void>;
  log: (message: string) => void;
  warn: (message: string) => void;
  resolveUserHomeDirectory: (user?: string) => Promise<string>;
};

type ResumeCountParams = {
  apiUrl: string;
  workspace: string;
  sourceHost?: string;
  limit: number;
  runtime: SnapshotRuntime;
};

function usage(): string {
  return [
    "Usage: tsx scripts/resume/snapshot-source-backups.ts [options]",
    "",
    "Options:",
    "  --source <alias>           Repeatable source alias: job5156 | seek | 51job-manual",
    `  --count <number>           Resumes per source (default: ${DEFAULT_COUNT})`,
    `  --api-url <url>            Trends API base URL (default: ${resolveApiUrl()})`,
    `  --workspace <slug>         Workspace slug (default: ${resolveWorkspace()})`,
    `  --out-dir <path>           Output directory (default: ${DEFAULT_OUT_DIR})`,
    `  --job5156-url <url>        Local dev launch URL for Job5156 (default: ${DEFAULT_JOB5156_URL})`,
    `  --seek-url <url>           Local dev launch URL for SEEK (default: ${DEFAULT_SEEK_URL})`,
    `  --manual-file <path>       Manual 51job archive path (default: ${DEFAULT_MANUAL_FILE})`,
    `  --wait-timeout-sec <n>     Wait timeout per source in seconds (default: ${DEFAULT_WAIT_TIMEOUT_SEC})`,
    "  --open-browser             Best-effort open the local launch URL before waiting",
    "  --help                     Show this help",
  ].join("\n");
}

function readCliValue(argv: string[], flag: string): string | undefined {
  const fullFlag = `--${flag}`;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === fullFlag) {
      return argv[index + 1];
    }
    if (arg.startsWith(`${fullFlag}=`)) {
      return arg.slice(fullFlag.length + 1);
    }
  }
  return undefined;
}

function readCliValues(argv: string[], flag: string): string[] {
  const fullFlag = `--${flag}`;
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === fullFlag) {
      values.push(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg.startsWith(`${fullFlag}=`)) {
      values.push(arg.slice(fullFlag.length + 1));
    }
  }
  return values.flatMap((value) => splitCsv(value));
}

function hasCliFlag(argv: string[], flag: string): boolean {
  return argv.includes(`--${flag}`);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function isSourceAlias(value: string): value is SourceAlias {
  return SOURCE_ALIASES.includes(value as SourceAlias);
}

export function resolveRequestedSources(values: string[]): SourceAlias[] {
  if (values.length === 0) {
    return [...SOURCE_ALIASES];
  }

  const normalized: SourceAlias[] = [];
  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value) {
      continue;
    }
    if (!isSourceAlias(value)) {
      throw new Error(`invalid source ${JSON.stringify(rawValue)} (expected ${SOURCE_ALIASES.join("|")})`);
    }
    if (!normalized.includes(value)) {
      normalized.push(value);
    }
  }

  if (normalized.length === 0) {
    throw new Error("at least one valid --source value is required");
  }

  return normalized;
}

export function parseCliArgs(argv: string[]): SnapshotCliArgs {
  if (hasCliFlag(argv, "help") || hasCliFlag(argv, "h")) {
    console.log(usage());
    process.exit(0);
  }

  return {
    apiUrl: readCliValue(argv, "api-url")?.trim() || resolveApiUrl(),
    workspace: readCliValue(argv, "workspace")?.trim() || resolveWorkspace(),
    count: parsePositiveInteger(readCliValue(argv, "count"), DEFAULT_COUNT),
    outDir: readCliValue(argv, "out-dir")?.trim() || DEFAULT_OUT_DIR,
    sources: resolveRequestedSources(readCliValues(argv, "source")),
    job5156Url: readCliValue(argv, "job5156-url")?.trim() || DEFAULT_JOB5156_URL,
    seekUrl: readCliValue(argv, "seek-url")?.trim() || DEFAULT_SEEK_URL,
    manualFile: readCliValue(argv, "manual-file")?.trim() || DEFAULT_MANUAL_FILE,
    waitTimeoutSec: parsePositiveInteger(readCliValue(argv, "wait-timeout-sec"), DEFAULT_WAIT_TIMEOUT_SEC),
    openBrowser: hasCliFlag(argv, "open-browser"),
  };
}

function resolveRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function readResumeArray(payload: ResumeBackupEnvelope): unknown[] {
  if (Array.isArray(payload.resumes)) {
    return payload.resumes;
  }
  if (Array.isArray(payload.data)) {
    return payload.data;
  }
  return [];
}

function formatRunStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function buildOutputFilePath(runDir: string, alias: SourceAlias, count: number, runStamp: string): string {
  return path.join(runDir, `resume-backup-${alias}-top${count}-${runStamp}.json`);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(responseText.trim() || `request failed (${response.status})`);
  }

  try {
    return JSON.parse(responseText) as T;
  } catch (error) {
    throw new Error(`invalid JSON response: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function postJson<T>(
  apiUrl: string,
  workspace: string,
  pathname: string,
  body: unknown,
  runtime: SnapshotRuntime,
): Promise<T> {
  const response = await runtime.fetch(`${apiUrl.replace(/\/$/, "")}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Workspace-Slug": workspace,
    },
    body: JSON.stringify(body),
  });
  return await parseJsonResponse<T>(response);
}

async function fetchResumeCount(params: ResumeCountParams): Promise<number> {
  const payload = await postJson<ResumeBackupEnvelope>(
    params.apiUrl,
    params.workspace,
    "/api/resumes/backup",
    {
      ...(params.sourceHost ? { sourceHosts: [params.sourceHost] } : {}),
      limit: params.limit,
    },
    params.runtime,
  );
  return readResumeArray(payload).length;
}

async function waitForResumeCount(params: {
  alias: SourceAlias | "all";
  apiUrl: string;
  workspace: string;
  sourceHost?: string;
  targetCount: number;
  timeoutMs: number;
  runtime: SnapshotRuntime;
  pollIntervalMs?: number;
}): Promise<number> {
  const deadline = Date.now() + params.timeoutMs;
  const pollIntervalMs = params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let lastCount: number | null = null;

  while (true) {
    const observed = await fetchResumeCount({
      apiUrl: params.apiUrl,
      workspace: params.workspace,
      sourceHost: params.sourceHost,
      limit: Math.max(params.targetCount, 1),
      runtime: params.runtime,
    });

    if (params.targetCount === 0 ? observed === 0 : observed >= params.targetCount) {
      return observed;
    }

    if (observed !== lastCount) {
      const scope = params.alias === "all" ? "all sources" : params.alias;
      params.runtime.log(`[${scope}] observed ${observed}/${params.targetCount} resumes`);
      lastCount = observed;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        params.targetCount === 0
          ? "timed out waiting for resume table to become empty"
          : `timed out waiting for ${params.alias} to reach ${params.targetCount} resumes`,
      );
    }

    await params.runtime.sleep(pollIntervalMs);
  }
}

function buildBrowserPrompt(alias: SourceAlias, launchUrl: string, count: number): string {
  if (alias === "seek") {
    return [
      `[seek] Open the local dev page and collect resumes from the SEEK lane:`,
      launchUrl,
      "",
      "Before clicking Collect, switch the source selector to SEEK.",
      "Use an account/session that stores imported rows as hk.employer.seek.com.",
      "",
      `Press Enter after the collection run has been triggered. The helper will wait for ${count} SEEK resumes.`,
    ].join("\n");
  }

  return [
    `[job5156] Open the local dev page and collect resumes from Job5156:`,
    launchUrl,
    "",
    "Use a logged-in browser with the Trends extension enabled, then click Collect.",
    "",
    `Press Enter after the collection run has been triggered. The helper will wait for ${count} Job5156 resumes.`,
  ].join("\n");
}

async function cleanupFile(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => undefined);
}

async function ensureCliBinary(repoRoot: string, runtime: SnapshotRuntime): Promise<string> {
  const cliPath = path.join(repoRoot, "bin", "trends");
  try {
    await access(cliPath, constants.X_OK);
    return cliPath;
  } catch {
    runtime.log("bin/trends is missing; building it with make cli-build");
  }

  await runtime.exec("make", ["cli-build"], { cwd: repoRoot });
  await access(cliPath, constants.X_OK);
  return cliPath;
}

async function backupSourceToFile(params: {
  alias: SourceAlias;
  sourceHost: string;
  count: number;
  apiUrl: string;
  workspace: string;
  cliPath: string;
  outFile: string;
  repoRoot: string;
  runtime: SnapshotRuntime;
}): Promise<number> {
  try {
    const result = await params.runtime.exec(
      params.cliPath,
      [
        "--api-url",
        params.apiUrl,
        "--workspace",
        params.workspace,
        "--output",
        "json",
        "resume",
        "backup",
        "--source-host",
        params.sourceHost,
        "--limit",
        String(params.count),
        "--out",
        params.outFile,
      ],
      { cwd: params.repoRoot },
    );

    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    const count = typeof parsed.count === "number" ? parsed.count : Number.NaN;
    if (!Number.isFinite(count)) {
      throw new Error(`backup summary for ${params.alias} did not include a numeric count`);
    }
    return count;
  } catch (error) {
    await cleanupFile(params.outFile);
    throw error;
  }
}

async function resetResumes(apiUrl: string, workspace: string, runtime: SnapshotRuntime): Promise<ResumeResetResponse> {
  return await postJson<ResumeResetResponse>(apiUrl, workspace, "/api/resumes/reset", {}, runtime);
}

async function importManualArchive(params: {
  apiUrl: string;
  workspace: string;
  archivePath: string;
  runtime: SnapshotRuntime;
}): Promise<ManualImportSummary | undefined> {
  const archiveData = await readFile(params.archivePath);
  const formData = new FormData();
  formData.append("files", new Blob([archiveData]), path.basename(params.archivePath));

  const response = await params.runtime.fetch(`${params.apiUrl.replace(/\/$/, "")}/api/resumes/manual-import`, {
    method: "POST",
    headers: {
      "X-Workspace-Slug": params.workspace,
    },
    body: formData,
  });

  const payload = await parseJsonResponse<ManualImportResponse>(response);
  if (payload.success !== true) {
    throw new Error(payload.error?.trim() || "manual import failed");
  }

  return payload.summary;
}

async function resolveSudoUserHome(
  user: string,
  exec: SnapshotRuntime["exec"],
): Promise<string | undefined> {
  const trimmed = user.trim();
  if (!trimmed) {
    return undefined;
  }

  if (process.platform === "darwin") {
    try {
      const result = await exec("dscl", [".", "-read", `/Users/${trimmed}`, "NFSHomeDirectory"]);
      const match = /NFSHomeDirectory:\s+(.+)/u.exec(result.stdout);
      if (match?.[1]) {
        return match[1].trim();
      }
    } catch {
      // fall through
    }
  }

  try {
    const result = await exec("getent", ["passwd", trimmed]);
    const entry = result.stdout.trim().split(":");
    if (entry.length >= 6 && entry[5]?.trim()) {
      return entry[5].trim();
    }
  } catch {
    // fall through
  }

  try {
    const passwd = await readFile("/etc/passwd", "utf8");
    const line = passwd
      .split(/\r?\n/u)
      .find((entry) => entry.startsWith(`${trimmed}:`));
    if (!line) {
      return undefined;
    }
    const columns = line.split(":");
    return columns.length >= 6 ? columns[5]?.trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveUserFacingPath(
  inputPath: string,
  repoRoot: string,
  runtime: Pick<SnapshotRuntime, "resolveUserHomeDirectory">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw new Error("path is required");
  }

  if (trimmed === "~" || trimmed.startsWith("~/")) {
    const home = await runtime.resolveUserHomeDirectory(env.SUDO_USER);
    return trimmed === "~" ? home : path.join(home, trimmed.slice(2));
  }

  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }

  return path.resolve(repoRoot, trimmed);
}

function buildSourceLaunchUrl(alias: SourceAlias, options: SnapshotOptions): string | undefined {
  if (alias === "job5156") {
    return options.job5156Url;
  }
  if (alias === "seek") {
    return options.seekUrl;
  }
  return undefined;
}

export async function runSnapshotSourceBackups(
  options: SnapshotOptions,
  runtime: SnapshotRuntime = createRuntime(),
): Promise<SnapshotRunSummary> {
  const runStamp = formatRunStamp(runtime.now());
  const runDir = path.join(options.outDir, runStamp);
  await mkdir(runDir, { recursive: true });

  const cliPath = await ensureCliBinary(options.repoRoot, runtime);
  const manualArchivePath = options.sources.includes("51job-manual")
    ? await resolveUserFacingPath(options.manualFile, options.repoRoot, runtime)
    : undefined;

  if (manualArchivePath) {
    await access(manualArchivePath, constants.R_OK);
  }

  const results: SnapshotSourceResult[] = [];

  for (const alias of options.sources) {
    const sourceHost = SOURCE_HOSTS[alias];
    runtime.log(`[${alias}] resetting resume tables`);
    const resetResult = await resetResumes(options.apiUrl, options.workspace, runtime);
    const resetCount = typeof resetResult.count === "number" ? resetResult.count : 0;
    const resetPartial = resetResult.partial === true;

    if (resetPartial) {
      runtime.log(`[${alias}] reset returned partial=true; waiting for the background delete batches to finish`);
    }

    await waitForResumeCount({
      alias: "all",
      apiUrl: options.apiUrl,
      workspace: options.workspace,
      targetCount: 0,
      timeoutMs: options.waitTimeoutSec * 1_000,
      runtime,
    });

    let launchUrl: string | undefined;
    let manualImportSummary: ManualImportSummary | undefined;

    if (alias === "51job-manual") {
      if (!manualArchivePath) {
        throw new Error("manual archive path was not resolved");
      }
      runtime.log(`[51job-manual] importing ${manualArchivePath}`);
      manualImportSummary = await importManualArchive({
        apiUrl: options.apiUrl,
        workspace: options.workspace,
        archivePath: manualArchivePath,
        runtime,
      });
    } else {
      launchUrl = buildSourceLaunchUrl(alias, options);
      if (!launchUrl) {
        throw new Error(`missing launch URL for ${alias}`);
      }

      if (options.openBrowser) {
        try {
          await runtime.openUrl(launchUrl);
          runtime.log(`[${alias}] opened ${launchUrl}`);
        } catch (error) {
          runtime.warn(
            `[${alias}] failed to open browser automatically: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      await runtime.promptEnter(buildBrowserPrompt(alias, launchUrl, options.count));
    }

    const observedCount = await waitForResumeCount({
      alias,
      apiUrl: options.apiUrl,
      workspace: options.workspace,
      sourceHost,
      targetCount: options.count,
      timeoutMs: options.waitTimeoutSec * 1_000,
      runtime,
    });

    const outFile = buildOutputFilePath(runDir, alias, options.count, runStamp);
    const backupCount = await backupSourceToFile({
      alias,
      sourceHost,
      count: options.count,
      apiUrl: options.apiUrl,
      workspace: options.workspace,
      cliPath,
      outFile,
      repoRoot: options.repoRoot,
      runtime,
    });

    if (backupCount !== options.count) {
      await cleanupFile(outFile);
      throw new Error(
        `expected ${options.count} resumes in ${alias} backup, received ${backupCount}`,
      );
    }

    results.push({
      alias,
      sourceHost,
      file: outFile,
      count: backupCount,
      ...(launchUrl ? { launchUrl } : {}),
      ...(manualArchivePath && alias === "51job-manual" ? { manualFile: manualArchivePath } : {}),
      resetCount,
      resetPartial,
      observedCount,
      ...(manualImportSummary ? { manualImportSummary } : {}),
    });
  }

  return {
    success: true,
    apiUrl: options.apiUrl,
    workspace: options.workspace,
    repoRoot: options.repoRoot,
    runStamp,
    outputDir: runDir,
    countPerSource: options.count,
    sources: results,
  };
}

async function defaultOpenUrl(url: string, exec: SnapshotRuntime["exec"]): Promise<void> {
  if (process.platform === "darwin") {
    await exec("open", [url]);
    return;
  }
  if (process.platform === "win32") {
    await exec("cmd", ["/c", "start", "", url]);
    return;
  }
  await exec("xdg-open", [url]);
}

function createRuntime(): SnapshotRuntime {
  const exec: SnapshotRuntime["exec"] = async (command, args, options) => {
    const result = await execFileAsync(command, args, {
      cwd: options?.cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };

  return {
    now: () => new Date(),
    sleep: async (ms: number) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
    exec,
    fetch: globalThis.fetch,
    promptEnter: async (message: string) => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error(message);
        return;
      }

      const interfaceHandle = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        await interfaceHandle.question(`${message}\n> `);
      } finally {
        interfaceHandle.close();
      }
    },
    openUrl: async (url: string) => {
      await defaultOpenUrl(url, exec);
    },
    log: (message: string) => {
      console.error(message);
    },
    warn: (message: string) => {
      console.error(message);
    },
    resolveUserHomeDirectory: async (user?: string) => {
      if (!user?.trim()) {
        return os.homedir();
      }
      const resolved = await resolveSudoUserHome(user, exec);
      return resolved || os.homedir();
    },
  };
}

async function main(): Promise<void> {
  const runtime = createRuntime();
  const cliArgs = parseCliArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRoot();
  const outDir = await resolveUserFacingPath(cliArgs.outDir, repoRoot, runtime);
  const summary = await runSnapshotSourceBackups({
    ...cliArgs,
    repoRoot,
    outDir,
  }, runtime);
  console.log(JSON.stringify(summary, null, 2));
}

const isMainModule = process.argv[1]
  ? path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
  : false;

if (isMainModule) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}

export { DEFAULT_JOB5156_URL, DEFAULT_MANUAL_FILE, DEFAULT_SEEK_URL, SOURCE_HOSTS };
