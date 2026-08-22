/**
 * Manual verification helper for persisted ingest scoring.
 *
 * Default mode prints a score summary for resumes already in Convex.
 * Round-trip mode imports a sample into the API, triggers re-ingest,
 * then waits until persisted ingest fields appear in Convex.
 *
 * Usage:
 *   npx tsx scripts/verify-industry-scores.ts
 *   npx tsx scripts/verify-industry-scores.ts --sample sample-job5156-detail-enriched --round-trip
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { ConvexHttpClient } from "convex/browser";

import { api } from "../packages/convex/convex/_generated/api.js";
import {
  normalizeResumeImportPayload,
  resolveConvexUrl as resolveImportConvexUrl,
} from "../apps/api/src/services/resume-import-service.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CONVEX_URL = "http://127.0.0.1:3210";
const DEFAULT_API_BASE_URL = "http://localhost:3000";
const DEFAULT_LIMIT = 200;
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_POLL_MS = 3000;

type RoleSignal = {
  type: string;
  matchedSignals: string[];
  signalCount: number;
  occurrences: number;
  years: number;
  industryVerifiedYears?: number;
  verifyIn: string;
};

type IndustryDbV2RawComponents = {
  companyScore?: number;
  brandScore?: number;
  weightedBrandUnits?: number;
  uniqueCompanies?: number;
  brandUnitCount?: number;
};

type ResumeDoc = {
  _id: string;
  externalId?: string;
  content?: {
    name?: string;
    resumeId?: string;
    perUserId?: string;
    profileUrl?: string;
    workHistory?: Array<{ raw: string }>;
  };
  ingestData?: {
    companyHits?: string[];
    roleSignals?: RoleSignal[];
    ruleScores?: Record<string, number>;
    industryDbV2Raw?: number;
    industryDbV2RawComponents?: IndustryDbV2RawComponents;
    computedAt?: number;
    skillsVersion?: number;
  };
  primaryRuleScore?: number;
  analysis?: {
    score?: number;
    summary?: string;
    highlights?: string[];
  };
};

type CliOptions = {
  sample: string | null;
  roundTrip: boolean;
  convexUrl: string;
  apiBaseUrl: string;
  limit: number;
  timeoutMs: number;
  pollMs: number;
};

type ConvexListResponse = ResumeDoc[];

type ImportSummary = {
  submitted: number;
  inserted: number;
  updated: number;
  unchanged: number;
  deduped: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCliValue(flag: string): string | undefined {
  const fullFlag = `--${flag}`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === fullFlag) {
      return process.argv[index + 1];
    }
    if (arg.startsWith(`${fullFlag}=`)) {
      return arg.slice(fullFlag.length + 1);
    }
  }
  return undefined;
}

function hasCliFlag(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

function parsePositiveInteger(value: string | undefined, fallback: number, label: string): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function resolveApiBaseUrl(): string {
  if (process.env.TRENDS_API_URL?.trim()) {
    return process.env.TRENDS_API_URL.trim().replace(/\/$/, "");
  }
  return DEFAULT_API_BASE_URL;
}

function parseCliOptions(): CliOptions {
  return {
    sample: readCliValue("sample") ?? null,
    roundTrip: hasCliFlag("round-trip"),
    convexUrl: readCliValue("convex-url") ?? resolveImportConvexUrl() ?? DEFAULT_CONVEX_URL,
    apiBaseUrl: (readCliValue("api-base-url") ?? resolveApiBaseUrl()).replace(/\/$/, ""),
    limit: parsePositiveInteger(readCliValue("limit"), DEFAULT_LIMIT, "limit"),
    timeoutMs: parsePositiveInteger(readCliValue("timeout-ms"), DEFAULT_TIMEOUT_MS, "timeout-ms"),
    pollMs: parsePositiveInteger(readCliValue("poll-ms"), DEFAULT_POLL_MS, "poll-ms"),
  };
}

function toOptionalString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function normalizeExternalId(value: unknown): string | null {
  return toOptionalString(value);
}

function resolveSamplePath(sample: string): string {
  if (path.isAbsolute(sample)) {
    return sample;
  }
  if (sample.endsWith(".json")) {
    return path.join(PROJECT_ROOT, sample);
  }
  return path.join(PROJECT_ROOT, "output", "resumes", "samples", `${sample}.json`);
}

function readImportFile(sample: string): unknown {
  const samplePath = resolveSamplePath(sample);
  return JSON.parse(fs.readFileSync(samplePath, "utf-8")) as unknown;
}

function buildTargetKeys(source: string, resumes: Array<Record<string, unknown>>): Set<string> {
  const keys = new Set<string>();
  for (const resume of resumes) {
    const externalId = normalizeExternalId(resume.externalId);
    if (externalId) {
      keys.add(`externalId:${externalId}`);
    }

    const profileUrl = toOptionalString(resume.profileUrl);
    if (profileUrl) {
      keys.add(`profileUrl:${profileUrl}`);
    }

    const resumeId = toOptionalString(resume.resumeId);
    if (resumeId) {
      keys.add(`resumeId:${resumeId}`);
      keys.add(`externalId:${source}:resume:${resumeId}`);
    }

    const perUserId = toOptionalString(resume.perUserId);
    if (perUserId) {
      keys.add(`perUserId:${perUserId}`);
      keys.add(`externalId:${source}:user:${perUserId}`);
    }
  }
  return keys;
}

function getResumeMatchKeys(resume: ResumeDoc): string[] {
  const keys: string[] = [];
  const externalId = normalizeExternalId(resume.externalId);
  if (externalId) {
    keys.push(`externalId:${externalId}`);
  }
  const profileUrl = toOptionalString(resume.content?.profileUrl);
  if (profileUrl) {
    keys.push(`profileUrl:${profileUrl}`);
  }
  const resumeId = toOptionalString(resume.content?.resumeId);
  if (resumeId) {
    keys.push(`resumeId:${resumeId}`);
  }
  const perUserId = toOptionalString(resume.content?.perUserId);
  if (perUserId) {
    keys.push(`perUserId:${perUserId}`);
  }
  return keys;
}

function hasPersistedIngestData(resume: ResumeDoc): boolean {
  return typeof resume.ingestData?.computedAt === "number"
    && typeof resume.ingestData?.industryDbV2Raw === "number"
    && Number.isFinite(resume.ingestData.industryDbV2Raw);
}

function filterTargetResumes(resumes: ResumeDoc[], targetKeys: Set<string>): ResumeDoc[] {
  return resumes.filter((resume) => getResumeMatchKeys(resume).some((key) => targetKeys.has(key)));
}

function shouldTriggerReingest(summary: unknown): summary is ImportSummary {
  if (!isRecord(summary)) {
    return false;
  }
  return ["submitted", "inserted", "updated", "unchanged", "deduped"].every((key) => {
    const value = summary[key];
    return typeof value === "number" && Number.isFinite(value);
  });
}

function summarizeResumes(resumes: ResumeDoc[]): void {
  console.log(`Found ${resumes.length} resumes\n`);
  console.log("=".repeat(100));

  const rows: Array<{
    name: string;
    aiScore: number | string;
    ruleScore: number;
    companyHits: string[];
    verifiedYears: number;
    delta: string;
  }> = [];

  for (const resume of resumes) {
    const name = resume.content?.name ?? "(unknown)";
    const workHistory = resume.content?.workHistory ?? [];
    const companyHits = resume.ingestData?.companyHits ?? [];
    const roleSignals = resume.ingestData?.roleSignals ?? [];
    const ruleScores = resume.ingestData?.ruleScores ?? {};
    const primaryRuleScore = resume.primaryRuleScore ?? 0;
    const aiScore = resume.analysis?.score;

    const totalVerifiedYears = roleSignals.reduce(
      (sum, rs) => sum + (rs.industryVerifiedYears ?? 0),
      0,
    );

    console.log(`\n--- ${name} ---`);
    console.log(`  Work History (${workHistory.length} entries):`);
    for (const wh of workHistory.slice(0, 5)) {
      console.log(`    ${wh.raw.slice(0, 120)}`);
    }
    console.log(`  Company Hits: ${companyHits.length > 0 ? companyHits.join(", ") : "(none)"}`);
    console.log(`  Role Signals:`);
    for (const rs of roleSignals) {
      console.log(
        `    ${rs.type}: ${rs.years}y total, ${rs.industryVerifiedYears ?? 0}y verified, signals=${rs.matchedSignals.join(",")}`,
      );
    }
    console.log(`  Rule Scores: ${JSON.stringify(ruleScores)}`);
    console.log(`  Primary Rule Score: ${primaryRuleScore}`);
    console.log(`  AI Score: ${aiScore ?? "N/A"}`);
    console.log(`  Persisted industryDbV2Raw: ${resume.ingestData?.industryDbV2Raw ?? "N/A"}`);
    console.log(
      `  Persisted components: ${JSON.stringify(resume.ingestData?.industryDbV2RawComponents ?? {})}`,
    );

    const aiScoreNum = typeof aiScore === "number" ? aiScore : 0;
    const delta = aiScoreNum - primaryRuleScore;
    console.log(
      `  Delta (AI - Rule): ${delta > 0 ? "+" : ""}${delta.toFixed(0)}`,
    );

    rows.push({
      name,
      aiScore: aiScore ?? "N/A",
      ruleScore: primaryRuleScore,
      companyHits,
      verifiedYears: totalVerifiedYears,
      delta: typeof aiScore === "number" ? `${delta > 0 ? "+" : ""}${delta.toFixed(0)}` : "N/A",
    });
  }

  console.log("\n" + "=".repeat(100));
  console.log("\nSUMMARY TABLE:");
  console.log(
    "Name".padEnd(20)
      + "AI Score".padEnd(12)
      + "Rule Score".padEnd(12)
      + "Verified Yrs".padEnd(14)
      + "Company Hits".padEnd(30)
      + "Delta",
  );
  console.log("-".repeat(100));

  for (const row of rows) {
    console.log(
      row.name.slice(0, 18).padEnd(20)
        + String(row.aiScore).padEnd(12)
        + String(row.ruleScore).padEnd(12)
        + String(row.verifiedYears).padEnd(14)
        + (row.companyHits.length > 0
          ? row.companyHits.join(",").slice(0, 28)
          : "(none)").padEnd(30)
        + row.delta,
    );
  }
}

async function fetchResumes(client: ConvexHttpClient, limit: number): Promise<ConvexListResponse> {
  return (await client.query(api.resumes.list, {
    limit,
  })) as unknown as ConvexListResponse;
}

type AuthSession = {
  /** Cookie header value carrying the session + CSRF cookies. */
  cookieHeader: string;
  /** Value for the X-CSRF-Token header (required on non-GET with a session cookie). */
  csrfToken: string;
};

