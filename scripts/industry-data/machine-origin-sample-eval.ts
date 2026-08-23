/**
 * Machine Origin Suggestion Sample Evaluation Gate.
 *
 * Evaluates the P2 AI prefill (`suggestMachineOrigin`) against the MY-27
 * ground truth from
 * `queries/machineorigin-coverage-bottleneck-research-2026-08-22.md` §6
 * (6 international brands/toolmakers, 7 domestic keys / 6 local companies,
 * 14 distributors/integrators — 27 company keys total).
 *
 * Modes:
 *   --live            Call the real AI through `suggestMachineOrigin` for all
 *                     27 companies (evidence sources from the seed plan),
 *                     write predictions.json, then evaluate. Requires
 *                     AI_ANALYSIS_ENABLED=true and AI_API_KEY in the env.
 *   --input <json>    Evaluate a saved predictions file (default:
 *                     output/industry-data/machine-origin-sample-eval/predictions.json).
 *
 * Two-gate model:
 *   1. Evidence-adequate subset gate (PRIMARY) — evaluates only the rows
 *      whose seed-plan evidence actually references the company
 *      (SEED_EVIDENCE_INADEQUATE rows are excluded; the exclusion list is
 *      machine-verified by unit test against the seed plan). This measures
 *      AI classification quality on usable evidence.
 *   2. Full MY-27 gate (DIAGNOSTIC) — evaluates all 27 rows. A failure here
 *      while the subset passes is a seed-plan evidence-quality finding
 *      (placeholder `example.com` sources / name-collision sources), not an
 *      AI-quality failure, and is documented as such in the report.
 *
 * Gate thresholds (both gates):
 *   - Overall accuracy  >= 0.75
 *   - Per-class precision >= 0.60 AND recall >= 0.60 for `international`
 *     and `domestic` (the two classes the suggestion surfaces; `unknown`
 *     is reported but not gated — single ambiguous sample)
 *   - Sample size: full N >= 27 (warn < 27, fail < 25); subset N is a
 *     defined population (20) and must be fully covered.
 *
 * Exit codes:
 *   0 = Report written, adequacy-subset gate CLEAN
 *   2 = Report written, adequacy-subset gate DEGRADED / FAILED
 *   1 = Usage error / file not found / invalid input
 */

import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type MachineOriginLabel = "international" | "domestic" | "unknown";

export interface GroundTruthEntry {
  companyKey: string;
  companyName: string;
  expected: MachineOriginLabel;
}

export interface SuggestionPrediction {
  companyKey: string;
  predicted: MachineOriginLabel | null; // null = no suggestion (AI off / parse fail)
  confidence?: number;
  evidenceExcerpt?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  model?: string;
}

