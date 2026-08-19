/**
 * Evaluate AI resume ranking quality against the HR-reviewed cohort.
 *
 * Consumes the HR feedback audit CSV produced by
 * .agents/skills/resume-ai-scoring-audit/scripts/audit_hr_feedback_export.py
 * (or any CSV with the same columns) and reports:
 *   - Overall NDCG@K / Recall@K / Spearman / Pearson / MAE (shared lib)
 *   - Per-board (HR Category) stratified metrics
 *   - Parity deltas vs a previous evaluation JSON (--baseline)
 *
 * HR rating resolution order per row:
 *   1. Numeric "HR Expected" column (when present)
 *   2. "HR Category" mapping: high=3, medium=2, low=1 (case-insensitive)
 *   Rows without a resolvable rating or a current AI score are excluded
 *   and counted.
 *
 * Score column resolution: "Current Final AI Score" (preferred),
 * fallback "Current AI Score".
 *
 * Usage:
 *   bun run scripts/evaluate-hr-cohort-ranking.ts
 *   bun run scripts/evaluate-hr-cohort-ranking.ts \
 *     --audit-csv output/resume-ai-scoring-audit/hr-feedback-audit.csv \
 *     --baseline output/resume-ai-scoring-audit/cohort-ranking-eval.json \
 *     --out-json output/resume-ai-scoring-audit/cohort-ranking-eval.json
 *
 * Exit codes: 0 = report written (and parity clean when --baseline given),
 * 2 = parity degraded vs baseline, 1 = usage/input error.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { computeMetrics, type MetricsResult } from "./lib/ranking-metrics";
import { quadraticWeightedKappa, gwetAC2, fleissKappa } from "./lib/inter-rater-reliability";

export interface CohortRow {
  profileResumeId: string;
  board: string;
  rating: number | null;
  score: number | null;
}

export interface BoardMetrics {
  board: string;
  n: number;
  metrics: MetricsResult;
}

export interface IrrMetrics {
  qwk: number;
  ac2: number;
}

export interface CohortReport {
  generatedAt: string;
  sourceCsv: string;
  totalRows: number;
  totalPairs: number;
  excluded: { noRating: number; noScore: number; noStableId: number };
  overall: MetricsResult;
  irr?: IrrMetrics;
  fleiss?: number | null;
  boards: BoardMetrics[];
}

export interface ParityReport {
  comparedTo: string;
  ndcg10Delta: number | null;
  recall10Delta: number | null;
  spearmanRhoDelta: number | null;
  degraded: boolean;
}

const CATEGORY_RATINGS: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Minimal CSV parser: handles quoted fields with embedded delimiters,
 * escaped quotes (""), and \r\n line endings. Returns rows as objects
 * keyed by normalized header (lowercase, no whitespace/underscores/dashes).
 */
