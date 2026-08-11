import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { INDUSTRY_MAINTENANCE_TRIGGER_REASONS } from "@trends/shared";

const SCRIPTS_DIR = "scripts/industry-data";

const TRIGGER_REASONS_RE = /triggerReasons:\s*\[([^\]]*)\]/g;
const STRING_LITERAL_RE = /"([^"]+)"/g;

/**
 * Every trigger reason written by the industry-data bootstrap scripts must
 * be a member of the shared enum. The BFF proposal parser silently drops
 * rows whose triggerReasons contain unknown values (terminal-status records
 * are skipped on parse failure), so drift makes approved proposals
 * invisible to /start and the review queue (incident 2026-08-10:
 * ["curated"] / ["corpus_evidence"] missing from the enum).
 */
function scriptTriggerReasons(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const fname of readdirSync(SCRIPTS_DIR)) {
    if (!fname.endsWith(".ts") || fname.endsWith(".test.ts")) continue;
    const text = readFileSync(join(SCRIPTS_DIR, fname), "utf-8");
    const reasons = [...text.matchAll(TRIGGER_REASONS_RE)]
      .flatMap((match) => [...match[1].matchAll(STRING_LITERAL_RE)])
      .map((match) => match[1]);
    if (reasons.length > 0) found.set(fname, reasons);
  }
  return found;
}

describe("industry-data script trigger reasons stay in the shared enum", () => {
  it("every triggerReasons literal is a member of INDUSTRY_MAINTENANCE_TRIGGER_REASONS", () => {
    const valid = new Set<string>(INDUSTRY_MAINTENANCE_TRIGGER_REASONS);
    const offenders: string[] = [];
    for (const [fname, reasons] of scriptTriggerReasons()) {
      for (const reason of reasons) {
        if (!valid.has(reason)) {
          offenders.push(`${fname}: "${reason}"`);
        }
      }
    }
    expect(offenders, `unknown trigger reasons (BFF parser drops these rows): ${offenders.join(", ")}`).toEqual([]);
  });

  it("the curated + corpus bootstrap lanes are covered by the guard", () => {
    const found = scriptTriggerReasons();
    expect(found.get("curate-my-cnc-employers.ts")).toContain("curated");
    expect(found.get("corpus-fast-track.ts")).toContain("corpus_evidence");
  });
});
