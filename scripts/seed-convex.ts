import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";
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

type SampleFile = {
  metadata?: {
    sourceUrl?: string;
  };
  data?: unknown;
};

function parseArgs(argv: string[]) {
  return {
    withResumes: argv.includes("--with-resumes"),
    force: argv.includes("--force"),
    checkOnly: argv.includes("--check-only"),
  };
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const result: Record<string, string> = {};
  const lines = fs.readFileSync(filePath, "utf8").split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function resolveConvexUrl(projectRoot: string): string {
  const fromEnv = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  if (fromEnv) {
    return fromEnv;
  }

  const webEnv = parseEnvFile(path.join(projectRoot, "apps", "web", ".env.local"));
  if (webEnv.CONVEX_URL || webEnv.VITE_CONVEX_URL) {
    return webEnv.CONVEX_URL ?? webEnv.VITE_CONVEX_URL;
  }

  const convexEnv = parseEnvFile(path.join(projectRoot, "packages", "convex", ".env.local"));
  if (convexEnv.CONVEX_URL || convexEnv.VITE_CONVEX_URL) {
    return convexEnv.CONVEX_URL ?? convexEnv.VITE_CONVEX_URL;
  }

  return "http://127.0.0.1:3210";
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    return {};
  }

  let frontmatterEnd = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === "---") {
      frontmatterEnd = i;
      break;
    }
  }

  if (frontmatterEnd === -1) {
    return {};
  }

  const yaml = lines.slice(1, frontmatterEnd).join("\n");
  try {
    const parsed = parseYaml(yaml);
    if (!isRecord(parsed)) {
      return {};
    }
    return parsed;
  } catch (error) {
    console.error("Failed to parse frontmatter YAML:", error);
    return {};
  }
}

function extractTitle(content: string, fallback: string): string {
  const frontmatter = parseFrontmatter(content);
  const title = frontmatter.title;
  if (typeof title === "string" && title.trim()) {
    return title.trim();
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
  const jobDescriptionsDir = path.join(projectRoot, "config", "job-descriptions");
  if (!fs.existsSync(jobDescriptionsDir)) {
    return [];
  }

  const files = fs
    .readdirSync(jobDescriptionsDir)
    .filter((file) => file.endsWith(".md"))
    .filter((file) => file.toLowerCase() !== "readme.md")
    .sort();

  return files.map((filename) => {
    const filePath = path.join(jobDescriptionsDir, filename);
    const content = fs.readFileSync(filePath, "utf8");
    const fallbackTitle = filename.replace(/\.md$/i, "");

    return {
      title: extractTitle(content, fallbackTitle),
      content,
      type: "system",
    };
  });
}

function getHash(input: unknown): string {
  return createHash("md5").update(JSON.stringify(input)).digest("hex");
}

function getSourceFromMetadata(metadata: SampleFile["metadata"]): string {
  const raw = metadata?.sourceUrl;
  if (!raw || typeof raw !== "string") {
    return "hr.job5156.com";
  }

  try {
    const url = new URL(raw);
    return url.hostname || "hr.job5156.com";
  } catch {
    return "hr.job5156.com";
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function loadResumes(projectRoot: string): SeedResume[] {
  const samplePath = path.join(projectRoot, "output", "resumes", "samples", "sample-initial.json");
  const raw = fs.readFileSync(samplePath, "utf8");
  const parsed: unknown = JSON.parse(raw);

  let rows: unknown[] = [];
  let source = "hr.job5156.com";

  if (Array.isArray(parsed)) {
    rows = parsed;
  } else if (isRecord(parsed)) {
    const sampleFile: SampleFile = parsed;
    source = getSourceFromMetadata(sampleFile.metadata);
    if (Array.isArray(sampleFile.data)) {
      rows = sampleFile.data;
    }
  }

  const resumes: SeedResume[] = [];

  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }

    const resumeId = row.resumeId;
    const perUserId = row.perUserId;
    const profileUrl = row.profileUrl;

    let externalId = "";
    if (typeof resumeId === "number" || typeof resumeId === "string") {
      externalId = String(resumeId);
    } else if (typeof perUserId === "number" || typeof perUserId === "string") {
      externalId = String(perUserId);
    } else if (typeof profileUrl === "string" && profileUrl.trim()) {
      externalId = profileUrl.trim();
    } else {
      externalId = getHash(row);
    }

    resumes.push({
      externalId,
      content: row,
      hash: getHash(row),
      source,
      tags: [],
    });
  }

  return resumes;
}

function isSeedStatus(input: unknown): input is SeedStatus {
  if (!isRecord(input)) {
    return false;
  }

  return (
    typeof input.jobDescriptions === "number" &&
    typeof input.resumes === "number" &&
    typeof input.collectionTasks === "number" &&
    typeof input.isEmpty === "boolean"
  );
}

function isSeedResult(input: unknown): input is { inserted: number; skipped: number } {
  if (!isRecord(input)) {
    return false;
  }

  return typeof input.inserted === "number" && typeof input.skipped === "number";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(path.join(scriptDir, ".."));
  const convexUrl = resolveConvexUrl(projectRoot);
  const client = new ConvexHttpClient(convexUrl);

  console.log(`Using Convex URL: ${convexUrl}`);

  const statusResponse: unknown = await client.query(api.seed.status);
  if (!isSeedStatus(statusResponse)) {
    throw new Error("Invalid seed status response from Convex.");
  }
  const status = statusResponse;
  console.log(`SEED_STATUS ${JSON.stringify(status)}`);

  if (args.checkOnly) {
    return;
  }

  const shouldSeed = args.force || status.isEmpty;
  if (!shouldSeed) {
    console.log("Database has data. Skipping seed.");
    return;
  }

  const jobDescriptions = loadJobDescriptions(projectRoot);
  if (jobDescriptions.length === 0) {
    console.log("No job descriptions found to seed.");
  } else {
    console.log(`Seeding ${jobDescriptions.length} job descriptions...`);
    const jdResponse: unknown = await client.mutation(api.seed.seedJobDescriptions, {
      jobDescriptions,
    });
    if (!isSeedResult(jdResponse)) {
      throw new Error("Invalid seedJobDescriptions response from Convex.");
    }
    const jdResult = jdResponse;
    console.log(`Job descriptions: inserted=${jdResult.inserted}, skipped=${jdResult.skipped}`);
  }

  if (!args.withResumes) {
    return;
  }

  const resumes = loadResumes(projectRoot);
  console.log(`Seeding ${resumes.length} resumes in batches of 50...`);

  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < resumes.length; i += 50) {
    const batch = resumes.slice(i, i + 50);
    const resultResponse: unknown = await client.mutation(api.seed.seedResumes, {
      resumes: batch,
    });
    if (!isSeedResult(resultResponse)) {
      throw new Error("Invalid seedResumes response from Convex.");
    }
    const result = resultResponse;
    inserted += result.inserted;
    skipped += result.skipped;
  }

  console.log(`Resumes: inserted=${inserted}, skipped=${skipped}`);
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