const AUTH_SESSION_COOKIE = "trends_session";
const AUTH_CSRF_COOKIE = "trends_csrf";

function parseAuthCookies(setCookie: string): AuthSession {
  const valueFor = (name: string): string | null => {
    const match = setCookie.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
    return match ? match[1] : null;
  };

  const session = valueFor(AUTH_SESSION_COOKIE);
  if (!session) {
    throw new Error(
      `Unable to parse session cookie (${AUTH_SESSION_COOKIE}) from Set-Cookie header: ${setCookie}`,
    );
  }

  const csrf = valueFor(AUTH_CSRF_COOKIE);
  if (!csrf) {
    throw new Error(
      `Login set no CSRF cookie (${AUTH_CSRF_COOKIE}); authenticated API calls would 403: ${setCookie}`,
    );
  }

  return {
    cookieHeader: `${AUTH_SESSION_COOKIE}=${session}; ${AUTH_CSRF_COOKIE}=${csrf}`,
    csrfToken: csrf,
  };
}

export async function postJson(url: string, body: unknown, auth?: AuthSession): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Workspace-Slug": "dev",
  };
  if (auth) {
    headers.Cookie = auth.cookieHeader;
    headers["X-CSRF-Token"] = auth.csrfToken;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed (${response.status}) for ${url}: ${text}`);
  }

  return response.json() as Promise<unknown>;
}

export async function loginAsAdmin(apiBaseUrl: string): Promise<AuthSession> {
  const username = "demo-admin";
  const password =
    process.env.AUTH_BOOTSTRAP_PASSWORD?.trim() || "admin123";

  const loginUrl = `${apiBaseUrl}/api/auth/login`;
  const response = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Workspace-Slug": "dev",
    },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Login failed (${response.status}) at ${loginUrl}: ${text}`);
  }

  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) {
    throw new Error(`Login succeeded but no Set-Cookie header received from ${loginUrl}`);
  }

  return parseAuthCookies(setCookie);
}