export interface ClassMetrics {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface EvalResult {
  n: number;
  correct: number;
  accuracy: number;
  perClass: Record<MachineOriginLabel, ClassMetrics>;
  checks: {
    nCheck: boolean;
    accuracyCheck: boolean;
    precisionRecallCheck: boolean;
  };
  warnings: string[];
  errors: string[];
  passed: boolean;
  rows: Array<{
    companyKey: string;
    companyName: string;
    expected: MachineOriginLabel;
    predicted: MachineOriginLabel | null;
    correct: boolean;
    confidence?: number;
    sourceUrl?: string;
  }>;
}

/**
 * MY-27 ground truth. Company names are the employer display names from
 * `deploy/seed-data/company-industry-seed-plan.json` (research §6 + §6.3
 * "Assigned Origin Category"). Signvec is the sole ambiguous multi-brand
 * distributor (research "Coverage and uncertainty") and is labelled unknown.
 */
export const MY27_GROUND_TRUTH: GroundTruthEntry[] = [
  // §6.1 International brands & authoritative toolmakers (6)
  { companyKey: "haas-automation", companyName: "Haas Malaysia (ROBO CNC SDN BHD)", expected: "international" },
  { companyKey: "seco-tools-sdn-bhd", companyName: "Seco Tools Sdn Bhd", expected: "international" },
  { companyKey: "nsk-bearings-malaysia-sdn-bhd", companyName: "NSK Bearings Malaysia Sdn Bhd", expected: "international" },
  { companyKey: "ichi-seiki-pte-ltd", companyName: "Ichi Seiki Pte Ltd / Sdn Bhd", expected: "international" },
  { companyKey: "luvata-malaysia-sdn-bhd", companyName: "Luvata Malaysia Sdn Bhd", expected: "international" },
  { companyKey: "sika-kimia-sdn-bhd", companyName: "SIKA Kimia Sdn Bhd", expected: "international" },
  // §6.2 Local precision engineering & machine shops (6 companies, 7 keys)
  { companyKey: "newbillion-precision-metal", companyName: "Newbillion Precision Metal", expected: "domestic" },
  { companyKey: "newbillion-precision-metal-sdn-bhd", companyName: "Newbillion Precision Metal Sdn Bhd", expected: "domestic" },
  { companyKey: "seng-heng-precision-tools-sdnbhd", companyName: "Seng Heng Precision Tools Sdn. Bhd", expected: "domestic" },
  { companyKey: "mec-mart-toolings-sdn-bhd", companyName: "Mec-mart Toolings Sdn Bhd", expected: "domestic" },
  { companyKey: "bme-industries-m-sdn-bhd", companyName: "Bme Industries (M) Sdn Bhd", expected: "domestic" },
  { companyKey: "bmt-engineering-sdn-bhd", companyName: "BMT Engineering Sdn Bhd", expected: "domestic" },
  { companyKey: "yong-fung-engineering-works-sdnbhd", companyName: "Yong Fung Engineering Works Sdn Bhd", expected: "domestic" },
  // §6.3 Local distributors, automation integrators & non-CNC industrial (14)
  { companyKey: "cadvision-systems-sdn-bhd", companyName: "Cadvision Systems Sdn Bhd", expected: "international" },
  { companyKey: "signvec-technology-m-sdn-bhd", companyName: "Signvec Technology M Sdn Bhd", expected: "unknown" },
  { companyKey: "adastream-sdn-bhd", companyName: "Adastream Sdn Bhd", expected: "domestic" },
  { companyKey: "anoz-aluminiumsuzhoucoltd", companyName: "Anoz Aluminium Suzhou Co Ltd", expected: "domestic" },
  { companyKey: "asdic-auto-parts-suppliers-sdn-bhd", companyName: "Asdic Auto Parts Suppliers", expected: "domestic" },
  { companyKey: "ci-dynamic-sdn-bhd", companyName: "Ci Dynamic Sdn Bhd", expected: "domestic" },
  { companyKey: "cnc-automobile", companyName: "CNC AUTOMOBILE", expected: "domestic" },
  { companyKey: "empower-new-m-sdn-bhd", companyName: "Empower new M sdn bhd", expected: "domestic" },
  { companyKey: "leesonmech-engineering-m-sdn-bhd", companyName: "Leesonmech Engineering", expected: "domestic" },
  { companyKey: "lionapex-equipment-m-sdn-bhd", companyName: "Lionapex Equipment", expected: "domestic" },
  { companyKey: "robo-tech-machinery-sdn-bhd", companyName: "Robo Tech Machinery", expected: "domestic" },
  { companyKey: "sinvict-technology-pte-ltd", companyName: "Sinvict Technology Pte Ltd", expected: "domestic" },
  { companyKey: "smart-tools-marketing-enterprise", companyName: "Smart Tools Marketing", expected: "domestic" },
  { companyKey: "yd-laser-technologies-co-ltd", companyName: "YD Laser Technologies", expected: "domestic" },
];

export type EvidenceInadequacyReason = "placeholder" | "name-collision";

export interface EvidenceInadequacy {
  companyKey: string;
  reasonClass: EvidenceInadequacyReason;
  reason: string;
  referenceTokens: string[];
}

/**
 * Machine-verified list of MY-27 keys whose seed-plan evidence does not
 * actually reference the company. Verified by unit test against
 * `deploy/seed-data/company-industry-seed-plan.json`:
 * - placeholder: every source URL is an `example.com` placeholder page.
 * - name-collision: none of `referenceTokens` appears in any source
 *   title/url/evidenceExcerpt (the sources describe a different company
 *   that happens to share part of the name).
 */
export const SEED_EVIDENCE_INADEQUATE: EvidenceInadequacy[] = [
  {
    companyKey: "mec-mart-toolings-sdn-bhd",
    reasonClass: "name-collision",
    reason: "Sources are MEC CNC (US, meccnc.com) and MEC Machine Tools (UK, mecmt.co.uk) — different companies.",
    referenceTokens: ["mec-mart", "mecmart", "toolings"],
  },
  {
    companyKey: "bmt-engineering-sdn-bhd",
    reasonClass: "name-collision",
    reason: "Sources are BMT Group (global consultancy, bmt.org) and BMT Aerospace — different companies.",
    referenceTokens: ["bmt engineering"],
  },
  {
    companyKey: "adastream-sdn-bhd",
    reasonClass: "placeholder",
    reason: "Only source is an example.com placeholder catalog page.",
    referenceTokens: ["adastream"],
  },
  {
    companyKey: "anoz-aluminiumsuzhoucoltd",
    reasonClass: "placeholder",
    reason: "Both sources are example.com placeholder registry/catalog pages.",
    referenceTokens: ["anoz"],
  },
  {
    companyKey: "asdic-auto-parts-suppliers-sdn-bhd",
    reasonClass: "name-collision",
    reason: "Sources are Chinese CNC auto-parts suppliers (cncprecision-parts.com, ddpartsgroup.com) — different company.",
    referenceTokens: ["asdic"],
  },
  {
    companyKey: "cnc-automobile",
    reasonClass: "name-collision",
    reason: "Sources are CNC Innovations MY and ROBO CNC (Haas distributor) — different companies.",
    referenceTokens: ["cnc automobile", "cnc-automobile"],
  },
  {
    companyKey: "smart-tools-marketing-enterprise",
    reasonClass: "name-collision",
    reason: "Only source is US Smart Machine Tool (smartmachinetool.com) — different company.",
    referenceTokens: ["smart tools", "smart-tools"],
  },
];

export const EVAL_THRESHOLDS = {
  minN: 25,
  warnN: 27,
  accuracy: 0.75,
  perClassPrecision: 0.6,
  perClassRecall: 0.6,
} as const;

const CLASSES: MachineOriginLabel[] = ["international", "domestic", "unknown"];

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Compute per-class precision / recall / F1 from predictions. */
export function computeClassMetrics(
  predictions: SuggestionPrediction[],
  groundTruth: GroundTruthEntry[],
): { perClass: Record<MachineOriginLabel, ClassMetrics>; correct: number } {
  const perClass = Object.fromEntries(
    CLASSES.map((c) => [
      c,
      { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0 },
    ]),
  ) as Record<MachineOriginLabel, ClassMetrics>;

  const truthByKey = new Map(groundTruth.map((g) => [g.companyKey, g.expected]));
  let correct = 0;

  for (const p of predictions) {
    const expected = truthByKey.get(p.companyKey);
    if (!expected) continue; // unknown key — not part of the sample
    const predicted = p.predicted;
    if (predicted === expected) {
      correct += 1;
      perClass[expected].tp += 1;
    } else if (predicted !== null && CLASSES.includes(predicted)) {
      perClass[predicted].fp += 1;
      perClass[expected].fn += 1;
    } else {
      // null prediction (no suggestion) — counts as a miss for the true class
      perClass[expected].fn += 1;
    }
  }

  for (const c of CLASSES) {
    const m = perClass[c];
    m.precision = m.tp + m.fp > 0 ? m.tp / (m.tp + m.fp) : 0;
    m.recall = m.tp + m.fn > 0 ? m.tp / (m.tp + m.fn) : 0;
    m.f1 = m.precision + m.recall > 0 ? (2 * m.precision * m.recall) / (m.precision + m.recall) : 0;
  }

  return { perClass, correct };
}

/** Evaluate a predictions file against MY-27 ground truth and gate thresholds. */
export function evaluatePredictions(
  predictions: SuggestionPrediction[],
  groundTruth: GroundTruthEntry[] = MY27_GROUND_TRUTH,
  thresholds: Partial<typeof EVAL_THRESHOLDS> = {},
): EvalResult {
  const t = { ...EVAL_THRESHOLDS, ...thresholds };
  const warnings: string[] = [];
  const errors: string[] = [];

  const truthByKey = new Map(groundTruth.map((g) => [g.companyKey, g]));
  const predKeys = new Set(predictions.map((p) => p.companyKey));
  const total = groundTruth.length;
  const covered = groundTruth.filter((g) => predKeys.has(g.companyKey)).length;
  const n = covered; // sample size = predictions that map to ground truth entries

  if (n < t.warnN) {
    warnings.push(`Sample size N=${n} is below recommended N >= ${t.warnN}`);
  }
  if (n < t.minN) {
    errors.push(`Sample size N=${n} is below minimum threshold N >= ${t.minN}`);
  }
  if (covered < total) {
    warnings.push(`${total - covered} of ${total} ground-truth companies have no prediction row (covered=${covered})`);
  }

  const { perClass, correct } = computeClassMetrics(predictions, groundTruth);
  const accuracy = total > 0 ? correct / total : 0;

  const accuracyCheck = accuracy >= t.accuracy;
  if (!accuracyCheck) {
    errors.push(
      `Accuracy check failed: ${round4(accuracy)} (< ${t.accuracy}, ${correct}/${total} correct)`,
    );
  }

  let precisionRecallCheck = true;
  for (const c of ["international", "domestic"] as const) {
    const m = perClass[c];
    const pOk = m.precision >= t.perClassPrecision;
    const rOk = m.recall >= t.perClassRecall;
    if (!pOk || !rOk) {
      precisionRecallCheck = false;
      errors.push(
        `${c} precision/recall check failed: precision=${round4(m.precision)} (>= ${t.perClassPrecision}), recall=${round4(m.recall)} (>= ${t.perClassRecall})`,
      );
    }
  }

  const nCheck = n >= t.minN;
  const passed = nCheck && accuracyCheck && precisionRecallCheck;

  const rows = groundTruth.map((g) => {
    const p = predictions.find((x) => x.companyKey === g.companyKey);
    return {
      companyKey: g.companyKey,
      companyName: g.companyName,
      expected: g.expected,
      predicted: p?.predicted ?? null,
      correct: p?.predicted === g.expected,
      confidence: p?.confidence,
      sourceUrl: p?.sourceUrl,
    };
  });

  return {
    n,
    correct,
    accuracy,
    perClass,
    checks: { nCheck, accuracyCheck, precisionRecallCheck },
    warnings,
    errors,
    passed,
    rows,
  };
}

export interface EvalWithSubsetResult {
  passed: boolean;
  notes: string[];
  exclusions: Array<{
    companyKey: string;
    reasonClass: EvidenceInadequacyReason;
    reason: string;
  }>;
  /** Diagnostic full MY-27 gate. */
  full: EvalResult;
  /** Primary evidence-adequate subset gate (SEED_EVIDENCE_INADEQUATE excluded). */
  subset: EvalResult;
}

/**
 * Two-gate evaluation:
 * 1. Evidence-adequate subset gate (PRIMARY) — SEED_EVIDENCE_INADEQUATE rows
 *    excluded; the subset is a defined population that must be fully covered.
 * 2. Full MY-27 gate (DIAGNOSTIC) — all 27 rows; a full-only failure is a
 *    seed-plan evidence-quality finding, not an AI-quality failure, and is
 *    surfaced in `notes`.
 */
export function evaluateWithEvidenceSubset(
  predictions: SuggestionPrediction[],
  groundTruth: GroundTruthEntry[] = MY27_GROUND_TRUTH,
): EvalWithSubsetResult {
  const excludedKeys = new Set(SEED_EVIDENCE_INADEQUATE.map((e) => e.companyKey));
  const subsetTruth = groundTruth.filter((g) => !excludedKeys.has(g.companyKey));
  const subset = evaluatePredictions(predictions, subsetTruth, {
    minN: subsetTruth.length,
    warnN: subsetTruth.length,
  });
  const full = evaluatePredictions(predictions, groundTruth);

  const notes: string[] = [];
  if (subset.passed && !full.passed) {
    notes.push(
      "Adequacy-subset gate PASSED while the full MY-27 gate FAILED: the " +
        `${SEED_EVIDENCE_INADEQUATE.length} excluded rows have no usable seed evidence ` +
        "(placeholder example.com sources / name-collision sources), so full-gate failures " +
        "on those rows are a seed-plan evidence-quality finding, not an AI-quality failure.",
    );
  }

  return {
    passed: subset.passed,
    notes,
    exclusions: SEED_EVIDENCE_INADEQUATE.map((e) => ({
      companyKey: e.companyKey,
      reasonClass: e.reasonClass,
      reason: e.reason,
    })),
    full,
    subset,
  };
}

export function generateReportMd(result: EvalWithSubsetResult): string {
  const lines: string[] = [
    "# Machine Origin Suggestion — MY-27 Sample Evaluation Report",
    "",
    `**Generated:** ${new Date().toISOString()}`,
    `**Sample:** ${result.full.n} Malaysia companies (research §6 ground truth); evidence-adequate subset N=${result.subset.n} of ${result.subset.rows.length} defined population`,
    "",
    "## Gate Verdict",
    "",
    result.passed
      ? "✅ **PASS: Evidence-adequate subset gate satisfied.**"
      : "❌ **FAIL / DEGRADED: Evidence-adequate subset gate missed.**",
    "",
  ];

  if (result.notes.length > 0) {
    lines.push("## Notes", "");
    for (const n of result.notes) lines.push(`- ${n}`);
    lines.push("");
  }

  lines.push(
    "## Evidence-Adequate Subset Gate (PRIMARY)",
    "",
    `Evaluates only rows whose seed evidence references the company. N=${result.subset.n} of ${result.subset.rows.length} defined population covered (${result.exclusions.length} evidence-inadequate rows excluded — see below).`,
    "",
    "| Metric | Value | Threshold | Status |",
    "|---|---|---|---|",
    `| Sample Size (N) | ${result.subset.n} | >= ${result.subset.rows.length} (defined population) | ${result.subset.checks.nCheck ? "PASS" : "FAIL"} |`,
    `| Accuracy | ${round4(result.subset.accuracy)} | >= ${EVAL_THRESHOLDS.accuracy} | ${result.subset.checks.accuracyCheck ? "PASS" : "FAIL"} |`,
    `| Precision/Recall (intl + domestic) | see below | >= ${EVAL_THRESHOLDS.perClassPrecision} / ${EVAL_THRESHOLDS.perClassRecall} | ${result.subset.checks.precisionRecallCheck ? "PASS" : "FAIL"} |`,
    "",
    "### Subset Per-Class Metrics",
    "",
    "| Class | TP | FP | FN | Precision | Recall | F1 |",
    "|---|---|---|---|---|---|---|",
    ...CLASSES.map((c) => {
      const m = result.subset.perClass[c];
      return `| ${c} | ${m.tp} | ${m.fp} | ${m.fn} | ${round4(m.precision)} | ${round4(m.recall)} | ${round4(m.f1)} |`;
    }),
    "",
    "### Subset Per-Company Breakdown",
    "",
    "| Company | Expected | Predicted | Correct | Confidence |",
    "|---|---|---|---|---|",
  );
  for (const r of result.subset.rows) {
    lines.push(
      `| ${r.companyName} (\`${r.companyKey}\`) | ${r.expected} | ${r.predicted ?? "—"} | ${r.correct ? "✅" : "❌"} | ${r.confidence !== undefined ? round4(r.confidence) : "—"} |`,
    );
  }
  lines.push("");

  lines.push(
    "## Full MY-27 Gate (DIAGNOSTIC)",
    "",
    "| Metric | Value | Threshold | Status |",
    "|---|---|---|---|",
    `| Sample Size (N) | ${result.full.n} | >= ${EVAL_THRESHOLDS.minN} (warn < ${EVAL_THRESHOLDS.warnN}) | ${result.full.checks.nCheck ? "PASS" : "FAIL"} |`,
    `| Accuracy | ${round4(result.full.accuracy)} | >= ${EVAL_THRESHOLDS.accuracy} | ${result.full.checks.accuracyCheck ? "PASS" : "FAIL"} |`,
    `| Precision/Recall (intl + domestic) | see below | >= ${EVAL_THRESHOLDS.perClassPrecision} / ${EVAL_THRESHOLDS.perClassRecall} | ${result.full.checks.precisionRecallCheck ? "PASS" : "FAIL"} |`,
    "",
    "### Full Per-Class Metrics",
    "",
    "| Class | TP | FP | FN | Precision | Recall | F1 |",
    "|---|---|---|---|---|---|---|",
    ...CLASSES.map((c) => {
      const m = result.full.perClass[c];
      return `| ${c} | ${m.tp} | ${m.fp} | ${m.fn} | ${round4(m.precision)} | ${round4(m.recall)} | ${round4(m.f1)} |`;
    }),
    "",
    "### Full Gate Findings",
    "",
  );
  if (result.full.warnings.length > 0) {
    for (const w of result.full.warnings) lines.push(`- ⚠️ ${w}`);
  }
  if (result.full.errors.length > 0) {
    for (const e of result.full.errors) lines.push(`- ❌ ${e}`);
  }
  if (result.full.warnings.length === 0 && result.full.errors.length === 0) {
    lines.push("- none");
  }
  lines.push("");

  lines.push(
    "## Evidence Adequacy Exclusions",
    "",
    "Rows excluded from the primary gate because their seed-plan evidence does not reference the company (machine-verified by unit test against `deploy/seed-data/company-industry-seed-plan.json`).",
    "",
    "| Company Key | Reason Class | Reason |",
    "|---|---|---|",
    ...result.exclusions.map((e) => `| \`${e.companyKey}\` | ${e.reasonClass} | ${e.reason} |`),
    "",
    "## Per-Company Breakdown (Full 27)",
    "",
    "| Company | Expected | Predicted | Correct | Confidence |",
    "|---|---|---|---|---|",
  );
  for (const r of result.full.rows) {
    lines.push(
      `| ${r.companyName} (\`${r.companyKey}\`) | ${r.expected} | ${r.predicted ?? "—"} | ${r.correct ? "✅" : "❌"} | ${r.confidence !== undefined ? round4(r.confidence) : "—"} |`,
    );
  }
  lines.push(
    "",
    "## Artifacts",
    "",
    "- Report: `output/industry-data/machine-origin-sample-eval/REPORT.md`",
    "- Predictions: `output/industry-data/machine-origin-sample-eval/predictions.json`",
    "- Results: `output/industry-data/machine-origin-sample-eval/report.json`",
    "",
  );

  return lines.join("\n") + "\n";
}

/** Run a live AI sample pass over all 27 ground-truth companies. */
export async function runLivePredictions(
  seedPlanPath: string,
): Promise<SuggestionPrediction[]> {
  const { suggestMachineOrigin } = await import(
    "../../apps/api/src/services/machine-origin-suggestion-service.js"
  );
  const raw = readFileSync(seedPlanPath, "utf-8");
  const plan = JSON.parse(raw) as { companies: Array<{
    companyKey: string;
    employerName: string;
    industryClass?: string;
    sources?: Array<{
      title?: string;
      url?: string;
      evidenceExcerpt?: string;
      sourceType?: string;
      trustTier?: string;
    }>;
  }> };

  const byKey = new Map(plan.companies.map((c) => [c.companyKey, c]));
  const predictions: SuggestionPrediction[] = [];

  for (const g of MY27_GROUND_TRUTH) {
    const seed = byKey.get(g.companyKey);
    const sources = (seed?.sources ?? []).map((s) => ({
      title: s.title,
      url: s.url,
      evidenceExcerpt: s.evidenceExcerpt,
      sourceType: s.sourceType as never,
      trustTier: s.trustTier as never,
    }));
    const suggestion = await suggestMachineOrigin(
      seed?.employerName ?? g.companyName,
      seed?.industryClass ?? "unknown",
      sources,
    );
    predictions.push({
      companyKey: g.companyKey,
      predicted: suggestion?.suggestedMachineOrigin ?? null,
      confidence: suggestion?.confidence,
      evidenceExcerpt: suggestion?.evidenceExcerpt,
      sourceUrl: suggestion?.sourceUrl,
      sourceTitle: suggestion?.sourceTitle,
      model: suggestion?.model,
    });
  }

  return predictions;
}

export interface EvalOptions {
  inputPath?: string;
  live?: boolean;
  seedPlanPath?: string;
  outDir?: string;
}

export async function executeEval(
  options: EvalOptions,
): Promise<{ exitCode: number; result: EvalWithSubsetResult | null }> {
  const outDir = resolve(options.outDir ?? "output/industry-data/machine-origin-sample-eval");
  mkdirSync(outDir, { recursive: true });

  let predictions: SuggestionPrediction[];
  let sourceDesc: string;

  if (options.live) {
    if (process.env.AI_ANALYSIS_ENABLED !== "true") {
      console.error(
        "ERROR: --live requires AI_ANALYSIS_ENABLED=true (and AI_API_KEY) in the environment; the service returns no suggestion otherwise.",
      );
      return { exitCode: 1, result: null };
    }
    const seedPlanPath = resolve(options.seedPlanPath ?? "deploy/seed-data/company-industry-seed-plan.json");
    if (!existsSync(seedPlanPath)) {
      console.error(`ERROR: seed plan not found: ${seedPlanPath}`);
      return { exitCode: 1, result: null };
    }
    predictions = await runLivePredictions(seedPlanPath);
    sourceDesc = `live AI run (model ${predictions.find((p) => p.model)?.model ?? "unknown"})`;
    writeFileSync(
      resolve(outDir, "predictions.json"),
      JSON.stringify(predictions, null, 2) + "\n",
    );
  } else {
    const inputPath = resolve(
      options.inputPath ?? "output/industry-data/machine-origin-sample-eval/predictions.json",
    );
    if (!existsSync(inputPath)) {
      console.error(`ERROR: predictions file not found: ${inputPath}`);
      console.error("Run with --live first, or pass --input <predictions.json>.");
      return { exitCode: 1, result: null };
    }
    const raw = readFileSync(inputPath, "utf-8");
    predictions = JSON.parse(raw) as SuggestionPrediction[];
    sourceDesc = inputPath;
  }

  const result = evaluateWithEvidenceSubset(predictions);
  writeFileSync(resolve(outDir, "REPORT.md"), generateReportMd(result));
  writeFileSync(
    resolve(outDir, "report.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: sourceDesc,
        passed: result.passed,
        notes: result.notes,
        exclusions: result.exclusions,
        full: result.full,
        subset: result.subset,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(`Machine Origin Sample Evaluation — ${new Date().toISOString()}`);
  console.log(`Source: ${sourceDesc}`);
  console.log(
    `[PRIMARY] adequacy-subset: N=${result.subset.n} correct=${result.subset.correct} ` +
      `accuracy=${round4(result.subset.accuracy)} (${result.subset.rows.length} defined population, ` +
      `${result.exclusions.length} excluded)`,
  );
  for (const c of CLASSES) {
    const m = result.subset.perClass[c];
    console.log(
      `  ${c}: precision=${round4(m.precision)} recall=${round4(m.recall)} f1=${round4(m.f1)} (tp=${m.tp} fp=${m.fp} fn=${m.fn})`,
    );
  }
  console.log(
    `[DIAGNOSTIC] full MY-27: N=${result.full.n} correct=${result.full.correct} ` +
      `accuracy=${round4(result.full.accuracy)}`,
  );
  for (const c of CLASSES) {
    const m = result.full.perClass[c];
    console.log(
      `  ${c}: precision=${round4(m.precision)} recall=${round4(m.recall)} f1=${round4(m.f1)} (tp=${m.tp} fp=${m.fp} fn=${m.fn})`,
    );
  }
  for (const w of result.full.warnings) console.log(`  ⚠️ ${w}`);
  for (const e of result.full.errors) console.log(`  ❌ ${e}`);
  for (const n of result.notes) console.log(`  ℹ️ ${n}`);

  if (result.passed) {
    console.log("\n✅ GATE PASS: Evidence-adequate subset satisfied.");
    return { exitCode: 0, result };
  }
  console.log("\n❌ GATE DEGRADED / FAILED.");
  return { exitCode: 2, result };
}

function main(): void {
  const args = process.argv.slice(2);
  const argValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const live = args.includes("--live");
  executeEval({
    live,
    inputPath: argValue("--input"),
    seedPlanPath: argValue("--seed-plan"),
    outDir: argValue("--out-dir"),
  }).then(({ exitCode }) => {
    process.exit(exitCode);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
