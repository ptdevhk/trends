import { execFile as execFileCallback } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { COLLECTION_GUARDS, applyCollectionGuards } from "@trends/shared";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { buildManualResumeImportPayload } from "../../apps/api/src/services/manual-resume-import-service.ts";
import { selectLatestWorkHistory } from "../../packages/shared/src/work-history-evidence.ts";
import {
  resolveApiUrl,
  resolveWorkspace,
  splitCsv,
  writePortableBackupFile,
} from "./operator-utils.ts";

const execFileAsync = promisify(execFileCallback);

const DEFAULT_COUNT = 50;
const DEFAULT_SEEK_COUNT = 20;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_CDP_ENDPOINT = "http://127.0.0.1:9222";
const DEFAULT_WAIT_TIMEOUT_SEC = 600;
const DEFAULT_OUT_DIR = "output/resume-backups";
const DEFAULT_MANUAL_FILE = "~/Downloads/51job.rar";
const DEFAULT_JOB5156_URL =
  "https://hr.job5156.com/search?keyword=CNC+%E9%94%80%E5%94%AE&tr_min_age=25&tr_max_age=40";
const DEFAULT_51JOB_URL =
  "https://ehire.51job.com/Revision/talent/search?keyword=CNC+%E9%94%80%E5%94%AE&tr_min_age=25&tr_max_age=40";
const DEFAULT_SEEK_URL =
  "https://hk.employer.seek.com/candidates/recommended?jobId=92216704";

// Default sources — these run when no --source flags are given.
// 51job-manual is excluded; it must be requested explicitly.
export const SOURCE_ALIASES = ["job5156", "seek", "51job"] as const;
export const OPTIONAL_SOURCE_ALIASES = [
  ...SOURCE_ALIASES,
  "51job-manual",
] as const;
export type SourceAlias = (typeof SOURCE_ALIASES)[number];
export type OptionalSourceAlias = (typeof OPTIONAL_SOURCE_ALIASES)[number];

/** The manual source must be opted into explicitly via --source 51job-manual. */
export const MANUAL_SOURCE = "51job-manual";

const SOURCE_HOSTS: Record<OptionalSourceAlias, string> = {
  job5156: "hr.job5156.com",
  seek: "hk.employer.seek.com",
  "51job": "ehire.51job.com",
  [MANUAL_SOURCE]: MANUAL_SOURCE,
};


type SnapshotCliArgs = {
  apiUrl: string;
  workspace: string;
  count: number;
  seekCount: number;
  maxPages: number;
  outDir: string;
  sources: OptionalSourceAlias[];
  job5156Url: string;
  job51Url: string;
  seekUrl: string;
  manualFile: string;
  cdpEndpoint: string;
  waitTimeoutSec: number;
  unsafeLimits: boolean;
};

export type SnapshotOptions = SnapshotCliArgs & {
  repoRoot: string;
};

type ResumeBackupEnvelope = {
  metadata?: Record<string, unknown>;
  resumes?: unknown[];
  data?: unknown[];
};

type ResumeImportPayload = {
  metadata: Record<string, unknown>;
  resumes: Record<string, unknown>[];
};

