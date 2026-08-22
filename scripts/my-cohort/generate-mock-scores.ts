/**
 * CLI runner to generate mock scores CSV for the MY cohort.
 *
 * Usage:
 *   bun run scripts/my-cohort/generate-mock-scores.ts --noise clean --out tmp/my-cohort/scores-clean.csv
 *   bun run scripts/my-cohort/generate-mock-scores.ts --noise noisy --out tmp/my-cohort/scores-noisy.csv
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateMockScores } from "./mock-scorer.js";

function main() {
  const args = process.argv.slice(2);
  const argValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const noise = (argValue("--noise") ?? "clean") as "clean" | "noisy";
  const targetsPath = resolve(argValue("--targets") ?? "tmp/my-cohort/targets.json");
  const outPath = resolve(argValue("--out") ?? `tmp/my-cohort/scores-${noise}.csv`);

  const targetsFile = JSON.parse(readFileSync(targetsPath, "utf-8"));
  const targets = targetsFile.targets ?? targetsFile;
  const scores = generateMockScores(targets, { noiseLevel: noise });

  const lines = ["profileResumeId,score"];
  for (const [id, s] of Object.entries(scores)) {
    lines.push(`${id},${s}`);
  }

  writeFileSync(outPath, lines.join("\n") + "\n", "utf-8");
  console.log(`Wrote mock scores (${noise}) to ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
