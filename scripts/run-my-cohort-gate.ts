/**
 * MY Scoring Cohort Gate Runner.
 *
 * Checks AI ranking/scoring quality against the synthetic MY cohort targets
 * and/or human panel ratings against inter-rater reliability thresholds.
 *
 * Gate Thresholds:
 *   AI vs Golden Gate:
 *     - (QWK >= 0.65 OR AC2 >= 0.65)
 *     - AND Spearman rho >= 0.70
 *     - AND NDCG@10 >= 0.85
 *     - AND MAE <= 0.75 (on 1..5 scale or mapped normalized scale)
 *     - N = 35 default (warn if N < 30, fail if N < 25)
 *   Multi-rater Panel Gate (when panel ratings provided):
 *     - Fleiss kappa >= 0.61 (substantial agreement band)
 *
 * Exit codes:
 *   0 = Report written and all gates CLEAN
 *   2 = Report written but gate DEGRADED / FAILED
 *   1 = Usage error / file not found / invalid input
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  fleissKappa,
  gwetAC2,
  kappaBand,
  quadraticWeightedKappa,
} from "./lib/inter-rater-reliability.js";
import {
  computeMetrics,
  mae,
  ndcgAtK,
  spearmanRho,
  type MetricsResult,
} from "./lib/ranking-metrics.js";
import { parseAuditCsv } from "./evaluate-hr-cohort-ranking.js";

export interface GateOptions {
  cohortCsvPath: string;
  scoresCsvPath?: string;
  panelCsvPath?: string;
  reportMdPath?: string;
  artifactDir?: string;
  minN?: number;
  warnN?: number;
}

export interface GateResult {
  passed: boolean;
  warnings: string[];
  errors: string[];
  metrics: {
    n: number;
    qwk?: number;
    ac2?: number;
    spearmanRho?: number;
    ndcg10?: number;
    mae?: number;
    panelFleiss?: number;
    panelFleissBand?: string;
    dimFleiss?: Record<string, number>;
  };
  checks: {
    irrCheck: boolean;
    spearmanCheck: boolean;
    ndcgCheck: boolean;
    maeCheck: boolean;
    panelCheck?: boolean;
    nCheck: boolean;
  };
}

export interface PanelRatingRow {
  rater: string;
  profile: string;
  dim: string;
  rating: number;
}

/** Helper to discretize continuous AI scores into 1..5 buckets matching ratings. */
export function discretizeTo5Scale(scores: number[]): number[] {
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (min === max) return scores.map(() => 3);

  return scores.map((s) => {
    // If scores are already 1..5 integers
    if (scores.every((v) => Number.isInteger(v) && v >= 1 && v <= 5)) {
      return s;
    }
    const norm = (s - min) / (max - min); // 0..1
    const cat = Math.floor(norm * 5) + 1;
    return Math.min(Math.max(cat, 1), 5);
  });
}

/** Compute MAE on a 1..5 scale (discretizing scores if on 0..100 scale). */
export function computeScale5MAE(ratings: number[], scores: number[]): number {
  const scores5 = discretizeTo5Scale(scores);
  return mae(ratings, scores5);
}

export function parseScoresCsv(raw: string): Map<string, number> {
  const rows = parseAuditCsv(raw);
  const map = new Map<string, number>();
  for (const r of rows) {
    const id = r.profileresumeid || r.id || r.profile;
    const scoreStr = r.score || r.currentfinalaiscore || r.finalscore || r.aiscore;
    if (id && scoreStr !== undefined && scoreStr.trim() !== "") {
      const num = Number(scoreStr.trim());
      if (Number.isFinite(num)) {
        map.set(id, num);
      }
    }
  }
  return map;
}

