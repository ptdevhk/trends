import { findProjectRoot } from "../apps/api/src/services/db.js";
import { MatchStorage } from "../apps/api/src/services/match-storage.js";

function main(): void {
  const root = findProjectRoot();
  const storage = new MatchStorage(root);
  const deleted = storage.clearAllMatches();
  console.log(`[clear-matches] Deleted ${deleted} rows from resume_matches`);
}

main();

