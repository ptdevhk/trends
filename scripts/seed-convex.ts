import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { parse as parseYaml } from "yaml";

type SeedStatus = {
  jobDescriptions: number;
  resumes: number;
  collectionTasks: number;
  isEmpty: boolean;
};

type SeedJobDescription = {
  title: string;
  content: string;
  type: "system" | "custom";
};

type SeedResume = {
  externalId: string;
  content: Record<string, unknown>;
  hash: string;
  source: string;
  tags: string[];
};

type SeedResult = {
  inserted: number;
  skipped: number;
};

type CliOptions = {
  withResumes: boolean;
  force: boolean;
  checkOnly: boolean;
};

const seedStatusFunction = makeFunctionReference<"query", Record<string, never>, SeedStatus>("seed:status");
const seedJobDescriptionsFunction = makeFunctionReference<"mutation", { items: SeedJobDescription[] }, SeedResult>("seed:seedJobDescriptions");
const seedResumesFunction = makeFunctionReference<"mutation", { resumes: SeedResume[] }, SeedResult>("seed:seedResumes");

function printUsage(): void {
  console.log("Usage: seed-convex.ts [--with-resumes] [--force] [--check-only]");
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    withResumes: false,
    force: false,
    checkOnly: false,
  };

  for (const arg of argv) {
    if (arg === "--with-resumes") {
      options.withResumes = true;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--check-only") {
      options.checkOnly = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    console.error(`Unknown flag: ${arg}`);
    printUsage();
    process.exit(1);
  }

  return options;
}

function resolveProjectRoot(): string {
  const scriptPath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(scriptPath), "..");
}

function readEnvVarFromFile(filePath: string, key: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }
    if (match[1] !== key) {
      continue;
    }

    let value = match[2].trim();
    const hasDoubleQuotes = value.startsWith("\"") && value.endsWith("\"");
    const hasSingleQuotes = value.startsWith("'") && value.endsWith("'");
    if (hasDoubleQuotes || hasSingleQuotes) {
      value = value.slice(1, -1);
    }
    return value;
  }

  return null;
}

function resolveConvexUrl(projectRoot: string): string {
  if (process.env.CONVEX_URL) {
    return process.env.CONVEX_URL;
  }
  if (process.env.VITE_CONVEX_URL) {
    return process.env.VITE_CONVEX_URL;
  }

  const webEnvPath = path.join(projectRoot, "apps", "web", ".env.local");
  const packageEnvPath = path.join(projectRoot, "packages", "convex", ".env.local");

  const webEnvUrl = readEnvVarFromFile(webEnvPath, "VITE_CONVEX_URL")
    ?? readEnvVarFromFile(webEnvPath, "CONVEX_URL");
  if (webEnvUrl) {
    return webEnvUrl;
  }

  const packageEnvUrl = readEnvVarFromFile(packageEnvPath, "CONVEX_URL")
    ?? readEnvVarFromFile(packageEnvPath, "VITE_CONVEX_URL");
  if (packageEnvUrl) {
    return packageEnvUrl;
  }

  return "http://127.0.0.1:3210";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    return {};
  }

  let frontmatterEnd = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      frontmatterEnd = i;
      break;
    }
  }

  if (frontmatterEnd === -1) {
    return {};
  }

  const frontmatterYaml = lines.slice(1, frontmatterEnd).join("\n");
  try {
    const parsed = parseYaml(frontmatterYaml);
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    console.error("Failed to parse frontmatter YAML:");
    console.error(error);
    return {};
  }
}

function extractTitle(content: string, fallback: string): string {
  const frontmatter = parseFrontmatter(content);
  const frontmatterTitle = frontmatter.title;
  if (typeof frontmatterTitle === "string" && frontmatterTitle.trim()) {
    return frontmatterTitle.trim();
  }

  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      return trimmed.replace(/^#\s+/, "").trim();
    }
  }

  return fallback;
}

function loadJobDescriptions(projectRoot: string): SeedJobDescription[] {
  const jobDescriptionDir = path.join(projectRoot, "config", "job-descriptions");
  if (!fs.existsSync(jobDescriptionDir)) {
    return [];
  }

  const files = fs.readdirSync(jobDescriptionDir)
    .filter((filename) => filename.endsWith(".md"))
    .filter((filename) => filename.toLowerCase() !== "readme.md")
    .sort();

  return files.map((filename) => {
    const filePath = path.join(jobDescriptionDir, filename);
    const content = fs.readFileSync(filePath, "utf8");
    const fallbackTitle = filename.replace(/\.md$/i, "");
    const title = extractTitle(content, fallbackTitle);
    const jobDescription: SeedJobDescription = {
      title,
      content,
      type: "system",
    };
    return jobDescription;
  });
}

function readStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function resolveResumeExternalId(resume: Record<string, unknown>, index: number): string {
  const keyCandidates = ["externalId", "resumeId", "perUserId"];
  for (const key of keyCandidates) {
    const candidate = readStringField(resume, key);
    if (candidate) {
      return candidate;
    }
  }

  const profileUrl = readStringField(resume, "profileUrl");
  if (profileUrl && profileUrl !== "javascript:;") {
    return profileUrl;
  }

  const name = readStringField(resume, "name") ?? "resume";
  const extractedAt = readStringField(resume, "extractedAt");
  if (extractedAt) {
    return `${name}-${extractedAt}`;
  }

  return `sample-initial-${index + 1}`;
}

function extractResumesFromPayload(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  if (!isRecord(payload)) {
    return [];
  }

  const data = payload.data;
  if (Array.isArray(data)) {
    return data.filter(isRecord);
  }

  const resumes = payload.resumes;
  if (Array.isArray(resumes)) {
    return resumes.filter(isRecord);
  }

  return [];
}

function extractResumeSource(payload: unknown): string {
  if (!isRecord(payload)) {
    return "sample-initial";
  }

  const metadata = payload.metadata;
  if (!isRecord(metadata)) {
    return "sample-initial";
  }

  const sourceUrl = metadata.sourceUrl;
  if (typeof sourceUrl !== "string" || !sourceUrl.trim()) {
    return "sample-initial";
  }

  if (URL.canParse(sourceUrl)) {
    const hostname = new URL(sourceUrl).hostname;
    if (hostname) {
      return hostname;
    }
  }

  return sourceUrl;
}

function loadSampleResumes(projectRoot: string): SeedResume[] {
  const samplePath = path.join(projectRoot, "output", "resumes", "samples", "sample-initial.json");
  if (!fs.existsSync(samplePath)) {
    throw new Error(`Resume sample file not found: ${samplePath}`);
  }

  const raw: unknown = JSON.parse(fs.readFileSync(samplePath, "utf8"));
  const source = extractResumeSource(raw);
  const resumes = extractResumesFromPayload(raw).slice(0, 100);

  return resumes.map((resume, index) => {
    const externalId = resolveResumeExternalId(resume, index);
    const hash = crypto.createHash("sha256").update(JSON.stringify(resume), "utf8").digest("hex");
    return {
      externalId,
      content: resume,
      hash,
      source,
      tags: ["sample-initial", "seed"],
    };
  });
}

function chunkItems<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function printStatus(status: SeedStatus): void {
  console.log(
    `Database status: jobDescriptions=${status.jobDescriptions}, resumes=${status.resumes}, collectionTasks=${status.collectionTasks}, isEmpty=${status.isEmpty}`
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = resolveProjectRoot();
  const convexUrl = resolveConvexUrl(projectRoot);
  const client = new ConvexHttpClient(convexUrl);

  console.log(`Connecting to Convex at ${convexUrl}...`);
  const currentStatus = await client.query(seedStatusFunction, {});
  printStatus(currentStatus);

  if (options.checkOnly) {
    console.log(`SEED_IS_EMPTY=${currentStatus.isEmpty ? "true" : "false"}`);
    return;
  }

  if (!options.force && !currentStatus.isEmpty) {
    console.log("Database has data. Skipping seed.");
    return;
  }

  const jobDescriptions = loadJobDescriptions(projectRoot);
  if (jobDescriptions.length === 0) {
    throw new Error("No job descriptions found in config/job-descriptions");
  }

  console.log(`Seeding ${jobDescriptions.length} job descriptions...`);
  const jdResult = await client.mutation(seedJobDescriptionsFunction, { items: jobDescriptions });
  console.log(`Job descriptions: inserted=${jdResult.inserted}, skipped=${jdResult.skipped}`);

  if (options.withResumes) {
    const resumes = loadSampleResumes(projectRoot);
    const batches = chunkItems(resumes, 50);
    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < batches.length; i += 1) {
      console.log(`Seeding resumes batch ${i + 1}/${batches.length} (${batches[i].length} records)...`);
      const batchResult = await client.mutation(seedResumesFunction, { resumes: batches[i] });
      inserted += batchResult.inserted;
      skipped += batchResult.skipped;
    }

    console.log(`Resumes: inserted=${inserted}, skipped=${skipped}`);
  }

  const finalStatus = await client.query(seedStatusFunction, {});
  printStatus(finalStatus);
}

main().catch((error) => {
  console.error("Convex seed failed:");
  console.error(error);
  process.exit(1);
});