export function parsePanelCsv(raw: string): PanelRatingRow[] {
  const rows = parseAuditCsv(raw);
  const result: PanelRatingRow[] = [];
  for (const r of rows) {
    const rater = r.rater || r.raterid || r.user;
    const profile = r.profile || r.profileresumeid || r.id;
    const dim = r.dim || r.dimension || "overall";
    const ratingStr = r.rating || r.score || r.value;
    if (rater && profile && ratingStr !== undefined) {
      const rating = Number(ratingStr.trim());
      if (Number.isFinite(rating)) {
        result.push({ rater, profile, dim, rating });
      }
    }
  }
  return result;
}

export function runGateChecks(
  cohortRows: Array<{ profileResumeId: string; rating: number; score: number }>,
  panelRows?: PanelRatingRow[],
  options: { minN?: number; warnN?: number } = {}
): GateResult {
  const minN = options.minN ?? 25;
  const warnN = options.warnN ?? 30;
  const n = cohortRows.length;

  const warnings: string[] = [];
  const errors: string[] = [];

  if (n < warnN) {
    warnings.push(`Cohort sample size N=${n} is below recommended N >= ${warnN}`);
  }
  if (n < minN) {
    errors.push(`Cohort sample size N=${n} is below minimum threshold N >= ${minN}`);
  }

  const ratings = cohortRows.map((r) => r.rating);
  const scores = cohortRows.map((r) => r.score);

  // Compute ranking and IRR metrics
  const scores5 = discretizeTo5Scale(scores);
  const qwk = quadraticWeightedKappa(ratings, scores5, 5);
  const ac2 = gwetAC2(ratings, scores5, { weights: "quadratic", categories: 5 });
  const rho = spearmanRho(scores, ratings);
  const mae5 = computeScale5MAE(ratings, scores);

  // NDCG@10
  const idealSorted = [...ratings].sort((a, b) => b - a);
  const scoreIndices = scores
    .map((s, idx) => ({ s, idx }))
    .sort((a, b) => b.s - a.s);
  const rankedRelevance = scoreIndices.map((x) => ratings[x.idx]);
  const ndcg10 = ndcgAtK(rankedRelevance, idealSorted, 10);

  // Gate evaluation
  const irrCheck = qwk >= 0.65 || ac2 >= 0.65;
  const spearmanCheck = rho >= 0.70;
  const ndcgCheck = ndcg10 >= 0.85;
  const maeCheck = mae5 <= 0.75;
  const nCheck = n >= minN;

  if (!irrCheck) {
    errors.push(`IRR check failed: QWK=${qwk.toFixed(4)} (< 0.65) and AC2=${ac2.toFixed(4)} (< 0.65)`);
  }
  if (!spearmanCheck) {
    errors.push(`Spearman rank correlation failed: rho=${rho.toFixed(4)} (< 0.70)`);
  }
  if (!ndcgCheck) {
    errors.push(`NDCG@10 check failed: NDCG@10=${ndcg10.toFixed(4)} (< 0.85)`);
  }
  if (!maeCheck) {
    errors.push(`MAE check failed: MAE=${mae5.toFixed(4)} (> 0.75 on 1..5 scale)`);
  }

  let panelCheck: boolean | undefined = undefined;
  let panelFleiss: number | undefined = undefined;
  let panelFleissBand: string | undefined = undefined;
  let dimFleiss: Record<string, number> | undefined = undefined;

  if (panelRows && panelRows.length > 0) {
    // Group by dimension
    const dims = Array.from(new Set(panelRows.map((r) => r.dim)));
    dimFleiss = {};

    for (const dim of dims) {
      const dimItems = panelRows.filter((r) => r.dim === dim);
      const raters = Array.from(new Set(dimItems.map((r) => r.rater))).sort();
      const profiles = Array.from(new Set(dimItems.map((r) => r.profile))).sort();

      if (raters.length >= 2 && profiles.length >= 2) {
        const matrix: number[][] = [];
        let valid = true;
        for (const rater of raters) {
          const row: number[] = [];
          for (const prof of profiles) {
            const entry = dimItems.find((x) => x.rater === rater && x.profile === prof);
            if (!entry) {
              valid = false;
              break;
            }
            row.push(entry.rating);
          }
          if (!valid) break;
          matrix.push(row);
        }
        if (valid) {
          const k = fleissKappa(matrix, { weights: "quadratic", categories: 5 });
          dimFleiss[dim] = k;
        }
      }
    }

    // Overall panel Fleiss kappa
    const overallDim = dims.includes("overall") ? "overall" : dims[0];
    if (dimFleiss[overallDim] !== undefined) {
      panelFleiss = dimFleiss[overallDim];
      panelFleissBand = kappaBand(panelFleiss);
      panelCheck = panelFleiss >= 0.61;
      if (!panelCheck) {
        errors.push(`Panel Fleiss kappa failed: kappa=${panelFleiss.toFixed(4)} (< 0.61, ${panelFleissBand})`);
      }
    }
  }

  const passed =
    irrCheck &&
    spearmanCheck &&
    ndcgCheck &&
    maeCheck &&
    nCheck &&
    (panelCheck === undefined || panelCheck);

  return {
    passed,
    warnings,
    errors,
    metrics: {
      n,
      qwk,
      ac2,
      spearmanRho: rho,
      ndcg10,
      mae: mae5,
      panelFleiss,
      panelFleissBand,
      dimFleiss,
    },
    checks: {
      irrCheck,
      spearmanCheck,
      ndcgCheck,
      maeCheck,
      panelCheck,
      nCheck,
    },
  };
}