export function parseAuditCsv(raw: string): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return rows;

  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current);
    return fields;
  };

  const normalize = (header: string): string =>
    header.trim().toLowerCase().replace(/[\s_-]/g, "");

  const headers = parseLine(lines[0]).map(normalize);
  for (let i = 1; i < lines.length; i++) {
    const fields = parseLine(lines[i]);
    if (fields.length === 1 && fields[0].trim() === "") continue;
    const row: Record<string, string> = {};
    for (let h = 0; h < headers.length; h++) {
      row[headers[h]] = fields[h]?.trim() ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function numeric(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function firstValue(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== "") return value;
  }
  return "";
}

/** Resolve the HR rating for one audit row (see header docs for order). */
export function hrRatingFor(row: Record<string, string>): number | null {
  const expected = numeric(firstValue(row, ["hrexpected", "hrexpectedscore"]));
  if (expected !== null) return expected;

  const category = firstValue(row, ["hrcategory", "hrcategorylabel"])
    .trim()
    .toLowerCase();
  if (category === "") return null;
  return CATEGORY_RATINGS[category] ?? null;
}

/** Resolve the current AI score for one audit row. */
export function aiScoreFor(row: Record<string, string>): number | null {
  return numeric(
    firstValue(row, ["currentfinalaiscore", "finalaiscore", "currentaiscore"])
  );
}

/** Convert raw CSV rows into cohort pairs, dropping rows without rating or score. */
export function buildCohortPairs(rows: Array<Record<string, string>>): {
  pairs: CohortRow[];
  excluded: { noRating: number; noScore: number; noStableId: number };
} {
  const pairs: CohortRow[] = [];
  const excluded = { noRating: 0, noScore: 0, noStableId: 0 };

  for (const row of rows) {
    const profileResumeId = firstValue(row, ["profileresumeid"]);
    if (profileResumeId === "") {
      excluded.noStableId++;
      continue;
    }
    const rating = hrRatingFor(row);
    if (rating === null) {
      excluded.noRating++;
      continue;
    }
    const score = aiScoreFor(row);
    if (score === null) {
      excluded.noScore++;
      continue;
    }
    pairs.push({
      profileResumeId,
      board: firstValue(row, ["hrcategory", "hrcategorylabel"]) || "uncategorized",
      rating,
      score,
    });
  }
  return { pairs, excluded };
}

/** Helper to convert score or rating to discrete integer category 1..categories. */
function discretize(values: number[], categories = 5): number[] {
  // If values are already in 1..categories integers, preserve
  const allInts = values.every((v) => Number.isInteger(v) && v >= 1 && v <= categories);
  if (allInts) return values;

  // Otherwise map continuous or larger scale to 1..categories
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return values.map(() => Math.min(Math.max(Math.round(min), 1), categories));

  return values.map((v) => {
    const norm = (v - min) / (max - min); // 0..1
    const cat = Math.floor(norm * categories) + 1;
    return Math.min(Math.max(cat, 1), categories);
  });
}

/** Compute overall + per-board metrics for a cohort. */
export function evaluateCohort(
  pairs: CohortRow[],
  sourceCsv: string,
  excluded: CohortReport["excluded"] = { noRating: 0, noScore: 0, noStableId: 0 }
): CohortReport {
  const boards = new Map<string, CohortRow[]>();
  for (const pair of pairs) {
    const list = boards.get(pair.board) ?? [];
    list.push(pair);
    boards.set(pair.board, list);
  }

  const boardMetrics: BoardMetrics[] = [];
  for (const [board, rows] of boards) {
    boardMetrics.push({
      board,
      n: rows.length,
      metrics: computeMetrics(
        rows.map((r) => r.score),
        rows.map((r) => r.rating)
      ),
    });
  }
  boardMetrics.sort((a, b) => b.n - a.n);

  let irr: IrrMetrics | undefined = undefined;
  if (pairs.length >= 2) {
    try {
      const maxRating = Math.max(...pairs.map((p) => p.rating ?? 1));
      const categories = Math.max(5, Math.ceil(maxRating));
      const rA = discretize(pairs.map((p) => p.rating ?? 1), categories);
      const rB = discretize(pairs.map((p) => p.score ?? 0), categories);
      const qwk = quadraticWeightedKappa(rA, rB, categories);
      const ac2 = gwetAC2(rA, rB, { weights: "quadratic", categories });
      irr = { qwk, ac2 };
    } catch {
      // Keep irr optional if computation cannot run
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceCsv,
    totalRows: pairs.length,
    totalPairs: pairs.length,
    excluded,
    overall: computeMetrics(
      pairs.map((r) => r.score),
      pairs.map((r) => r.rating)
    ),
    irr,
    fleiss: null,
    boards: boardMetrics,
  };
}

/** Compare current metrics against a previous evaluation JSON. */
export function parityDelta(
  current: MetricsResult,
  baseline: MetricsResult,
  ndcgTolerance: number,
  recallTolerance: number
): ParityReport {
  const ndcg10Delta = current.ndcg10 - baseline.ndcg10;
  const recall10Delta = current.recall10 - baseline.recall10;
  const spearmanRhoDelta = current.spearmanRho - baseline.spearmanRho;
  const degraded =
    ndcg10Delta < -ndcgTolerance || recall10Delta < -recallTolerance;
  return {
    comparedTo: "",
    ndcg10Delta,
    recall10Delta,
    spearmanRhoDelta,
    degraded,
  };
}

function parseBaseline(path: string): MetricsResult {
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as { overall?: MetricsResult } & MetricsResult;
  const baseline = parsed.overall ?? parsed;
  for (const key of ["ndcg10", "recall10", "spearmanRho"] as const) {
    if (typeof baseline[key] !== "number") {
      throw new Error(`baseline missing numeric "${key}"`);
    }
  }
  return baseline;
}

function fmt(value: number): string {
  return value.toFixed(4);
}

function printMetrics(label: string, m: MetricsResult, irr?: IrrMetrics): void {
  const irrPart = irr ? ` QWK=${fmt(irr.qwk)} AC2=${fmt(irr.ac2)}` : "";
  console.log(`  ${label.padEnd(22)} N=${String(m.n).padEnd(4)} ρ=${fmt(m.spearmanRho)} r=${fmt(m.pearsonR)} MAE=${m.mae.toFixed(2)} NDCG@5=${fmt(m.ndcg5)} NDCG@10=${fmt(m.ndcg10)} Recall@10=${fmt(m.recall10)}${irrPart} [${m.confidence}]`);
}

function main() {
  const args = process.argv.slice(2);
  const argValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const auditCsv = resolve(
    argValue("--audit-csv") ?? "output/resume-ai-scoring-audit/hr-feedback-audit.csv"
  );
  const outJson =
    argValue("--out-json") ??
    "output/resume-ai-scoring-audit/cohort-ranking-eval.json";
  const baselinePath = argValue("--baseline");
  const ndcgTolerance = Number(argValue("--ndcg-tolerance") ?? "0.05");
  const recallTolerance = Number(argValue("--recall-tolerance") ?? "0.05");

  if (!existsSync(auditCsv)) {
    console.error(`ERROR: audit CSV not found: ${auditCsv}`);
    console.error("Produce it with .agents/skills/resume-ai-scoring-audit/scripts/audit_hr_feedback_export.py");
    process.exit(1);
  }
  if (!Number.isFinite(ndcgTolerance) || !Number.isFinite(recallTolerance)) {
    console.error("ERROR: tolerances must be numbers");
    process.exit(1);
  }

  const rows = parseAuditCsv(readFileSync(auditCsv, "utf-8"));
  const { pairs, excluded } = buildCohortPairs(rows);
  const report = evaluateCohort(pairs, auditCsv, excluded);
  report.totalRows = rows.length;

  console.log(`HR Cohort Ranking Evaluation — ${new Date().toISOString()}`);
  console.log(`Source: ${auditCsv}`);
  console.log(`Rows: ${rows.length} | Pairs: ${pairs.length}`);
  console.log(`Excluded: no-rating=${excluded.noRating} no-score=${excluded.noScore} no-stable-id=${excluded.noStableId}`);

  if (pairs.length === 0) {
    console.error("\nERROR: no usable score+rating pairs. Nothing to evaluate.");
    process.exit(1);
  }

  console.log("\n=== Overall ===");
  printMetrics("Overall", report.overall, report.irr);

  if (report.boards.length > 1) {
    console.log("\n=== Per Board (HR Category) ===");
    for (const board of report.boards) {
      printMetrics(board.board, board.metrics);
    }
  }

  // Parity vs baseline
  let parity: ParityReport | null = null;
  if (baselinePath) {
    if (!existsSync(baselinePath)) {
      console.error(`ERROR: baseline not found: ${baselinePath}`);
      process.exit(1);
    }
    try {
      parity = parityDelta(
        report.overall,
        parseBaseline(baselinePath),
        ndcgTolerance,
        recallTolerance
      );
      parity.comparedTo = baselinePath;
    } catch (err) {
      console.error(`ERROR: invalid baseline: ${(err as Error).message}`);
      process.exit(1);
    }
    console.log("\n=== Parity vs Baseline ===");
    console.log(`  NDCG@10 delta:    ${parity.ndcg10Delta?.toFixed(4)} (tolerance ${ndcgTolerance})`);
    console.log(`  Recall@10 delta:  ${parity.recall10Delta?.toFixed(4)} (tolerance ${recallTolerance})`);
    console.log(`  Spearman ρ delta: ${parity.spearmanRhoDelta?.toFixed(4)}`);
    console.log(`  Degraded:         ${parity.degraded}`);
  }

  mkdirSync(dirname(resolve(outJson)), { recursive: true });
  writeFileSync(resolve(outJson), JSON.stringify(report, null, 2) + "\n", "utf-8");
  console.log(`\nReport written: ${outJson}`);

  if (parity?.degraded) {
    console.error("\nALERT: ranking quality degraded vs baseline. Investigate scoring changes.");
    process.exit(2);
  }
}

const isMainModule = process.argv[1]
  ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  : false;

if (isMainModule) {
  main();
}
