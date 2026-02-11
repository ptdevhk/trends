import { MatchStorage } from "../apps/api/src/services/match-storage.js";
import { ResumeService } from "../apps/api/src/services/resume-service.js";
import { JobDescriptionService } from "../apps/api/src/services/job-description-service.js";
import { RuleScoringService } from "../apps/api/src/services/rule-scoring.js";
import { resolveResumeId } from "../apps/api/src/services/resume-id.js";

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const sampleArg = readArg("--sample");
  const limitArg = readArg("--limit");
  const onlyJob = readArg("--job");
  const clearFirst = hasFlag("--clear");

  const resumeService = new ResumeService();
  const jobService = new JobDescriptionService();
  const ruleScoringService = new RuleScoringService();
  const matchStorage = new MatchStorage();

  const samples = resumeService.listSampleFiles();
  if (samples.length === 0) {
    console.log("No resume samples found in output/resumes/samples. Skipping seed-matches.");
    return;
  }

  const resolvedSample = sampleArg
    ? samples.find((sample) => sample.name === sampleArg || sample.filename === sampleArg || `${sample.name}.json` === sampleArg)
    : samples[0];

  if (!resolvedSample) {
    console.log(`Sample not found: ${sampleArg}. Available samples: ${samples.map((item) => item.name).join(", ")}`);
    return;
  }

  const { items, indexes } = resumeService.loadSample(resolvedSample.name);
  const limit = limitArg ? Math.max(1, Number.parseInt(limitArg, 10)) : items.length;
  const limitedItems = Number.isFinite(limit) ? items.slice(0, limit) : items;

  const allJds = jobService.listFiles().filter((jd) => jd.status !== "closed");
  const jds = onlyJob
    ? allJds.filter((jd) => jd.name === onlyJob || jd.id === onlyJob)
    : allJds;

  if (jds.length === 0) {
    console.log("No job descriptions available for seed-matches. Skipping.");
    return;
  }

  if (clearFirst) {
    const deleted = matchStorage.clearMatches();
    console.log(`Cleared existing matches: ${deleted}`);
  }

  let inserted = 0;

  for (const jd of jds) {
    const context = ruleScoringService.buildContext(jd.name);
    const entries = limitedItems.map((resume, index) => {
      const resumeId = resolveResumeId(resume, index);
      const indexData = indexes.get(resumeId);
      if (!indexData) {
        return null;
      }

      const result = ruleScoringService.scoreResume(indexData, context);
      return {
        sessionId: undefined,
        resumeId,
        jobDescriptionId: jd.name,
        sampleName: resolvedSample.name,
        result: ruleScoringService.toMatchingResult(result),
        aiModel: "rule-scoring",
        processingTimeMs: 0,
      };
    }).filter((entry) => entry !== null);

    if (entries.length > 0) {
      matchStorage.saveMatches(entries);
      inserted += entries.length;
    }

    console.log(`Seeded ${entries.length} matches for JD ${jd.name}`);
  }

  console.log(`Done. Seeded ${inserted} deterministic matches from sample ${resolvedSample.name}.`);
}

main().catch((error) => {
  console.error("seed-matches failed:", error);
  process.exit(1);
});