export function generateReportMd(
  gateResult: GateResult,
  metadata: {
    cohortCsvPath: string;
    scoresCsvPath?: string;
    panelCsvPath?: string;
    convexIngestStatus?: string;
  }
): string {
  const m = gateResult.metrics;
  const c = gateResult.checks;

  const lines: string[] = [
    "# MY Scoring Cohort Evaluation & Gate Report",
    "",
    `**Generated:** ${new Date().toISOString()}`,
    `**Cohort Source:** \`${metadata.cohortCsvPath}\``,
    `**Scores Source:** \`${metadata.scoresCsvPath ?? "cohort.csv (embedded)"}\``,
    `**Panel Source:** \`${metadata.panelCsvPath ?? "none"}\``,
    `**Convex Ingest:** ${metadata.convexIngestStatus ?? "SKIPPED (offline/CSV evaluation mode)"}`,
    "",
    "## Gate Verdict",
    "",
    gateResult.passed
      ? "✅ **PASS: All cohort gate criteria satisfied.**"
      : "❌ **FAIL / DEGRADED: One or more gate criteria missed.**",
    "",
    "### Metric Summary vs Thresholds",
    "",
    "| Metric | Value | Threshold | Status |",
    "|---|---|---|---|",
    `| Sample Size (N) | ${m.n} | N >= 35 (warn <30, fail <25) | ${c.nCheck ? "PASS" : "FAIL"} |`,
    `| QWK (Quadratic Weighted Kappa) | ${m.qwk !== undefined ? m.qwk.toFixed(4) : "N/A"} | >= 0.65 (or AC2 >= 0.65) | ${c.irrCheck ? "PASS" : "FAIL"} |`,
    `| Gwet AC2 | ${m.ac2 !== undefined ? m.ac2.toFixed(4) : "N/A"} | >= 0.65 | ${c.irrCheck ? "PASS" : "FAIL"} |`,
    `| Spearman Rank Correlation (ρ) | ${m.spearmanRho !== undefined ? m.spearmanRho.toFixed(4) : "N/A"} | >= 0.70 | ${c.spearmanCheck ? "PASS" : "FAIL"} |`,
    `| NDCG@10 | ${m.ndcg10 !== undefined ? m.ndcg10.toFixed(4) : "N/A"} | >= 0.85 | ${c.ndcgCheck ? "PASS" : "FAIL"} |`,
    `| MAE (1–5 scale) | ${m.mae !== undefined ? m.mae.toFixed(4) : "N/A"} | <= 0.75 | ${c.maeCheck ? "PASS" : "FAIL"} |`,
  ];

  if (m.panelFleiss !== undefined) {
    lines.push(
      `| Panel Fleiss κ | ${m.panelFleiss.toFixed(4)} (${m.panelFleissBand}) | >= 0.61 (substantial) | ${c.panelCheck ? "PASS" : "FAIL"} |`
    );
  }

  lines.push("");

  if (gateResult.warnings.length > 0) {
    lines.push("### Warnings");
    for (const w of gateResult.warnings) {
      lines.push(`- ⚠️ ${w}`);
    }
    lines.push("");
  }

  if (gateResult.errors.length > 0) {
    lines.push("### Gate Failure Diagnostic Findings");
    for (const e of gateResult.errors) {
      lines.push(`- ❌ ${e}`);
    }
    lines.push("");
  }

  lines.push(
    "## Artifacts",
    "",
    `- Report: \`tmp/my-cohort/REPORT.md\``,
    `- Audit JSON: \`output/resume-ai-scoring-audit/my-cohort-gate-eval.json\``
  );

  return lines.join("\n") + "\n";
}

