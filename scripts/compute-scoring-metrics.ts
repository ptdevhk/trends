/**
 * Compute AI scoring explainability metrics:
 * Spearman rank correlation, Pearson r, and MAE between AI scores and HR ratings.
 *
 * Reads candidate_actions (rating type) from SQLite via bun:sqlite,
 * joins with AI scores from a backup JSON or Convex export.
 *
 * Usage:
 *   bun run scripts/compute-scoring-metrics.ts
 *   bun run scripts/compute-scoring-metrics.ts --backup output/resume-backups/file.json
 */

import { Database } from "bun:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface RatingAction {
  resume_id: string;
  action_data: string; // JSON: { rating: number, scopeId: string }
}

interface ScoredResume {
  resumeId: string;
  score: number;
}

interface MetricsResult {
  n: number;
  spearmanRho: number;
  pearsonR: number;
  mae: number;
  meanScore: number;
  meanRating: number;
  confidence: "high" | "medium" | "low" | "insufficient";
}

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
  const sorted = values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let j = 0;
  while (j < sorted.length) {
    let k = j;
    while (k + 1 < sorted.length && sorted[k + 1].v === sorted[j].v) {
      k++;
    }
    const avgRank = (j + k) / 2 + 1;
    for (let t = j; t <= k; t++) {
      ranks[sorted[t].i] = avgRank;
    }
    j = k + 1;
  }
  return ranks;
}

function spearmanRho(xs: number[], ys: number[]): number {
  const n = xs.length;
  const xRanks = rank(xs);
  const yRanks = rank(ys);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    sumD2 += (xRanks[i] - yRanks[i]) ** 2;
  }
  return 1 - (6 * sumD2) / (n * (n ** 2 - 1));
}

function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  const denom = Math.sqrt(varX * varY);
  return denom === 0 ? 0 : cov / denom;
}

function mae(xs: number[], ys: number[]): number {
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += Math.abs(xs[i] - ys[i]);
  }
  return sum / xs.length;
}

function computeMetrics(scores: number[], ratings: number[]): MetricsResult {
  const n = scores.length;
  const rho = n >= 3 ? spearmanRho(scores, ratings) : 0;
  const r = n >= 3 ? pearsonR(scores, ratings) : 0;
  const maeVal = n > 0 ? mae(scores, ratings) : 0;
  const meanScore = n > 0 ? scores.reduce((a, b) => a + b, 0) / n : 0;
  const meanRating = n > 0 ? ratings.reduce((a, b) => a + b, 0) / n : 0;

  let confidence: MetricsResult["confidence"] = "insufficient";
  if (n >= 100) confidence = "high";
  else if (n >= 30) confidence = "medium";
  else if (n >= 5) confidence = "low";

  return { n, spearmanRho: rho, pearsonR: r, mae: maeVal, meanScore, meanRating, confidence };
}

