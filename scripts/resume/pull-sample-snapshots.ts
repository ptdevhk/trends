import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCallback);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_SAMPLE_REPO = "ptdevhk/trends-resume-samples";
const DEFAULT_OUT_DIR = "output/resume-samples";

function resolveRepoRoot(): string {
  return path.resolve(__dirname, "../..");
}

function resolveSampleRepo(): string {
  return process.env.SAMPLE_REPO?.trim() || DEFAULT_SAMPLE_REPO;
}

function resolveOutDir(): string {
  const override = process.env.OUT_DIR?.trim();
  const resolved = override || DEFAULT_OUT_DIR;
  return path.isAbsolute(resolved) ? resolved : path.resolve(resolveRepoRoot(), resolved);
}

async function main(): Promise<void> {
  const repoRoot = resolveRepoRoot();
  const sampleRepo = resolveSampleRepo();
  const outDir = resolveOutDir();

  console.log(`Sample repo: ${sampleRepo}`);
  console.log(`Output dir:  ${outDir}`);

  const tempDir = await mkdtemp("trends-pull-samples-");
  try {
    console.log(`Cloning ${sampleRepo}...`);
    try {
      await execFileAsync("git", ["clone", "--depth=1", `https://github.com/${sampleRepo}.git`, tempDir]);
    } catch {
      // Private repos require auth; fall back to `gh repo clone` which uses
      // the GitHub CLI credential store (SSH key, token, etc.)
      console.log("git clone failed — trying gh repo clone for authenticated access...");
      await execFileAsync("gh", ["repo", "clone", sampleRepo, tempDir, "--", "--depth=1"]);
    }

    const snapshotsDir = path.join(tempDir, "snapshots");
    const files = await readdir(snapshotsDir).catch(() => [] as string[]);
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();

    if (jsonFiles.length === 0) {
      throw new Error(`no .json files found in snapshots/ directory of ${sampleRepo}`);
    }

    await mkdir(outDir, { recursive: true });

    for (const fileName of jsonFiles) {
      const srcPath = path.join(snapshotsDir, fileName);
      const destPath = path.join(outDir, fileName);
      const content = await readFile(srcPath, "utf8");
      await writeFile(destPath, content, "utf8");
      console.log(`  ${fileName}`);
    }

    console.log(`\nPulled ${jsonFiles.length} snapshot file(s) to ${outDir}`);
    console.log(`\nTo restore, run:\n  make restore-resumes FILE=${outDir}`);
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