export function executeGate(options: GateOptions): { exitCode: number; gateResult: GateResult } {
  if (!existsSync(options.cohortCsvPath)) {
    console.error(`ERROR: cohort CSV not found: ${options.cohortCsvPath}`);
    return {
      exitCode: 1,
      gateResult: {
        passed: false,
        warnings: [],
        errors: [`Cohort CSV not found: ${options.cohortCsvPath}`],
        metrics: { n: 0 },
        checks: { irrCheck: false, spearmanCheck: false, ndcgCheck: false, maeCheck: false, nCheck: false },
      },
    };
  }

  const rawCohort = readFileSync(options.cohortCsvPath, "utf-8");
  const parsedCohortRows = parseAuditCsv(rawCohort);

  let scoresMap: Map<string, number> | null = null;
  if (options.scoresCsvPath) {
    if (!existsSync(options.scoresCsvPath)) {
      console.error(`ERROR: scores CSV not found: ${options.scoresCsvPath}`);
      return {
        exitCode: 1,
        gateResult: {
          passed: false,
          warnings: [],
          errors: [`Scores CSV not found: ${options.scoresCsvPath}`],
          metrics: { n: 0 },
          checks: { irrCheck: false, spearmanCheck: false, ndcgCheck: false, maeCheck: false, nCheck: false },
        },
      };
    }
    const rawScores = readFileSync(options.scoresCsvPath, "utf-8");
    scoresMap = parseScoresCsv(rawScores);
  }

  const joinedRows: Array<{ profileResumeId: string; rating: number; score: number }> = [];

  for (const r of parsedCohortRows) {
    const id = r.profileresumeid || r.id;
    if (!id) continue;

    const ratingVal = Number(r.rating || r.hrexpected || r.target);
    if (!Number.isFinite(ratingVal)) continue;

    let scoreVal: number | null = null;
    if (scoresMap) {
      scoreVal = scoresMap.get(id) ?? null;
    } else {
      const s = r.score || r.currentfinalaiscore;
      if (s !== undefined && s.trim() !== "") {
        const num = Number(s.trim());
        if (Number.isFinite(num)) scoreVal = num;
      }
    }

    if (scoreVal !== null) {
      joinedRows.push({
        profileResumeId: id,
        rating: ratingVal,
        score: scoreVal,
      });
    }
  }

  if (joinedRows.length === 0) {
    console.error("ERROR: No valid profile rows with both rating and score found.");
    return {
      exitCode: 1,
      gateResult: {
        passed: false,
        warnings: [],
        errors: ["No valid profile rows with both rating and score found."],
        metrics: { n: 0 },
        checks: { irrCheck: false, spearmanCheck: false, ndcgCheck: false, maeCheck: false, nCheck: false },
      },
    };
  }

  let panelRows: PanelRatingRow[] | undefined = undefined;
  if (options.panelCsvPath) {
    if (!existsSync(options.panelCsvPath)) {
      console.error(`ERROR: panel CSV not found: ${options.panelCsvPath}`);
      return {
        exitCode: 1,
        gateResult: {
          passed: false,
          warnings: [],
          errors: [`Panel CSV not found: ${options.panelCsvPath}`],
          metrics: { n: 0 },
          checks: { irrCheck: false, spearmanCheck: false, ndcgCheck: false, maeCheck: false, nCheck: false },
        },
      };
    }
    const rawPanel = readFileSync(options.panelCsvPath, "utf-8");
    panelRows = parsePanelCsv(rawPanel);
  }

  const gateResult = runGateChecks(joinedRows, panelRows, {
    minN: options.minN,
    warnN: options.warnN,
  });

  const reportMd = generateReportMd(gateResult, {
    cohortCsvPath: options.cohortCsvPath,
    scoresCsvPath: options.scoresCsvPath,
    panelCsvPath: options.panelCsvPath,
  });

  if (options.reportMdPath) {
    mkdirSync(dirname(options.reportMdPath), { recursive: true });
    writeFileSync(options.reportMdPath, reportMd, "utf-8");
  }

  if (options.artifactDir) {
    mkdirSync(options.artifactDir, { recursive: true });
    const jsonPath = resolve(options.artifactDir, "my-cohort-gate-eval.json");
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          passed: gateResult.passed,
          metrics: gateResult.metrics,
          checks: gateResult.checks,
          errors: gateResult.errors,
          warnings: gateResult.warnings,
        },
        null,
        2
      ),
      "utf-8"
    );
  }

  return {
    exitCode: gateResult.passed ? 0 : 2,
    gateResult,
  };
}

