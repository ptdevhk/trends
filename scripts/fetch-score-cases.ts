/**
 * Fetch real resume data to find matching (>80) and non-matching cases.
 * Usage: npx tsx scripts/fetch-score-cases.ts
 */
import { selectLatestWorkHistory } from "@trends/shared";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";

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
    industryTags?: string[];
    roleSignals?: RoleSignal[];
    ruleScores?: Record<string, number>;
  };
  primaryRuleScore?: number;
};

async function main() {
  const client = new ConvexHttpClient("http://127.0.0.1:3210");
  const resumes = (await client.query(api.resumes.list, {
    limit: 200,
  })) as unknown as ResumeDoc[];

  const rows = resumes.map((r) => ({
    name: r.content?.name ?? "(unknown)",
    companyHits: r.ingestData?.companyHits ?? [],
    industryTags: r.ingestData?.industryTags ?? [],
    roleSignals: r.ingestData?.roleSignals ?? [],
    ruleScores: r.ingestData?.ruleScores ?? {},
    primaryRuleScore: r.primaryRuleScore ?? 0,
    workHistory: selectLatestWorkHistory(r.content?.workHistory).map((w) => w.raw),
  }));

  rows.sort((a, b) => b.primaryRuleScore - a.primaryRuleScore);

  console.log("=== TOP 10 (highest primaryRuleScore) ===\n");
  for (const r of rows.slice(0, 10)) {
    console.log(`${r.name} — score: ${r.primaryRuleScore}`);
    console.log(`  Work: ${r.workHistory.map((w) => w.slice(0, 80)).join(" | ")}`);
    console.log(`  CompanyHits: ${r.companyHits.length > 0 ? r.companyHits.join(", ") : "(none)"}`);
    console.log(`  IndustryTags: ${r.industryTags.join(", ") || "(none)"}`);
    for (const rs of r.roleSignals) {
      console.log(`  RoleSignal ${rs.type}: ${rs.years}y total, ${rs.industryVerifiedYears ?? 0}y verified`);
    }
    console.log(`  RuleScores: ${JSON.stringify(r.ruleScores)}`);
    console.log();
  }

  console.log("\n=== SALES RESUMES WITH LOW SCORE (<30) ===\n");
  const salesLow = rows.filter(
    (r) => r.roleSignals.some((rs) => rs.type === "sales") && r.primaryRuleScore < 30
  );
  for (const r of salesLow.slice(0, 5)) {
    console.log(`${r.name} — score: ${r.primaryRuleScore}`);
    console.log(`  Work: ${r.workHistory.map((w) => w.slice(0, 80)).join(" | ")}`);
    console.log(`  CompanyHits: ${r.companyHits.length > 0 ? r.companyHits.join(", ") : "(none)"}`);
    for (const rs of r.roleSignals) {
      console.log(`  RoleSignal ${rs.type}: ${rs.years}y total, ${rs.industryVerifiedYears ?? 0}y verified`);
    }
    console.log();
  }

  console.log("\n=== RESUMES WITH COMPANY HITS ===\n");
  const withHits = rows.filter((r) => r.companyHits.length > 0);
  if (withHits.length === 0) {
    console.log("(none found)");
  }
  for (const r of withHits) {
    console.log(`${r.name} — score: ${r.primaryRuleScore}, hits: ${r.companyHits.join(", ")}`);
  }

  client.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
