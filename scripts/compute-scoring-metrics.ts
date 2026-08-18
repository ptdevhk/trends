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
import { computeMetrics, RANKING_K_VALUES } from "./lib/ranking-metrics";

interface RatingAction {
  resume_id: string;
  action_data: string; // JSON: { rating: number, scopeId: string }
}

interface ScoredResume {
  resumeId: string;
  score: number;
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
  console.log(`--- Ranking Quality ---`);
  const ndcgVals = [metrics.ndcg5, metrics.ndcg10, metrics.ndcg20];
  const recallVals = [metrics.recall5, metrics.recall10, metrics.recall20];
  for (let i = 0; i < RANKING_K_VALUES.length; i++) {
    console.log(`NDCG@${RANKING_K_VALUES[i]}:  ${ndcgVals[i].toFixed(4)}`);
  }
  for (let i = 0; i < RANKING_K_VALUES.length; i++) {
    console.log(`Recall@${RANKING_K_VALUES[i]}: ${recallVals[i].toFixed(4)}`);
  }

  // Interpretation guide
  console.log("\n--- Interpretation ---");
  console.log("Spearman ρ > 0.7: strong rank agreement (scoring is ordering correctly)");
  console.log("Spearman ρ 0.4-0.7: moderate agreement (scoring is directionally useful)");
  console.log("Spearman ρ < 0.4: weak agreement (scoring needs improvement)");
  console.log("MAE < 10: scores are within 10 points of ratings on average (tight)");
  console.log("MAE 10-20: moderate score-rating gap");
  console.log("MAE > 20: large gap (scoring may need recalibration)");
  console.log("NDCG@K range 0-1: 1 = perfect ranking by AI score vs HR rating relevance");
  console.log("NDCG@K > 0.8: top-K ranking is near-optimal (best candidates ranked first)");
  console.log("Recall@K: fraction of all rated candidates captured in top K by AI score");

  if (metrics.confidence === "insufficient" || metrics.confidence === "low") {
    console.log(`\n⚠️  N=${metrics.n} is too small for reliable conclusions.`);
    console.log("Collect at least 30 ratings before making scoring changes based on these metrics.");
  }
}

main();