type BrowserCollectorSummary = {
  mode?: string;
  endpoint?: string;
  source?: string;
  sourceHost?: string;
  url?: string;
  status?: Record<string, unknown>;
  payload?: ResumeBackupEnvelope;
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

type ExecOptions = {
  cwd?: string;
};

type ExecResult = {
  stdout: string;
  stderr: string;
};

export type SnapshotSourceResult = {
  alias: OptionalSourceAlias;
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

export type SnapshotSkippedSource = {
  alias: OptionalSourceAlias;
  reason: string;
};

export type SnapshotRunSummary = {
  success: true;
  apiUrl: string;
  workspace: string;
  repoRoot: string;
  runStamp: string;
  outputDir: string;
  countPerSource: number;
  seekCount: number;
  sources: SnapshotSourceResult[];
  skipped: SnapshotSkippedSource[];
};

// Aliases that require browser collection (excludes the manual source).
type BrowserSourceAlias = SourceAlias;

type ManualSnapshotPayloadResult = {
  payload: ResumeBackupEnvelope;
  summary: ManualImportSummary;
};

type SnapshotRuntime = {
  now: () => Date;
  exec: (
    command: string,
    args: string[],
    options?: ExecOptions,
  ) => Promise<ExecResult>;
  log: (message: string) => void;
  buildManualSnapshotPayload?: (params: {
    archivePath: string;
    limit: number;
  }) => Promise<ManualSnapshotPayloadResult>;
  resolveUserHomeDirectory: (user?: string) => Promise<string>;
};

function usage(): string {
  return [
    "Usage: bun run scripts/resume/snapshot-source-backups.ts [options]",
    "",
    "Options:",
    "  --source <alias>           Repeatable source alias: job5156 | seek | 51job (51job-manual opt-in only)",
    `  --count <number>           Resumes per source (default: ${DEFAULT_COUNT})`,
    `  --seek-count <number>      Seek resumes per source (default: ${DEFAULT_SEEK_COUNT})`,
    `  --max-pages <number>       Browser pages per source collection (default: ${DEFAULT_MAX_PAGES})`,
    `  --api-url <url>            Retained for CLI compatibility (default: ${resolveApiUrl()})`,
    `  --workspace <slug>         Retained for CLI compatibility (default: ${resolveWorkspace()})`,
    `  --out-dir <path>           Output directory (default: ${DEFAULT_OUT_DIR})`,
    `  --job5156-url <url>        Direct Job5156 source URL (default: ${DEFAULT_JOB5156_URL})`,
    `  --51job-url <url>          Direct 51job source URL (default: ${DEFAULT_51JOB_URL})`,
    `  --seek-url <url>           Direct SEEK source URL (default: ${DEFAULT_SEEK_URL})`,
    `  --manual-file <path>       Manual 51job archive path (default: ${DEFAULT_MANUAL_FILE})`,
    `  --cdp-endpoint <value>     Chrome DevTools endpoint or port (default: ${DEFAULT_CDP_ENDPOINT})`,
    `  --wait-timeout-sec <n>     Retained for CLI compatibility (default: ${DEFAULT_WAIT_TIMEOUT_SEC})`,
    "  --unsafe-limits            Allow live 51job launches to bypass extension safe caps",
    "  --open-browser             Deprecated no-op retained for CLI compatibility",
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

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function isOptionalSourceAlias(value: string): value is OptionalSourceAlias {
  return OPTIONAL_SOURCE_ALIASES.includes(value as OptionalSourceAlias);
}

export function resolveRequestedSources(values: string[]): SourceAlias[] {
  if (values.length === 0) {
    return [...SOURCE_ALIASES];
  }

  const normalized: OptionalSourceAlias[] = [];
  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value) {
      continue;
    }
    if (!isOptionalSourceAlias(value)) {
      throw new Error(
        `invalid source ${JSON.stringify(rawValue)} (expected ${OPTIONAL_SOURCE_ALIASES.join("|")})`,
      );
    }
    if (!normalized.includes(value)) {
      normalized.push(value);
    }
  }

  if (normalized.length === 0) {
    throw new Error("at least one valid --source value is required");
  }

  // Cast is safe: normalized only contains aliases from OPTIONAL_SOURCE_ALIASES,
  // all of which are valid SourceAlias members (MANUAL_SOURCE was validated above).
  return normalized as unknown as SourceAlias[];
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
    seekCount: parsePositiveInteger(
      readCliValue(argv, "seek-count"),
      DEFAULT_SEEK_COUNT,
    ),
    maxPages: parsePositiveInteger(
      readCliValue(argv, "max-pages"),
      DEFAULT_MAX_PAGES,
    ),
    outDir: readCliValue(argv, "out-dir")?.trim() || DEFAULT_OUT_DIR,
    sources: resolveRequestedSources(readCliValues(argv, "source")),
    job5156Url:
      readCliValue(argv, "job5156-url")?.trim() || DEFAULT_JOB5156_URL,
    job51Url: readCliValue(argv, "51job-url")?.trim() || DEFAULT_51JOB_URL,
    seekUrl: readCliValue(argv, "seek-url")?.trim() || DEFAULT_SEEK_URL,
    manualFile:
      readCliValue(argv, "manual-file")?.trim() || DEFAULT_MANUAL_FILE,
    cdpEndpoint:
      readCliValue(argv, "cdp-endpoint")?.trim() || DEFAULT_CDP_ENDPOINT,
    waitTimeoutSec: parsePositiveInteger(
      readCliValue(argv, "wait-timeout-sec"),
      DEFAULT_WAIT_TIMEOUT_SEC,
    ),
    unsafeLimits: hasCliFlag(argv, "unsafe-limits"),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readResumeRecords(
  payload: ResumeBackupEnvelope,
): Record<string, unknown>[] {
  return readResumeArray(payload)
    .filter(isRecord)
    .map((resume) => ({ ...resume }));
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

function buildOutputFilePath(
  runDir: string,
  alias: SourceAlias,
  count: number,
  runStamp: string,
): string {
  return path.join(
    runDir,
    `resume-backup-${alias}-top${count}-${runStamp}.json`,
  );
}

async function cleanupFile(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => undefined);
}

function resolveCollectorScriptPath(repoRoot: string): string {
  return path.join(repoRoot, "scripts", "resume", "collect_browser_source.py");
}

function buildBrowserCollectorParams(
  alias: BrowserSourceAlias,
  launchUrl: string,
  options: SnapshotOptions,
  runtime: SnapshotRuntime,
) {
  return {
    alias,
    launchUrl,
    count: options.count,
    maxPages: options.maxPages,
    cdpEndpoint: options.cdpEndpoint,
    repoRoot: options.repoRoot,
    runtime,
  };
}

function extractExecFailureDetail(
  failure: Error & { stderr?: string; stdout?: string },
): string {
  const candidateOutputs = [failure.stderr, failure.stdout, failure.message];

  for (const output of candidateOutputs) {
    if (typeof output !== "string") {
      continue;
    }

    const line = output
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .find(
        (value) =>
          value.length > 0 && !value.toLowerCase().startsWith("hint:"),
      );
    if (line) {
      return line.replace(/^Error:\s*/u, "");
    }
  }

  return "command failed";
}

async function runBrowserCollector(params: {
  alias: BrowserSourceAlias;
  launchUrl: string;
  count: number;
  maxPages: number;
  cdpEndpoint: string;
  repoRoot: string;
  runtime: SnapshotRuntime;
  checkOnly?: boolean;
}): Promise<BrowserCollectorSummary> {
  const args = [
    "run",
    "python",
    resolveCollectorScriptPath(params.repoRoot),
    "--source",
    params.alias,
    "--url",
    params.launchUrl,
    "--limit",
    String(params.count),
    "--max-pages",
    String(params.maxPages),
    "--cdp-endpoint",
    params.cdpEndpoint,
    ...(params.checkOnly ? ["--check-only"] : []),
  ];
  let result: ExecResult;
  try {
    result = await params.runtime.exec("uv", args, {
      cwd: params.repoRoot,
    });
  } catch (error) {
    const failure = error as Error & { stderr?: string; stdout?: string };
    throw new Error(
      `[${params.alias}] browser collector failed: ${extractExecFailureDetail(failure)}`,
    );
  }
  const stdout = result.stdout.trim();
  if (!stdout) {
    throw new Error(`[${params.alias}] browser collector returned no output`);
  }

  try {
    return JSON.parse(stdout) as BrowserCollectorSummary;
  } catch (error) {
    throw new Error(
      `[${params.alias}] browser collector returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizeCollectedImportPayload(
  alias: BrowserSourceAlias,
  payload: ResumeBackupEnvelope | undefined,
  runtime: SnapshotRuntime,
  sourceHostOverride?: string,
): ResumeImportPayload {
  if (!payload) {
    throw new Error(`[${alias}] collector did not return a payload`);
  }

  const sourceHost = sourceHostOverride || SOURCE_HOSTS[alias];
  const guardFields = COLLECTION_GUARDS[alias] || [];
  const resumes = readResumeRecords(payload).map((resume) =>
    applyCollectionGuards(
      {
        ...resume,
        sourceHost,
        ...(Array.isArray(resume.workHistory) && resume.workHistory.length > 0
          ? { workHistory: selectLatestWorkHistory(resume.workHistory) }
          : {}),
      },
      guardFields,
    ),
  );
  if (resumes.length === 0) {
    throw new Error(`[${alias}] collector returned zero resumes`);
  }

  const rawMetadata = isRecord(payload.metadata) ? payload.metadata : {};
  const sourceUrl =
    typeof rawMetadata.sourceUrl === "string"
      ? rawMetadata.sourceUrl.trim()
      : "";
  if (!sourceUrl) {
    throw new Error(
      `[${alias}] collector payload is missing metadata.sourceUrl`,
    );
  }

  return {
    metadata: {
      ...rawMetadata,
      sourceKey: alias,
      sourceHost,
      sourceUrl,
      generatedAt:
        typeof rawMetadata.generatedAt === "string" &&
        rawMetadata.generatedAt.trim()
          ? rawMetadata.generatedAt
          : runtime.now().toISOString(),
      totalResumes: resumes.length,
    },
    resumes,
  };
}

async function writeSnapshotPayloadToFile(params: {
  alias: SourceAlias;
  payload: ResumeBackupEnvelope;
  expectedCount: number;
  outFile: string;
  allowShortfall?: boolean;
}): Promise<number> {
  const count = readResumeRecords(params.payload).length;
  if (
    (params.allowShortfall === true && (count === 0 || count > params.expectedCount))
    || (params.allowShortfall !== true && count !== params.expectedCount)
  ) {
    throw new Error(
      `expected ${params.expectedCount} resumes in ${params.alias} snapshot, received ${count}`,
    );
  }

  try {
    await writePortableBackupFile(params.outFile, params.payload);
    return count;
  } catch (error) {
    await cleanupFile(params.outFile);
    throw error;
  }
}

async function buildManualSnapshotPayload(params: {
  archivePath: string;
  limit: number;
  runtime: SnapshotRuntime;
}): Promise<ManualSnapshotPayloadResult> {
  if (params.runtime.buildManualSnapshotPayload) {
    return await params.runtime.buildManualSnapshotPayload({
      archivePath: params.archivePath,
      limit: params.limit,
    });
  }

  const archiveData = await readFile(params.archivePath);
  const file = new File(
    [archiveData],
    path.basename(params.archivePath),
    { type: "application/octet-stream" },
  );
  const result = await buildManualResumeImportPayload({
    files: [file],
    limit: params.limit,
  });
  return {
    payload: result.payload,
    summary: result.summary,
  };
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
      const result = await exec("dscl", [
        ".",
        "-read",
        `/Users/${trimmed}`,
        "NFSHomeDirectory",
      ]);
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

function buildSourceLaunchUrl(
  alias: SourceAlias,
  options: SnapshotOptions,
): string | undefined {
  if (alias === "job5156") {
    return options.job5156Url;
  }
  if (alias === "51job") {
    const launchUrl = options.job51Url;
    if (!options.unsafeLimits) {
      return launchUrl;
    }
    const parsedUrl = new URL(launchUrl);
    parsedUrl.searchParams.set("tr_unsafe_limits", "1");
    return parsedUrl.toString();
  }
  if (alias === "seek") {
    return options.seekUrl;
  }
  return undefined;
}

function resolveSourceCount(alias: SourceAlias, options: SnapshotOptions): number {
  if (alias === "seek") {
    return Math.max(1, Math.min(options.count, options.seekCount));
  }
  return options.count;
}

export async function runSnapshotSourceBackups(
  options: SnapshotOptions,
  runtime: SnapshotRuntime = createRuntime(),
): Promise<SnapshotRunSummary> {
  const runStamp = formatRunStamp(runtime.now());
  const runDir = path.join(options.outDir, runStamp);
  await mkdir(runDir, { recursive: true });

  const manualArchivePath = options.sources.includes(MANUAL_SOURCE)
    ? await resolveUserFacingPath(options.manualFile, options.repoRoot, runtime)
    : undefined;

  if (manualArchivePath) {
    await access(manualArchivePath, constants.R_OK);
  }

  const results: SnapshotSourceResult[] = [];
  const skipped: SnapshotSkippedSource[] = [];

  for (const alias of options.sources) {
    let sourceHost = SOURCE_HOSTS[alias];
    let launchUrl: string | undefined;
    let manualImportSummary: ManualImportSummary | undefined;
    let snapshotPayload: ResumeBackupEnvelope;
    const sourceCount = resolveSourceCount(alias, options);

    try {
    if (alias !== MANUAL_SOURCE) {
      launchUrl = buildSourceLaunchUrl(alias, options);
      if (!launchUrl) {
        throw new Error(`missing launch URL for ${alias}`);
      }
      const browserCollectorParams = buildBrowserCollectorParams(
        alias,
        launchUrl,
        { ...options, count: sourceCount },
        runtime,
      );

      runtime.log(
        `[${alias}] checking Chrome DevTools at ${options.cdpEndpoint}`,
      );
      await runBrowserCollector({
        ...browserCollectorParams,
        checkOnly: true,
      });

      const collected = await runBrowserCollector(browserCollectorParams);
      const normalizedPayload = normalizeCollectedImportPayload(
        alias,
        collected.payload,
        runtime,
        collected.sourceHost,
      );
      const normalizedSourceHost = normalizedPayload.metadata.sourceHost;
      if (typeof normalizedSourceHost === "string" && normalizedSourceHost.trim()) {
        sourceHost = normalizedSourceHost;
      }
      runtime.log(
        `[${alias}] collected ${normalizedPayload.resumes.length} resumes`,
      );
      snapshotPayload = normalizedPayload;
    } else {
      if (!manualArchivePath) {
        throw new Error("manual archive path was not resolved");
      }
      runtime.log(`[51job-manual] parsing ${manualArchivePath}`);
      const manualSnapshot = await buildManualSnapshotPayload({
        archivePath: manualArchivePath,
        limit: sourceCount,
        runtime,
      });
      manualImportSummary = manualSnapshot.summary;
      snapshotPayload = manualSnapshot.payload;
    }

    const outFile = buildOutputFilePath(runDir, alias, sourceCount, runStamp);
    runtime.log(`[${alias}] writing snapshot file ${outFile}`);
    const snapshotCount = await writeSnapshotPayloadToFile({
      alias,
      payload: snapshotPayload,
      expectedCount: sourceCount,
      outFile,
      ...(alias === "seek" ? { allowShortfall: true } : {}),
    });

    results.push({
      alias,
      sourceHost,
      file: outFile,
      count: snapshotCount,
      ...(launchUrl ? { launchUrl } : {}),
      ...(manualArchivePath && alias === MANUAL_SOURCE
        ? { manualFile: manualArchivePath }
        : {}),
      resetCount: 0,
      resetPartial: false,
      observedCount: snapshotCount,
      ...(manualImportSummary ? { manualImportSummary } : {}),
    });
    } catch (sourceError) {
      const reason =
        sourceError instanceof Error ? sourceError.message : String(sourceError);
      runtime.log(`[${alias}] skipped: ${reason}`);
      skipped.push({ alias, reason });
    }
  }

  if (results.length === 0) {
    const reasons = skipped.map((s) => `[${s.alias}] ${s.reason}`).join("; ");
    throw new Error(`all sources failed: ${reasons}`);
  }

  return {
    success: true,
    apiUrl: options.apiUrl,
    workspace: options.workspace,
    repoRoot: options.repoRoot,
    runStamp,
    outputDir: runDir,
    countPerSource: options.count,
    seekCount: options.seekCount,
    sources: results,
    skipped,
  };
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
    exec,
    log: (message: string) => {
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
  const summary = await runSnapshotSourceBackups(
    {
      ...cliArgs,
      repoRoot,
      outDir,
    },
    runtime,
  );
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

export {
  DEFAULT_51JOB_URL,
  DEFAULT_JOB5156_URL,
  DEFAULT_MANUAL_FILE,
  DEFAULT_SEEK_URL,
  SOURCE_HOSTS,
};
