import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCallback);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_SAMPLE_REPO = "ptdevhk/trends-resume-samples";
const DEFAULT_BACKUPS_DIR = "output/resume-backups";

/**
 * Filename globs excluded from pushes by default.
 * `resume-backup-seek-top*.json` matches the seek recommended snapshot
 * (jobId-tied, time-limited per-position profile) but NOT the seek talentsearch
 * snapshot (`resume-backup-seek-talentsearch-*.json` breaks the `seek-top` prefix).
 */
export const DEFAULT_EXCLUDE_PATTERNS = ["resume-backup-seek-top*.json"];

function resolveRepoRoot(): string {
  return path.resolve(__dirname, "../..");
}

function resolveSampleRepo(): string {
  return process.env.SAMPLE_REPO?.trim() || DEFAULT_SAMPLE_REPO;
}

function resolveSnapshotDir(): string {
  const override = process.env.SNAPSHOT_DIR?.trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(resolveRepoRoot(), override);
  }
  return "";
}

/**
 * Resolve SNAPSHOT_EXCLUDE glob patterns. When unset (or blank) the built-in
 * default exclusion list applies; when set, the comma-separated patterns fully
 * replace the defaults.
 */
export function resolveExcludePatterns(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.SNAPSHOT_EXCLUDE?.trim();
  if (!raw) {
    return [...DEFAULT_EXCLUDE_PATTERNS];
  }
  return raw
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}

/** Compile a `*`/`?` filename glob into an anchored regex. */
export function compileGlobPattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
}

/** True when the file name matches any of the glob patterns. */
export function isExcludedFileName(fileName: string, patterns: string[]): boolean {
  return patterns.some((pattern) => compileGlobPattern(pattern).test(fileName));
}

export function filterSnapshotJsonFiles(
  fileNames: string[],
  patterns: string[],
): { included: string[]; excluded: string[] } {
  const included: string[] = [];
  const excluded: string[] = [];
  for (const fileName of fileNames) {
    if (isExcludedFileName(fileName, patterns)) {
      excluded.push(fileName);
    } else {
      included.push(fileName);
    }
  }
  return { included, excluded };
}

async function findLatestSnapshotDir(backupsDir: string): Promise<string> {
  const entries = await readdir(backupsDir, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => /^\d{8}-\d{6}$/.test(name))
    .sort();

  if (dirs.length === 0) {
    throw new Error(`no snapshot directories found in ${backupsDir}`);
  }

  for (let i = dirs.length - 1; i >= 0; i--) {
    const candidate = path.join(backupsDir, dirs[i]);
    const files = await readdir(candidate);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    if (jsonFiles.length > 0) {
      return candidate;
    }
  }

  throw new Error(`no snapshot directories with .json files found in ${backupsDir}`);
}

async function execGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function getGhToken(): Promise<string | null> {
  const envToken = process.env.GH_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function cloneSampleRepo(sampleRepo: string, tempDir: string): Promise<string> {
  const token = await getGhToken();
  const cloneUrl = token
    ? `https://x-access-token:${token}@github.com/${sampleRepo}.git`
    : `https://github.com/${sampleRepo}.git`;

  try {
    await execFileAsync("git", ["clone", "--depth=1", cloneUrl, tempDir]);
  } catch (e) {
    if (token) {
      throw Object.assign(new Error(`git clone failed for ${sampleRepo} — check gh auth status`), { cause: e });
    }
    throw e;
  }

  return cloneUrl;
}

interface SnapshotFile {
  name: string;
  resumeCount: number;
  source: string;
}

function parseResumeCount(raw: string): number {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const resumes = (parsed as Record<string, unknown>).resumes;
      if (Array.isArray(resumes)) return resumes.length;
      const data = (parsed as Record<string, unknown>).data;
      if (Array.isArray(data)) return data.length;
    }
    return 0;
  } catch {
    return 0;
  }
}

function extractSource(fileName: string): string {
  const match = /^resume-backup-(.+)-top\d+(?:-|\.json$)/.exec(fileName);
  return match ? match[1] : "unknown";
}

