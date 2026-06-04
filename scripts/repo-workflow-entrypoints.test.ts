import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const makefile = readFileSync(new URL("../Makefile", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts?: Record<string, string>;
};

function getTargetRecipe(target: string): string {
  const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedTarget}:\\n((?:\\t.*\\n)+)`, "m");
  const match = makefile.match(pattern);
  if (!match || !match[1]) {
    throw new Error(`Missing Makefile recipe for target: ${target}`);
  }
  return match[1];
}

describe("workflow verifier repo entrypoints", () => {
  it("exposes the workflow verifier through package.json", () => {
    expect(packageJson.scripts?.["verify:workflow-dataset"]).toBe("tsx scripts/resume/verify-workflow-dataset.ts");
  });

  it("exposes the workspace-demo cleanup script through package.json", () => {
    expect(packageJson.scripts?.["clear:workspace-demo-resumes"]).toBe("tsx scripts/resume/clear-workspace-demo-resumes.ts");
  });

  it("exposes a Make target with the expected forwarding flags", () => {
    const recipe = getTargetRecipe("verify-workflow-dataset");

    expect(recipe).toContain('set -- --query "$(or $(QUERY),CNC Sales)"');
    expect(recipe).toContain('--workspace "$(or $(WORKSPACE),dev)"');
    expect(recipe).toContain('--source-key "$(SOURCE_KEY)"');
    expect(recipe).toContain('--api-base-url "$(API_BASE_URL)"');
    expect(recipe).toContain('--json');
    expect(recipe).toContain('scripts/resume/verify-workflow-dataset.ts "$$@" $(ARGS)');
  });

  it("documents the workflow verifier in Make help output", () => {
    expect(makefile).toContain('verify-workflow-dataset Verify source mix, query matches, and visible results for a resume workflow dataset');
    expect(makefile).toContain('QUERY          Query for verify-workflow-dataset (default: CNC Sales)');
    expect(makefile).toContain('SOURCE_KEY     Source key filter for verify-workflow-dataset (e.g. seek, job5156)');
    expect(makefile).toContain('API_BASE_URL   API base URL override for verify-workflow-dataset');
  });

  it("exposes a targeted workspace-demo resume cleanup make target", () => {
    const recipe = getTargetRecipe("seed-clear-demo-resumes");

    expect(recipe).toContain('bun scripts/resume/clear-workspace-demo-resumes.ts');
    expect(recipe).toContain('npx tsx scripts/resume/clear-workspace-demo-resumes.ts');
    expect(makefile).toContain('seed-clear-demo-resumes Clear only demo resumes tagged workspace-demo');
  });

  it("exposes a guarded fresh-sandbox migration test helper", () => {
    const recipe = getTargetRecipe("migration-test-fresh-sandbox");

    expect(recipe).toContain('YES=1 is required for migration-test-fresh-sandbox');
    expect(recipe).toContain('RESET_MODE=fresh-sandbox');
    expect(recipe).toContain('CONFIRM_FRESH_SANDBOX=1');
    expect(makefile).toContain('migration-test-fresh-sandbox Run migration-test after a guarded full local app-state reset');
  });
});
