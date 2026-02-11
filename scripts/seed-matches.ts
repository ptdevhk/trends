import path from "node:path";

import { findProjectRoot } from "../apps/api/src/services/db.js";
import { DataNotFoundError } from "../apps/api/src/services/errors.js";
import { JobDescriptionService } from "../apps/api/src/services/job-description-service.js";
import { MatchStorage } from "../apps/api/src/services/match-storage.js";
import { ResumeService } from "../apps/api/src/services/resume-service.js";
import { RuleScoringService } from "../apps/api/src/services/rule-scoring.js";
import { resolveResumeId } from "../apps/api/src/services/resume-utils.js";

type CliOptions = {
  sampleName?: string;
  limit?: number;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--sample" && argv[i + 1]) {
      options.sampleName = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--limit" && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        console.error(`Invalid --limit: ${argv[i + 1]}`);
        process.exit(1);
      }
      options.limit = Math.floor(parsed);
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: seed-matches.ts [--sample <name>] [--limit <n>]");
      process.exit(0);
    }
    console.error(`Unknown arg: ${arg}`);
    console.log("Usage: seed-matches.ts [--sample <name>] [--limit <n>]");
    process.exit(1);
  }

  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = findProjectRoot();

  const resumeService = new ResumeService(projectRoot);
  const jobService = new JobDescriptionService(projectRoot);
  const matchStorage = new MatchStorage(projectRoot);
  const scorer = new RuleScoringService(projectRoot);

  const defaultSampleName = options.sampleName ?? "sample-initial";
  let sampleName = defaultSampleName;

  let items: Array<Parameters<typeof resolveResumeId>[0]> = [];
  let sampleMeta: { name: string } = { name: sampleName };

  try {
    const loaded = resumeService.loadSample(sampleName);
    items = loaded.items;
    sampleMeta = { name: loaded.sample.name };
    sampleName = loaded.sample.name;
  } catch (error) {
    if (error instanceof DataNotFoundError) {
      console.log(`[seed-matches] ${error.message}`);
      console.log("[seed-matches] Skipping (no resume samples found).");
      return;
    }
    throw error;
  }

  const effectiveItems = typeof options.limit === "number" ? items.slice(0, options.limit) : items;
  if (effectiveItems.length === 0) {
    console.log("[seed-matches] No resumes found in sample, skipping.");
    return;
  }

  const resumeIds = effectiveItems.map((resume, index) => resolveResumeId(resume, index));
  const indexService = resumeService.getIndexService();

  const jobFiles = jobService.listFiles().filter((file) => file.filename.toLowerCase() !== "readme.md");
  if (jobFiles.length === 0) {
    console.log("[seed-matches] No job descriptions found, skipping.");
    return;
  }

  console.log(`[seed-matches] Project root: ${projectRoot}`);
  console.log(`[seed-matches] Sample: ${sampleName} (${effectiveItems.length} resumes)`);
  console.log(`[seed-matches] Job descriptions: ${jobFiles.length}`);
  console.log(`[seed-matches] Output DB: ${path.join(projectRoot, "output", "resume_screening.db")}`);

  let totalUpserts = 0;
  let totalSkippedAi = 0;

  for (const jobFile of jobFiles) {
    const jd = jobService.loadFile(jobFile.name);

    const existing = matchStorage.getMatchesByResumeIds(resumeIds, jobFile.name);
    const existingMap = new Map(existing.map((match) => [match.resumeId, match]));

    const entries: Array<Parameters<MatchStorage["saveMatch"]>[0]> = [];
    for (let i = 0; i < effectiveItems.length; i += 1) {
      const resumeId = resumeIds[i];
      const cached = existingMap.get(resumeId);
      if (cached?.aiModel && cached.aiModel !== "rule") {
        totalSkippedAi += 1;
        continue;
      }

      const index = indexService.get(resumeId);
      if (!index) {
        console.error(`[seed-matches] Missing index for resume: ${resumeId}`);
        continue;
      }

      const rule = scorer.scoreResume(index, jd);
      const result = scorer.toMatchingResult(rule);

      entries.push({
        resumeId,
        jobDescriptionId: jobFile.name,
        sampleName: sampleMeta.name,
        result,
        aiModel: "rule",
        processingTimeMs: 0,
      });
    }

    if (entries.length) {
      matchStorage.saveMatches(entries);
      totalUpserts += entries.length;
    }
  }

  console.log(`[seed-matches] Done. Upserted: ${totalUpserts}, skipped existing AI: ${totalSkippedAi}`);
}

main();

