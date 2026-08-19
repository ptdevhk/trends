import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const makefile = readFileSync(new URL("../Makefile", import.meta.url), "utf8");
const migrationTestRunner = readFileSync(new URL("./migration-test-run.sh", import.meta.url), "utf8");
const migrationTestVerifier = readFileSync(new URL("./migration-test-verify.sh", import.meta.url), "utf8");
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

  it("exposes the industry-review UAT fixture setup script with the local-write opt-in flag", () => {
    // The setup script refuses to run without --allow-local-write
    // (scripts/industry-review/setup-local-uat.ts), so the documented gate
    // invocation `bun run setup:industry-review-uat` must forward the flag.
    expect(packageJson.scripts?.["setup:industry-review-uat"]).toBe(
      "tsx scripts/industry-review/setup-local-uat.ts --allow-local-write",
    );
  });

  it("exposes the reusable local demo auth bootstrap script through package.json", () => {
    expect(packageJson.scripts?.["auth:bootstrap-demo"]).toBe(
      'tsx scripts/auth/manage-user.ts --username demo-admin --email demo-admin@example.com --display-name "Demo Admin" --workspace dev --role admin --replace-memberships --password-env AUTH_BOOTSTRAP_PASSWORD --output json',
    );
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
    expect(migrationTestRunner).toContain('git ls-files -z -o -i --exclude-standard output/');
    expect(migrationTestRunner).toContain('output/resume-backups|output/resume-backups/*');
    expect(migrationTestRunner).toContain('packages/convex/.convex/local');
    expect(migrationTestRunner).toContain('cp scripts/migration-test-verify.sh "$VERIFY_SCRIPT"');
    expect(migrationTestRunner).toContain('ORIGINAL_BRANCH=$(git branch --show-current');
    expect(migrationTestRunner).toContain("clear_resumes_until_complete()");
    expect(migrationTestRunner).toContain('CLEAR_RESUMES_MAX_ATTEMPTS:-150');
    expect(migrationTestRunner).toContain('"partial"[[:space:]]*:[[:space:]]*true');
    expect(migrationTestRunner).toContain("clear-resumes returned partial:true");
  });

  it("fails migration test when post-upgrade count differs from the baseline", () => {
    expect(migrationTestRunner).toMatch(/FAIL: Resume count mismatch![\s\S]*return 1/);
  });

  it("authenticates migration verifier API checks when resume routes are protected", () => {
    expect(migrationTestVerifier).toContain("scripts/auth/manage-user.ts");
    expect(migrationTestVerifier).toContain("/api/auth/login");
    expect(migrationTestVerifier).toContain("api_get()");
  });
});