function main() {
  const dbPath = resolve("output/resume_screening.db");
  if (!existsSync(dbPath)) {
    console.error("ERROR: SQLite database not found at", dbPath);
    console.error("Run this script from the repository root.");
    process.exit(1);
  }

  // Read ratings from SQLite
  const db = new Database(dbPath);
  const ratingRows = db
    .query("SELECT resume_id, action_data FROM candidate_actions WHERE action_type = 'rating'")
    .all() as RatingAction[];
  db.close();

  console.log(`Rating actions found: ${ratingRows.length}`);

  if (ratingRows.length === 0) {
    console.log("\nNo rating actions in the database. Metrics cannot be computed.");
    console.log("Ratings are captured when recruiters rate resumes in the search UI.");
    console.log("Re-run this script after accumulating rating data.");
    return;
  }

  // Parse ratings
  const ratingMap = new Map<string, number[]>();
  for (const row of ratingRows) {
    const rating = parseActionData(row.action_data);
    if (rating !== null) {
      const existing = ratingMap.get(row.resume_id) ?? [];
      existing.push(rating);
      ratingMap.set(row.resume_id, existing);
    }
  }

  // Average multiple ratings per resume
  const ratingsByResume = new Map<string, number>();
  for (const [resumeId, ratings] of ratingMap) {
    ratingsByResume.set(resumeId, ratings.reduce((a, b) => a + b, 0) / ratings.length);
  }

  console.log(`Unique resumes with ratings: ${ratingsByResume.size}`);

  // Try to load scores from backup
  const args = process.argv.slice(2);
  const backupIdx = args.indexOf("--backup");
  let scoredResumes: ScoredResume[] = [];

  if (backupIdx >= 0) {
    const backupPath = args[backupIdx + 1];
    if (!backupPath) {
      console.error("ERROR: --backup requires a file path argument");
      process.exit(1);
    }
    if (!existsSync(backupPath)) {
      console.error("ERROR: Backup file not found:", backupPath);
      process.exit(1);
    }
    console.log(`Loading scores from backup: ${backupPath}`);
    const raw = readFileSync(backupPath, "utf-8");
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.error("ERROR: Failed to parse backup JSON:", (err as Error).message);
      process.exit(1);
    }
    const resumes: Array<Record<string, unknown>> = (data.resumes as Array<Record<string, unknown>>) ?? [];
    for (const r of resumes) {
      const resumeId = (r.resumeId ?? r._id) as string | undefined;
      const analysis = r.analysis as Record<string, unknown> | undefined;
      const score = analysis?.score as number | undefined;
      if (resumeId && typeof score === "number" && Number.isFinite(score)) {
        scoredResumes.push({ resumeId, score });
      }
    }
  }

  console.log(`Resumes with AI scores in backup: ${scoredResumes.length}`);

  // Join scores with ratings using Map for O(1) lookup
  const scoreMap = new Map(scoredResumes.map((s) => [s.resumeId, s.score]));
  const pairs: Array<{ score: number; rating: number }> = [];
  for (const [resumeId, rating] of ratingsByResume) {
    const score = scoreMap.get(resumeId);
    if (score !== undefined) {
      pairs.push({ score, rating });
    }
  }

  console.log(`Matched score+rating pairs: ${pairs.length}`);

  if (pairs.length === 0) {
    console.log("\nNo matched score/rating pairs. Metrics cannot be computed.");
    console.log("To get AI scores, export resume data with analysis fields to a JSON file:");
    console.log("  bun run scripts/compute-scoring-metrics.ts --backup path/to/export.json");
    return;
  }

  const scores = pairs.map((p) => p.score);
  const ratings = pairs.map((p) => p.rating);
  const metrics = computeMetrics(scores, ratings);

  console.log("\n=== AI Scoring Metrics Report ===");
  console.log(`Sample size (N):           ${metrics.n}`);
  console.log(`Confidence:                ${metrics.confidence}`);
  console.log(`Mean AI score:             ${metrics.meanScore.toFixed(1)}`);
  console.log(`Mean HR rating:            ${metrics.meanRating.toFixed(1)}`);
  console.log(`Spearman rank correlation: ${metrics.spearmanRho.toFixed(4)}`);
  console.log(`Pearson r:                 ${metrics.pearsonR.toFixed(4)}`);
  console.log(`MAE (mean absolute error): ${metrics.mae.toFixed(2)}`);

  // Interpretation guide
  console.log("\n--- Interpretation ---");
  console.log("Spearman ρ > 0.7: strong rank agreement (scoring is ordering correctly)");
  console.log("Spearman ρ 0.4-0.7: moderate agreement (scoring is directionally useful)");
  console.log("Spearman ρ < 0.4: weak agreement (scoring needs improvement)");
  console.log("MAE < 10: scores are within 10 points of ratings on average (tight)");
  console.log("MAE 10-20: moderate score-rating gap");
  console.log("MAE > 20: large gap (scoring may need recalibration)");

  if (metrics.confidence === "insufficient" || metrics.confidence === "low") {
    console.log(`\n⚠️  N=${metrics.n} is too small for reliable conclusions.`);
    console.log("Collect at least 30 ratings before making scoring changes based on these metrics.");
  }
}

main();