function main() {
  const args = process.argv.slice(2);
  const argValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const cohortCsv = resolve(argValue("--cohort-csv") ?? "tmp/my-cohort/cohort.csv");
  const scoresCsv = argValue("--scores-csv") ? resolve(argValue("--scores-csv")!) : undefined;
  const panelCsv = argValue("--panel-csv") ? resolve(argValue("--panel-csv")!) : undefined;
  const reportMd = resolve(argValue("--report-md") ?? "tmp/my-cohort/REPORT.md");
  const artifactDir = resolve(
    argValue("--out-dir") ?? "output/resume-ai-scoring-audit"
  );

  const { exitCode, gateResult } = executeGate({
    cohortCsvPath: cohortCsv,
    scoresCsvPath: scoresCsv,
    panelCsvPath: panelCsv,
    reportMdPath: reportMd,
    artifactDir,
  });

  console.log(`MY Scoring Cohort Gate Runner — ${new Date().toISOString()}`);
  console.log(`Cohort: ${cohortCsv}`);
  console.log(`Pairs: ${gateResult.metrics.n}`);
  console.log(
    `Metrics: QWK=${gateResult.metrics.qwk?.toFixed(4)} AC2=${gateResult.metrics.ac2?.toFixed(4)} ρ=${gateResult.metrics.spearmanRho?.toFixed(4)} NDCG@10=${gateResult.metrics.ndcg10?.toFixed(4)} MAE=${gateResult.metrics.mae?.toFixed(4)}`
  );
  if (gateResult.metrics.panelFleiss !== undefined) {
    console.log(`Panel Fleiss κ: ${gateResult.metrics.panelFleiss.toFixed(4)} (${gateResult.metrics.panelFleissBand})`);
  }

  if (gateResult.passed) {
    console.log("\n✅ GATE PASS: All criteria satisfied.");
  } else {
    console.log("\n❌ GATE DEGRADED / FAILED:");
    for (const err of gateResult.errors) {
      console.log(`  - ${err}`);
    }
  }

  process.exit(exitCode);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
