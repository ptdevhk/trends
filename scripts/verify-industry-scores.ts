/**
 * Temporary verification script: compare AI scores vs rule-based scores
 * for all resumes in Convex. Validates that primaryRuleScore is more
 * accurate than AI scoring for industry_db + verified exp dimensions.
 *
 * Usage: npx tsx scripts/verify-industry-scores.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ConvexHttpClient } from "convex/browser";

import { api } from "../packages/convex/convex/_generated/api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

function readEnvVarFromFile(
  filePath: string,
  varName: string,
): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    const key = trimmed.slice(0, eqIdx).trim();
    if (key !== varName) {
      continue;
    }
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

function resolveConvexUrl(): string {
  if (process.env.CONVEX_URL) {
    return process.env.CONVEX_URL;
  }
  if (process.env.VITE_CONVEX_URL) {
    return process.env.VITE_CONVEX_URL;
  }

  const candidateFiles = [
    path.join(PROJECT_ROOT, "packages", "convex", ".env.local"),
    path.join(PROJECT_ROOT, "apps", "web", ".env.local"),
    path.join(PROJECT_ROOT, ".env.local"),
    path.join(PROJECT_ROOT, ".env"),
  ];

  for (const filePath of candidateFiles) {
    const direct = readEnvVarFromFile(filePath, "CONVEX_URL");
    if (direct) {
      return direct;
    }
    const vite = readEnvVarFromFile(filePath, "VITE_CONVEX_URL");
    if (vite) {
      return vite;
    }
  }

  return "http://127.0.0.1:3210";
}

type RoleSignal = {
  type: string;
  matchedSignals: string[];
  signalCount: number;
  occurrences: number;
  years: number;
  industryVerifiedYears?: number;
  verifyIn: string;
};

type ResumeDoc = {
  _id: string;
  content?: {
    name?: string;
    workHistory?: Array<{ raw: string }>;
  };
  ingestData?: {
    companyHits?: string[];
    roleSignals?: RoleSignal[];
    ruleScores?: Record<string, number>;
  };
  primaryRuleScore?: number;
  analysis?: {
    score?: number;
    summary?: string;
    highlights?: string[];
  };
};

async function main() {
  const convexUrl = resolveConvexUrl();
  console.log(`Using Convex URL: ${convexUrl}\n`);

  const client = new ConvexHttpClient(convexUrl);

  const resumes = (await client.query(api.resumes.list, {
    limit: 200,
  })) as unknown as ResumeDoc[];

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
    "Name".padEnd(20) +
      "AI Score".padEnd(12) +
      "Rule Score".padEnd(12) +
      "Verified Yrs".padEnd(14) +
      "Company Hits".padEnd(30) +
      "Delta",
  );
  console.log("-".repeat(100));

  for (const row of rows) {
    console.log(
      row.name.slice(0, 18).padEnd(20) +
        String(row.aiScore).padEnd(12) +
        String(row.ruleScore).padEnd(12) +
        String(row.verifiedYears).padEnd(14) +
        (row.companyHits.length > 0
          ? row.companyHits.join(",").slice(0, 28)
          : "(none)"
        ).padEnd(30) +
        row.delta,
    );
  }

  client.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
