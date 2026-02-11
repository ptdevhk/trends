import { MatchStorage } from "../apps/api/src/services/match-storage.js";

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const jobDescriptionId = readArg("--job") || readArg("--jobDescriptionId");
  const matchStorage = new MatchStorage();
  const deleted = matchStorage.clearMatches(jobDescriptionId);
  console.log(
    jobDescriptionId
      ? `Cleared ${deleted} matches for ${jobDescriptionId}`
      : `Cleared ${deleted} matches`
  );
}

main().catch((error) => {
  console.error("clear-matches failed:", error);
  process.exit(1);
});
