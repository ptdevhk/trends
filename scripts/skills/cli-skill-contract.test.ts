import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const scoringAudit = readFileSync(
  new URL("../../dev-docs/skills/resume-ai-scoring-audit/SKILL.md", import.meta.url),
  "utf8",
);
const config = readFileSync(
  new URL("../../.claude/dev-loop.config.md", import.meta.url),
  "utf8",
);

describe("trends skill CLI contracts", () => {
  it("scoring-audit uses live system metadata, not nonexistent system config", () => {
    expect(scoringAudit).not.toMatch(/\.\/bin\/trends system config\b/);
    expect(scoringAudit).toMatch(/\.\/bin\/trends system metadata\b/);
  });

  it("collection_ingest critical path points at salary.ts", () => {
    expect(config).toContain("packages/shared/src/salary.ts");
    expect(config).not.toContain("packages/shared/src/parseSalaryRange.ts");
  });
});
