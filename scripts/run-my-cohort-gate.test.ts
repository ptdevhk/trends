import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateCohort } from "./generate-my-cohort.js";
import { generateMockScores } from "./my-cohort/mock-scorer.js";
import {
  computeScale5MAE,
  discretizeTo5Scale,
  executeGate,
  parsePanelCsv,
  parseScoresCsv,
  runGateChecks,
} from "./run-my-cohort-gate.js";

const SEED = 20260819;

describe("run-my-cohort-gate", () => {
  it("discretizeTo5Scale correctly bounds values to 1..5", () => {
    expect(discretizeTo5Scale([10, 20, 30, 40, 50])).toEqual([1, 2, 3, 4, 5]);
    expect(discretizeTo5Scale([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5]);
    expect(discretizeTo5Scale([80, 80, 80])).toEqual([3, 3, 3]);
  });

  it("computes MAE on 1..5 scale", () => {
    const ratings = [1, 2, 3, 4, 5];
    const scores = [10, 20, 30, 40, 50];
    expect(computeScale5MAE(ratings, scores)).toBe(0);
  });

  it("passes the AI-vs-golden gate with clean mock scores (exit 0)", () => {
    const { targets } = generateCohort({ seed: SEED });
    const cleanScores = generateMockScores(targets, { seed: SEED, noiseLevel: "clean" });

    const rows = Object.entries(targets).map(([id, target]) => ({
      profileResumeId: id,
      rating: target.overall,
      score: cleanScores[id],
    }));

    const result = runGateChecks(rows);
    expect(result.passed).toBe(true);
    expect(result.metrics.n).toBe(35);
    expect(result.metrics.qwk).toBeGreaterThanOrEqual(0.65);
    expect(result.metrics.spearmanRho).toBeGreaterThanOrEqual(0.70);
    expect(result.metrics.ndcg10).toBeGreaterThanOrEqual(0.85);
    expect(result.metrics.mae).toBeLessThanOrEqual(0.75);
  });

  it("fails / degrades the AI-vs-golden gate with noisy mock scores (exit 2)", () => {
    const { targets } = generateCohort({ seed: SEED });
    const noisyScores = generateMockScores(targets, { seed: SEED, noiseLevel: "noisy" });

    const rows = Object.entries(targets).map(([id, target]) => ({
      profileResumeId: id,
      rating: target.overall,
      score: noisyScores[id],
    }));

    const result = runGateChecks(rows);
    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("evaluates multi-rater panel gate with substantial Fleiss kappa (>= 0.61)", () => {
    const { targets } = generateCohort({ seed: SEED });
    const cleanScores = generateMockScores(targets, { seed: SEED, noiseLevel: "clean" });
    const rows = Object.entries(targets).map(([id, target]) => ({
      profileResumeId: id,
      rating: target.overall,
      score: cleanScores[id],
    }));

    // Construct concordant 3-rater panel
    const panelRows = [];
    for (const [id, target] of Object.entries(targets)) {
      const r = target.overall;
      panelRows.push({ rater: "r1", profile: id, dim: "overall", rating: r });
      panelRows.push({ rater: "r2", profile: id, dim: "overall", rating: r });
      panelRows.push({ rater: "r3", profile: id, dim: "overall", rating: Math.min(5, Math.max(1, r)) });
    }

    const result = runGateChecks(rows, panelRows);
    expect(result.passed).toBe(true);
    expect(result.metrics.panelFleiss).toBeDefined();
    expect(result.metrics.panelFleiss!).toBeGreaterThanOrEqual(0.61);
    expect(result.checks.panelCheck).toBe(true);
  });

  it("fails multi-rater panel gate when Fleiss kappa < 0.61", () => {
    const { targets } = generateCohort({ seed: SEED });
    const cleanScores = generateMockScores(targets, { seed: SEED, noiseLevel: "clean" });
    const rows = Object.entries(targets).map(([id, target]) => ({
      profileResumeId: id,
      rating: target.overall,
      score: cleanScores[id],
    }));

    // Construct discordant 3-rater panel
    const panelRows = [];
    let i = 0;
    for (const [id] of Object.entries(targets)) {
      panelRows.push({ rater: "r1", profile: id, dim: "overall", rating: (i % 5) + 1 });
      panelRows.push({ rater: "r2", profile: id, dim: "overall", rating: ((i + 2) % 5) + 1 });
      panelRows.push({ rater: "r3", profile: id, dim: "overall", rating: ((i + 4) % 5) + 1 });
      i++;
    }

    const result = runGateChecks(rows, panelRows);
    expect(result.passed).toBe(false);
    expect(result.checks.panelCheck).toBe(false);
    expect(result.errors.some((e) => e.includes("Panel Fleiss kappa failed"))).toBe(true);
  });

  it("handles CLI file-level execution and writes REPORT.md and JSON artifacts", () => {
    const testDir = "tmp/test-my-cohort-gate";
    mkdirSync(testDir, { recursive: true });

    const cohortCsv = `${testDir}/cohort.csv`;
    const scoresCsv = `${testDir}/scores.csv`;
    const reportMd = `${testDir}/REPORT.md`;
    const outDir = `${testDir}/artifacts`;

    const { targets } = generateCohort({ seed: SEED });
    const cleanScores = generateMockScores(targets, { seed: SEED, noiseLevel: "clean" });

    // Write cohort.csv
    let cohortLines = ["profileResumeId,board,rating,score"];
    for (const [id, target] of Object.entries(targets)) {
      cohortLines.push(`${id},general,${target.overall},`);
    }
    writeFileSync(cohortCsv, cohortLines.join("\n"), "utf-8");

    // Write scores.csv
    let scoreLines = ["profileResumeId,score"];
    for (const [id] of Object.entries(targets)) {
      scoreLines.push(`${id},${cleanScores[id]}`);
    }
    writeFileSync(scoresCsv, scoreLines.join("\n"), "utf-8");

    const { exitCode, gateResult } = executeGate({
      cohortCsvPath: cohortCsv,
      scoresCsvPath: scoresCsv,
      reportMdPath: reportMd,
      artifactDir: outDir,
    });

    expect(exitCode).toBe(0);
    expect(gateResult.passed).toBe(true);
    expect(existsSync(reportMd)).toBe(true);
    expect(existsSync(`${outDir}/my-cohort-gate-eval.json`)).toBe(true);

    const reportContent = readFileSync(reportMd, "utf-8");
    expect(reportContent).toContain("# MY Scoring Cohort Evaluation & Gate Report");
    expect(reportContent).toContain("PASS");
    expect(reportContent).toContain("QWK (Quadratic Weighted Kappa)");

    // Clean up
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns exit code 1 on missing cohort file", () => {
    const { exitCode } = executeGate({
      cohortCsvPath: "non-existent-cohort.csv",
    });
    expect(exitCode).toBe(1);
  });
});
