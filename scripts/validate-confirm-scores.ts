/**
 * Validate L4 AI confirm scores against ground-truth HR ratings.
 *
 * Reads HR ratings from candidate_actions SQLite, calls confirmSearchResults
 * Convex action for the HR-rated resumes, and computes Spearman ρ between
 * AI confirm scores and human ratings.
 *
 * Usage:
 *   bun run scripts/validate-confirm-scores.ts
 *
 * Environment:
 *   CONVEX_URL  — Convex deployment URL (default: http://127.0.0.1:3210)
 *   Run from repository root.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:process";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";

interface RatingAction {
  resume_id: string;
  action_data: string;
}

interface MetricsResult {
  n: number;
  spearmanRho: number;
  passed: boolean;
  confidence: "high" | "medium" | "low" | "insufficient";
}

const THRESHOLD = 0.6;

function parseActionData(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw);
    const rating = Number(parsed.rating);
    return Number.isFinite(rating) ? rating : null;
  } catch {
    return null;
  }
}

function rank(values: number[]): number[] {
  const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let j = 0;
  while (j < sorted.length) {
    let k = j;
    while (k + 1 < sorted.length && sorted[k + 1].v === sorted[j].v) k++;
    const avgRank = (j + k) / 2 + 1;
    for (let t = j; t <= k; t++) ranks[sorted[t].i] = avgRank;
    j = k + 1;
  }
  return ranks;
}

function spearmanRho(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const xRanks = rank(xs);
  const yRanks = rank(ys);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) sumD2 += (xRanks[i] - yRanks[i]) ** 2;
  return 1 - (6 * sumD2) / (n * (n ** 2 - 1));
}

function computeMetrics(scores: number[], ratings: number[]): MetricsResult {
  const n = scores.length;
  const rho = n >= 3 ? spearmanRho(scores, ratings) : 0;
  let confidence: MetricsResult["confidence"] = "insufficient";
  if (n >= 100) confidence = "high";
  else if (n >= 30) confidence = "medium";
  else if (n >= 5) confidence = "low";
  return { n, spearmanRho: rho, passed: rho >= THRESHOLD, confidence };
}

async function main() {
  // 1. Read HR ratings from SQLite
  const dbPath = resolve("output/resume_screening.db");
  if (!existsSync(dbPath)) {
    console.error("ERROR: SQLite database not found at", dbPath);
    console.error("Run this script from the repository root.");
    process.exit(1);
  }

  const db = new Database(dbPath);
  const ratingRows = db
    .query("SELECT resume_id, action_data FROM candidate_actions WHERE action_type = 'rating'")
    .all() as RatingAction[];
  db.close();

  console.log(`HR rating actions found: ${ratingRows.length}`);

  if (ratingRows.length === 0) {
    console.log("\nNo rating data. Nothing to validate.");
    process.exit(0);
  }

  // Parse and average ratings per resume
  const ratingMap = new Map<string, number[]>();
  for (const row of ratingRows) {
    const rating = parseActionData(row.action_data);
    if (rating !== null) {
      const existing = ratingMap.get(row.resume_id) ?? [];
      existing.push(rating);
      ratingMap.set(row.resume_id, existing);
    }
  }
  const avgRatings = new Map<string, number>();
  for (const [resumeId, ratings] of ratingMap) {
    avgRatings.set(resumeId, ratings.reduce((a, b) => a + b, 0) / ratings.length);
  }

  console.log(`Unique resumes with HR ratings: ${avgRatings.size}`);

  if (avgRatings.size < 5) {
    console.log(
      `\nOnly ${avgRatings.size} rated resumes — too few for statistically significant validation.`,
    );
    console.log("Accumulate more HR ratings and re-run.");
    process.exit(0);
  }

  // 2. Connect to Convex and run confirm
  const convexUrl = process.env.CONVEX_URL || "http://127.0.0.1:3210";
  const client = new ConvexHttpClient(convexUrl);

  const resumeIds = Array.from(avgRatings.keys());
  console.log(`Calling confirmSearchResults for ${resumeIds.length} HR-rated resumes...`);

  // validateConfirmScores action takes workspaceId, resumeIds, query
  const results = await client.action(api.analyze.confirmSearchResults, {
    workspaceId: "default",
    resumeIds,
    query: "",
  });

  // confirmSearchResults returns { results: [{ resumeId, confirmedScore, confirmedRecommendation }], confirmed, skipped, budget }
  const payload = results as { results: Array<{ resumeId: string; confirmedScore: number }> };
  const confirmResults = payload.results ?? [];

  // 3. Match confirm scores with HR ratings
  const pairs: Array<{ score: number; rating: number }> = [];
  for (const r of confirmResults) {
    const rating = avgRatings.get(r.resumeId);
    if (rating !== undefined && typeof r.confirmedScore === "number") {
      pairs.push({ score: r.confirmedScore, rating });
    }
  }

  console.log(`Matched confirm + HR pairs: ${pairs.length}`);

  if (pairs.length < 5) {
    console.log(`\nOnly ${pairs.length} matched pairs — insufficient for validation.`);
    process.exit(0);
  }

  // 4. Compute metrics
  const scores = pairs.map((p) => p.score);
  const ratings = pairs.map((p) => p.rating);
  const metrics = computeMetrics(scores, ratings);

  // 5. Report
  console.log("\n=== L4 Confirm Score Validation Report ===");
  console.log(`Sample size (N):             ${metrics.n}`);
  console.log(`Confidence:                  ${metrics.confidence}`);
  console.log(`Spearman rank correlation:   ${metrics.spearmanRho.toFixed(4)}`);
  console.log(`Pass threshold (ρ ≥ ${THRESHOLD}):         ${metrics.passed ? "PASS" : "FAIL"}`);

  if (!metrics.passed) {
    console.log("\n⚠️  Confirm scores show significant drift from HR ratings.");
    console.log("   Review confirm prompt quality and consider recalibration.");
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
