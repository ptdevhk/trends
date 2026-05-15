/**
 * Monitor AI score vs HR rating drift across all job descriptions.
 *
 * Queries candidate_actions (HR ratings) and resume_matches (AI scores) from
 * SQLite, computes Spearman rank correlation, and logs results to JSONL.
 * Exits non-zero when ρ drops below 0.6 for CI/cron alerting.
 *
 * Usage:
 *   bun run scripts/monitor-hr-rating-drift.ts
 *   bun run scripts/monitor-hr-rating-drift.ts --threshold 0.5
 */

import { Database } from "bun:sqlite";
import { existsSync, appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

interface RatingRow {
  resume_id: string;
  action_data: string;
}

interface MatchRow {
  resume_id: string;
  score: number;
}

function parseRating(raw: string): number | null {
  try {
    const data = JSON.parse(raw);
    const rating = Number(data.rating);
    return Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : null;
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
  if (xs.length < 3) return 0;
  const xRanks = rank(xs);
  const yRanks = rank(ys);
  let sumD2 = 0;
  for (let i = 0; i < xs.length; i++) sumD2 += (xRanks[i] - yRanks[i]) ** 2;
  return 1 - (6 * sumD2) / (xs.length * (xs.length ** 2 - 1));
}

function main() {
  const args = process.argv.slice(2);
  const thresholdIdx = args.indexOf("--threshold");
  let threshold = 0.6;
  if (thresholdIdx >= 0) {
    const raw = Number(args[thresholdIdx + 1]);
    if (!Number.isFinite(raw) || raw <= 0) {
      console.error(`ERROR: invalid threshold: ${args[thresholdIdx + 1]}`);
      process.exit(1);
    }
    threshold = raw;
  }

  const dbPath = resolve("output/resume_screening.db");
  if (!existsSync(dbPath)) {
    console.error(`ERROR: database not found at ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath);

  const ratingRows = db
    .query("SELECT resume_id, action_data FROM candidate_actions WHERE action_type = 'rating'")
    .all() as RatingRow[];

  if (ratingRows.length === 0) {
    console.log("No rating actions found. Skipping drift check.");
    db.close();
    process.exit(0);
  }

  const ratingAcc = new Map<string, { sum: number; count: number }>();
  for (const row of ratingRows) {
    const rating = parseRating(row.action_data);
    if (rating !== null) {
      const entry = ratingAcc.get(row.resume_id);
      if (entry) {
        entry.sum += rating;
        entry.count += 1;
      } else {
        ratingAcc.set(row.resume_id, { sum: rating, count: 1 });
      }
    }
  }

  const ratingsByResume = new Map<string, number>();
  for (const [id, acc] of ratingAcc) {
    ratingsByResume.set(id, acc.sum / acc.count);
  }

  const resumeIds = Array.from(ratingsByResume.keys());
  if (resumeIds.length === 0) {
    console.log("No valid ratings after parsing. Skipping drift check.");
    db.close();
    process.exit(0);
  }

  const placeholders = resumeIds.map(() => "?").join(", ");
  const matchRows = db
    .query(
      `SELECT rm.resume_id, rm.score
       FROM resume_matches rm
       INNER JOIN (
         SELECT resume_id, MAX(matched_at) AS matched_at
         FROM resume_matches
         WHERE resume_id IN (${placeholders})
         GROUP BY resume_id
       ) latest
         ON rm.resume_id = latest.resume_id
        AND rm.matched_at = latest.matched_at
       WHERE rm.resume_id IN (${placeholders})`
    )
    .all(...resumeIds, ...resumeIds) as MatchRow[];

  db.close();

  const scoreMap = new Map(matchRows.map((r) => [r.resume_id, r.score]));

  const scores: number[] = [];
  const ratings: number[] = [];
  for (const [resumeId, rating] of ratingsByResume) {
    const score = scoreMap.get(resumeId);
    if (score !== undefined) {
      scores.push(score);
      ratings.push(rating);
    }
  }

  const n = scores.length;
  if (n < 5) {
    console.log(`Insufficient matched pairs (N=${n}, need >=5). Skipping drift check.`);
    process.exit(0);
  }

  const rho = spearmanRho(scores, ratings);
  const meanScore = scores.reduce((a, b) => a + b, 0) / n;
  const meanRating = ratings.reduce((a, b) => a + b, 0) / n;
  const degraded = rho < threshold;

  const logDir = resolve("output");
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logPath = resolve(logDir, "hr-rating-drift.jsonl");
  appendFileSync(
    logPath,
    JSON.stringify({
      ts: new Date().toISOString(),
      n,
      spearmanRho: Number(rho.toFixed(4)),
      meanScore: Number(meanScore.toFixed(1)),
      meanRating: Number(meanRating.toFixed(1)),
      threshold,
      degraded,
    }) + "\n",
    "utf8"
  );

  console.log(`HR Rating Drift Check — ${new Date().toISOString()}`);
  console.log(`  Sample size:    ${n}`);
  console.log(`  Spearman ρ:     ${rho.toFixed(4)}`);
  console.log(`  Mean AI score:  ${meanScore.toFixed(1)}`);
  console.log(`  Mean HR rating: ${meanRating.toFixed(1)}`);
  console.log(`  Threshold:      ${threshold}`);
  console.log(`  Degraded:       ${degraded}`);

  if (degraded) {
    console.error(`\nALERT: Spearman ρ (${rho.toFixed(4)}) below threshold (${threshold}).`);
    console.error("AI scoring may have drifted from HR ratings. Investigate scoring config.");
    process.exit(1);
  }
}

main();
