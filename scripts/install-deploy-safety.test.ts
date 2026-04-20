import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

const makefile = readFileSync(new URL("../Makefile", import.meta.url), "utf8");
const installScript = readFileSync(new URL("./install.sh", import.meta.url), "utf8");
const removedSeedEnvVar = "SEED_" + "RESUMES";

function getTargetRecipe(target: string): string {
  const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedTarget}:\\n((?:\\t.*\\n)+)`, "m");
  const match = makefile.match(pattern);
  if (!match || !match[1]) {
    throw new Error(`Missing Makefile recipe for target: ${target}`);
  }
  return match[1];
}

describe("install/deploy demo resume safety", () => {
  it("uses prod wrappers that never pass the removed resume-seed env var", () => {
    expect(getTargetRecipe("prod-install")).toContain("./scripts/install.sh install");
    expect(getTargetRecipe("prod-deploy")).toContain("./scripts/install.sh upgrade");
    expect(getTargetRecipe("prod-deploy-check")).toContain("./scripts/install.sh upgrade-check");
    expect(getTargetRecipe("prod-install")).not.toContain(removedSeedEnvVar);
    expect(getTargetRecipe("prod-deploy")).not.toContain(removedSeedEnvVar);
    expect(getTargetRecipe("prod-deploy-check")).not.toContain(removedSeedEnvVar);
  });

  it("keeps compatibility aliases mapped to prod wrappers", () => {
    expect(makefile).toMatch(/^install:\s+prod-install$/m);
    expect(makefile).toMatch(/^deploy:\s+prod-deploy$/m);
    expect(makefile).toMatch(/^deploy-check:\s+prod-deploy-check$/m);
  });

  it("removes dead install script logic for that env var", () => {
    expect(installScript).not.toContain(removedSeedEnvVar);
    expect(installScript).not.toContain('[[ -n "${SEED_' + 'RESUMES:-}" ]]');
  });
});

describe("seed_and_migrate_convex migration order", () => {
  const CANONICAL_MIGRATION_ORDER = [
    "backfillSourceKey",
    "backfillTaggingEnvelope",
    "backfillWorkspaceSlugs",
    "backfillJob5156ProfileUrls",
    "backfillJob5156WorkHistoryEducation",
    "backfillJob5156LocationHierarchy",
    "backfillManual51jobStructuredContent",
    "backfillIngestData",
    "backfillAge",
    "backfillSearchText",
    "backfillEvidenceText",
    "backfillPrimaryRuleScore",
    "reindexSearchText",
  ];

  let body = "";
  let migrations: string[] = [];

  function extractSeedAndMigrateBody(script: string): string {
    const startMarker = "seed_and_migrate_convex() {";
    const startIdx = script.indexOf(startMarker);
    if (startIdx === -1) {
      throw new Error("Could not find seed_and_migrate_convex in install.sh");
    }
    const bodyStart = script.indexOf("{", startIdx) + 1;
    let depth = 1;
    let i = bodyStart;
    while (i < script.length && depth > 0) {
      if (script[i] === "{") depth++;
      else if (script[i] === "}") depth--;
      if (depth > 0) i++;
    }
    if (depth !== 0) {
      throw new Error("Could not extract seed_and_migrate_convex body from install.sh");
    }
    return script.slice(bodyStart, i);
  }

  function extractMigrationCalls(fnBody: string): string[] {
    const calls: string[] = [];
    for (const line of fnBody.split("\n")) {
      const match = line.match(/^\s*run_convex_migration\s+"?\$convex_dir"?\s+"([^"]+)"/);
      if (match?.[1]) {
        calls.push(match[1]);
      }
    }
    return calls;
  }

  beforeAll(() => {
    body = extractSeedAndMigrateBody(installScript);
    migrations = extractMigrationCalls(body);
  });

  it("runs all migrations in dependency-correct order", () => {
    expect(migrations).toEqual(CANONICAL_MIGRATION_ORDER);
  });

  it("starts with backfillSourceKey (unblocks source-aware downstream)", () => {
    expect(migrations[0]).toBe("backfillSourceKey");
  });

  it("ends with reindexSearchText (rebuilds index over finalized content)", () => {
    expect(migrations.at(-1)).toBe("reindexSearchText");
  });

  it("passes batchSize to backfillManual51jobStructuredContent", () => {
    expect(body).toContain('backfillManual51jobStructuredContent');
    expect(body).toContain('{"batchSize":100}');
  });

  it("passes limit to backfillIngestData", () => {
    expect(body).toContain("backfillIngestData");
    expect(body).toContain('{"limit":100}');
  });
});