async function generateReadme(snapshotFiles: SnapshotFile[], timestamp: string): Promise<string> {
  const totalResumes = snapshotFiles.reduce((sum, f) => sum + f.resumeCount, 0);
  const lines = [
    "# Trends Resume Sample Snapshots",
    "",
    `Last updated: ${new Date().toISOString()}`,
    `Source timestamp: ${timestamp}`,
    `Total resume files: ${snapshotFiles.length}`,
    `Total resumes: ${totalResumes}`,
    "",
    "## Files",
    "",
    "| File | Source | Resumes |",
    "|------|--------|---------|",
  ];

  for (const f of snapshotFiles) {
    lines.push(`| ${f.name} | ${f.source} | ${f.resumeCount} |`);
  }

  lines.push("");
  lines.push("## Usage");
  lines.push("");
  lines.push("```bash");
  lines.push("# Pull snapshots into local environment");
  lines.push("make pull-sample-snapshots");
  lines.push("");
  lines.push("# Pull and restore in one step");
  lines.push("make restore-sample-snapshots");
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

export async function main(): Promise<void> {
  const repoRoot = resolveRepoRoot();
  const sampleRepo = resolveSampleRepo();
  const backupsDir = path.resolve(repoRoot, DEFAULT_BACKUPS_DIR);

  const snapshotDir = resolveSnapshotDir() || await findLatestSnapshotDir(backupsDir);
  const timestamp = path.basename(snapshotDir);

  console.log(`Snapshot dir: ${snapshotDir}`);
  console.log(`Sample repo:  ${sampleRepo}`);

  const snapshotFiles = await readdir(snapshotDir);
  const jsonFiles = snapshotFiles.filter((f) => f.endsWith(".json")).sort();

  if (jsonFiles.length === 0) {
    throw new Error(`no .json files found in ${snapshotDir}`);
  }

  const excludePatterns = resolveExcludePatterns();
  const { included: includedFiles, excluded: excludedFiles } = filterSnapshotJsonFiles(
    jsonFiles,
    excludePatterns,
  );
  if (includedFiles.length === 0) {
    throw new Error(
      `all snapshot files are excluded by SNAPSHOT_EXCLUDE patterns (${excludePatterns.join(", ")})`,
    );
  }
  if (excludePatterns.length > 0) {
    console.log(`Exclude patterns: ${excludePatterns.join(", ")}`);
  }
  for (const fileName of excludedFiles) {
    console.log(`Excluding ${fileName}`);
  }

  const tempDir = await mkdtemp("trends-push-samples-");
  try {
    console.log(`Cloning ${sampleRepo}...`);
    const pushUrl = await cloneSampleRepo(sampleRepo, tempDir);

    const snapshotsDir = path.join(tempDir, "snapshots");
    await mkdir(snapshotsDir, { recursive: true });

    const existingFiles = await readdir(snapshotsDir).catch(() => [] as string[]);
    for (const f of existingFiles) {
      await rm(path.join(snapshotsDir, f), { recursive: true, force: true });
    }

    const fileSummaries: SnapshotFile[] = [];
    for (const fileName of includedFiles) {
      const srcPath = path.join(snapshotDir, fileName);
      const destPath = path.join(snapshotsDir, fileName);
      const content = await readFile(srcPath, "utf8");
      await writeFile(destPath, content, "utf8");

      fileSummaries.push({
        name: fileName,
        resumeCount: parseResumeCount(content),
        source: extractSource(fileName),
      });
    }

    const readme = await generateReadme(fileSummaries, timestamp);
    await writeFile(path.join(tempDir, "README.md"), readme, "utf8");

    await execGit(["add", "-A"], tempDir);

    let hasChanges = false;
    try {
      await execGit(["diff", "--cached", "--quiet"], tempDir);
    } catch {
      hasChanges = true;
    }

    if (!hasChanges) {
      console.log("No changes to push — snapshots are up to date.");
      return;
    }

    await execGit(["commit", "-m", `Update sample snapshots from ${timestamp}`], tempDir);
    await execGit(["push", pushUrl, "main"], tempDir);

    console.log(`Pushed ${includedFiles.length} snapshot file(s) to ${sampleRepo}`);
    for (const f of fileSummaries) {
      console.log(`  ${f.name} (${f.source}, ${f.resumeCount} resumes)`);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function mkdtemp(prefix: string): Promise<string> {
  const dir = path.join(os.tmpdir(), prefix + Math.random().toString(36).slice(2));
  await mkdir(dir, { recursive: true });
  return dir;
}

const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (isMainModule) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