async function runRoundTrip(options: CliOptions): Promise<void> {
  if (!options.sample) {
    throw new Error("--round-trip requires --sample <sample-name-or-path>");
  }

  const client = new ConvexHttpClient(options.convexUrl);
  const payload = readImportFile(options.sample);
  const normalized = normalizeResumeImportPayload(payload);
  const targetKeys = buildTargetKeys(
    normalized.source,
    normalized.resumes as Array<Record<string, unknown>>,
  );

  if (normalized.resumes.length === 0) {
    throw new Error(`Sample ${options.sample} does not contain any resumes`);
  }

  console.log(`Using API base URL: ${options.apiBaseUrl}`);
  console.log(`Using Convex URL: ${options.convexUrl}`);

  console.log("Logging in as admin to obtain session cookies...");
  const auth = await loginAsAdmin(options.apiBaseUrl);

  console.log(`Importing sample: ${options.sample}`);

  const importResponse = await postJson(`${options.apiBaseUrl}/api/resumes/import`, payload, auth);
  console.log("Import response:", JSON.stringify(importResponse));

  if (shouldTriggerReingest(importResponse) && importResponse.inserted === 0 && importResponse.updated === 0) {
    console.log("Skipping explicit re-ingest because import did not add or update any resumes.");
  } else {
    const reingestResponse = await postJson(`${options.apiBaseUrl}/api/resumes/trigger-reingest`, {
      limit: options.limit,
    }, auth);
    console.log("Re-ingest response:", JSON.stringify(reingestResponse));
  }

  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() <= deadline) {
    const current = await fetchResumes(client, options.limit);
    const targets = filterTargetResumes(current, targetKeys);
    const persisted = targets.filter(hasPersistedIngestData);

    console.log(
      `Waiting for persisted ingest data: matched ${targets.length}/${normalized.resumes.length}, ready ${persisted.length}/${normalized.resumes.length}`,
    );

    if (targets.length >= normalized.resumes.length && persisted.length >= normalized.resumes.length) {
      console.log("\nRound-trip persistence verified.\n");
      summarizeResumes(targets);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, options.pollMs));
  }

  throw new Error(`Timed out waiting for persisted ingest data after ${options.timeoutMs}ms`);
}

async function main() {
  const options = parseCliOptions();

  if (options.roundTrip) {
    await runRoundTrip(options);
    return;
  }

  const client = new ConvexHttpClient(options.convexUrl);
  try {
    console.log(`Using Convex URL: ${options.convexUrl}\n`);
    const resumes = await fetchResumes(client, options.limit);
    summarizeResumes(resumes);
  } finally {
  }
}

const isMainModule = process.argv[1]
  ? path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
  : false;

if (isMainModule) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
