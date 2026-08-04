import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const makefile = readFileSync(new URL("../Makefile", import.meta.url), "utf8");
const installScript = readFileSync(new URL("./install.sh", import.meta.url), "utf8");
const devScript = readFileSync(new URL("./dev.sh", import.meta.url), "utf8");
const convexPackageJson = JSON.parse(
  readFileSync(new URL("../packages/convex/package.json", import.meta.url), "utf8"),
) as { scripts: Record<string, string | undefined> };
const setupPreviewScript = readFileSync(new URL("../deploy/setup-preview.sh", import.meta.url), "utf8");
const restorePreviewScript = readFileSync(new URL("../deploy/restore-preview-from-prod.sh", import.meta.url), "utf8");
const restorePreviewFullStateScript = readFileSync(new URL("../deploy/restore-preview-full-state-from-prod.sh", import.meta.url), "utf8");
const syncPreviewConvexEnvScript = readFileSync(new URL("../deploy/sync-preview-convex-env.sh", import.meta.url), "utf8");
const previewDoctorScript = readFileSync(new URL("../deploy/preview-doctor.sh", import.meta.url), "utf8");
const previewMcpDockerfile = readFileSync(new URL("../deploy/docker/Dockerfile.mcp", import.meta.url), "utf8");
const previewCompose = readFileSync(new URL("../deploy/docker/docker-compose.preview.yml", import.meta.url), "utf8");
const previewConvexStartScript = readFileSync(new URL("../deploy/docker/start-convex.sh", import.meta.url), "utf8");
const productionConvexService = readFileSync(new URL("../deploy/systemd/trends-convex.service", import.meta.url), "utf8");
const rehearsalOrchestrator = readFileSync(new URL("../deploy/preview-rehearse-backup.sh", import.meta.url), "utf8");
const completeBackupLibrary = readFileSync(new URL("../deploy/lib-complete-backup.sh", import.meta.url), "utf8");
const migrationLibrary = readFileSync(new URL("../deploy/lib-convex-migrations.sh", import.meta.url), "utf8");
const rehearsalRestoreWorker = readFileSync(new URL("../deploy/restore-preview-from-backup.sh", import.meta.url), "utf8");
const rehearsalMigrationRunner = readFileSync(new URL("../deploy/preview-run-migrations.sh", import.meta.url), "utf8");
const rehearsalVerifier = readFileSync(new URL("../deploy/preview-verify-snapshot.sh", import.meta.url), "utf8");
const rehearsalBrowserSmoke = readFileSync(new URL("./preview-rehearsal-browser-smoke.ts", import.meta.url), "utf8");
const rehearsalAllowlist = readFileSync(new URL("../deploy/preview-output-restore.allowlist", import.meta.url), "utf8");
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

function extractShellFunction(script: string, functionName: string): string {
  const startMarker = `${functionName}() {`;
  const startIdx = script.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(`Could not find ${functionName}`);
  }
  const bodyStart = script.indexOf("{", startIdx) + 1;
  let depth = 1;
  let index = bodyStart;
  while (index < script.length && depth > 0) {
    if (script[index] === "{") depth++;
    else if (script[index] === "}") depth--;
    if (depth > 0) index++;
  }
  if (depth !== 0) {
    throw new Error(`Could not extract ${functionName} body`);
  }
  return script.slice(bodyStart, index);
}

function expectBefore(source: string, first: string, second: string): void {
  expect(source).toContain(first);
  expect(source).toContain(second);
  expect(source.indexOf(first)).toBeLessThan(source.indexOf(second));
}

describe("install/deploy demo resume safety", () => {
  it("uses prod wrappers that never pass the removed resume-seed env var", () => {
    expect(getTargetRecipe("on-prod-install")).toContain("./scripts/install.sh install");
    expect(getTargetRecipe("on-prod-deploy")).toContain("./scripts/install.sh upgrade");
    expect(getTargetRecipe("on-prod-deploy-check")).toContain("./scripts/install.sh upgrade-check");
    expect(getTargetRecipe("on-prod-install")).not.toContain(removedSeedEnvVar);
    expect(getTargetRecipe("on-prod-deploy")).not.toContain(removedSeedEnvVar);
    expect(getTargetRecipe("on-prod-deploy-check")).not.toContain(removedSeedEnvVar);
  });

  it("keeps compatibility aliases mapped to prod wrappers", () => {
    expect(makefile).toMatch(/^prod-install:\s+on-prod-install$/m);
    expect(makefile).toMatch(/^install:\s+on-prod-install$/m);
    expect(makefile).toMatch(/^prod-deploy:\s+on-prod-deploy$/m);
    // deploy/deploy-check are context-aware (preview vs /opt/trends); prod aliases stay explicit
    expect(makefile).toMatch(/^prod-deploy-check:\s+on-prod-deploy-check$/m);
    expect(getTargetRecipe("deploy")).toContain("preview-upgrade.sh");
    expect(getTargetRecipe("deploy")).toContain("on-prod-deploy");
    expect(getTargetRecipe("deploy-check")).toContain("preview-preflight.sh");
    expect(getTargetRecipe("deploy-check")).toContain("on-prod-deploy-check");
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
    "validateDataConsistency",
  ];

  let body = "";
  let migrations: string[] = [];

  beforeAll(() => {
    body = extractShellFunction(installScript, "seed_and_migrate_convex");
    migrations = migrationLibrary
      .slice(
        migrationLibrary.indexOf("convex_migration_declarations()"),
        migrationLibrary.indexOf("convex_migration_declaration_hash()"),
      )
      .split("\n")
      .map((line) => line.match(/^([A-Za-z][A-Za-z0-9]*)\t/u)?.[1])
      .filter((value): value is string => Boolean(value));
  });

  it("runs all migrations in dependency-correct order", () => {
    expect(migrations).toEqual(CANONICAL_MIGRATION_ORDER);
  });

  it("starts with backfillSourceKey (unblocks source-aware downstream)", () => {
    expect(migrations[0]).toBe("backfillSourceKey");
  });

  it("ends with validateDataConsistency (repairs finalized derived fields and digests)", () => {
    expect(migrations.at(-1)).toBe("validateDataConsistency");
  });

  it("passes batchSize to backfillManual51jobStructuredContent", () => {
    expect(migrationLibrary).toContain('backfillManual51jobStructuredContent\t{"batchSize":100}');
  });

  it("passes limit to backfillIngestData", () => {
    expect(migrationLibrary).toContain('backfillIngestData\t{"limit":100}');
  });

  it("keeps production on the shared declaration stream through a compatibility wrapper", () => {
    expect(body).toContain('run_convex_migration_sequence "$convex_dir"');
    expect(installScript).toContain("run_convex_migration_loop");
  });
});

describe("historical preview rehearsal repository contracts", () => {
  it("exposes the five attended Make entrypoints and help text", () => {
    for (const target of [
      "on-host-preview-rehearse-backup",
      "on-host-preview-rehearse-resume",
      "on-host-preview-rehearse-rollback",
      "on-host-preview-verify-snapshot",
      "on-host-preview-run-migrations",
    ]) {
      expect(makefile).toContain(`${target}:`);
      expect(makefile).toContain(target);
    }
  });

  it("requires a selected backup and never runs a live production Convex export", () => {
    expect(rehearsalOrchestrator).toContain("new run requires --backup-dir and --target-ref");
    expect(completeBackupLibrary).toContain("complete_backup_validate");
    expect(rehearsalRestoreWorker).not.toMatch(/PROD_DIR[\s\S]{0,200}convex export/u);
  });

  it("shares one migration declaration stream with validation last", () => {
    expect(installScript).toContain("deploy/lib-convex-migrations.sh");
    expect(rehearsalMigrationRunner).toContain("run_convex_migration_sequence");
    expect(migrationLibrary.lastIndexOf("validateDataConsistency")).toBeGreaterThan(
      migrationLibrary.lastIndexOf("backfillPrimaryRuleScore"),
    );
  });

  it("stops at baseline approval, requires browser evidence, and keeps rollback explicit", () => {
    expect(rehearsalOrchestrator).toContain("awaiting-approval");
    expect(rehearsalOrchestrator).toContain("awaiting-browser-evidence");
    expect(rehearsalOrchestrator).toContain("validate_browser_evidence");
    expect(rehearsalOrchestrator).toContain("--phase rollback");
    expect(rehearsalVerifier).toContain("--mode baseline|upgraded");
    expect(rehearsalBrowserSmoke).toContain("newContext({ storageState: undefined })");
  });

  it("restores only the exact approved persistent output path", () => {
    const entries = rehearsalAllowlist
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    expect(entries).toEqual(["output/resumes/location-info/job5156-location-info.json"]);
    expect(rehearsalAllowlist).not.toMatch(/[*?[]/u);
  });
});

describe("production deploy readiness checks", () => {
  it("validates auth env before production install, upgrade, env-only, and upgrade-check paths", () => {
    expect(installScript).toContain("validate_auth_env()");
    expect(installScript).toContain("scripts/check-auth-env.ts");
    expect(installScript).toContain("--mode production");
    expect(extractShellFunction(installScript, "validate_auth_env")).toContain("run_tsx_script");

    const tsxRunner = extractShellFunction(installScript, "run_tsx_script");
    expect(tsxRunner).toContain("command -v bun");
    expectBefore(tsxRunner, "bunx tsx", "npx tsx");

    expectBefore(extractShellFunction(installScript, "install_flow"), "validate_auth_env", "deploy_env_file");
    expectBefore(extractShellFunction(installScript, "full_upgrade_steps"), "validate_auth_env", "deploy_env_file");
    expectBefore(extractShellFunction(installScript, "env_only_upgrade_steps"), "validate_auth_env", "deploy_env_file");
    expectBefore(extractShellFunction(installScript, "upgrade_check_flow"), "validate_auth_env", "plan_upgrade_action");
  });

  it("uses the real API health route for production readiness and operator guidance", () => {
    expect(installScript).toContain("wait_for_api_health()");
    expect(installScript).toContain("/health");
    expect(installScript).not.toContain("127.0.0.1:3000/api/health");
  });

  it("does not use anonymous admin-gated search profile routes as preview smoke checks", () => {
    expect(restorePreviewScript).not.toContain("/api/search-profiles");
    expect(restorePreviewFullStateScript).not.toContain("/api/search-profiles");
    expect(previewDoctorScript).not.toContain("/api/search-profiles");

    // restore-preview-from-prod uses Convex CLI direct (check_preview_resume_page)
    expect(restorePreviewScript).toContain("check_preview_resume_page");
    // restore-preview-full-state and preview-doctor use public HTTP API endpoint
    expect(restorePreviewFullStateScript).toContain("/api/resumes?source=convex&paged=true&limit=1");
    expect(previewDoctorScript).toContain("/api/resumes?source=convex&paged=true&limit=1");
  });

  it("runs a bounded preview AI analysis smoke after production-state restores", () => {
    expect(restorePreviewScript).toContain("run_preview_ai_smoke");
    expect(restorePreviewScript).toContain("SKIP_PREVIEW_AI_SMOKE");
    expect(restorePreviewScript).toContain("scripts/verify-critical-path.ts");
    expect(restorePreviewScript).toContain("--mode=seeded");
    expect(restorePreviewScript).toContain("ANALYSIS_TIMEOUT_SEC");

    expect(restorePreviewFullStateScript).toContain("run_preview_ai_smoke");
    expect(restorePreviewFullStateScript).toContain("SKIP_PREVIEW_AI_SMOKE");
  });
});

describe("non-Docker Convex startup safety", () => {
  it("prints dev-convex-status without ps errors when no local Convex process is running", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "trends-convex-status-"));

    try {
      const result = spawnSync("make", ["dev-convex-status"], {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          // Randomize BOTH ports so the test reaches the "no local Convex
          // processes found" branch deterministically regardless of whether a
          // real dev stack is listening on the default 3210/3211 ports on this
          // host. Distinct ranges avoid the two randoms colliding with each
          // other; both sit well clear of the default ports.
          CONVEX_PORT: String(39000 + Math.floor(Math.random() * 10000)),
          CONVEX_SITE_PORT: String(49000 + Math.floor(Math.random() * 10000)),
          CONVEX_STATE_DIR: tempDir,
        },
      });
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

      expect(result.status).toBe(0);
      expect(output).toContain("No local Convex processes found.");
      expect(output).not.toContain("list of process IDs must follow -p");
      expect(output).not.toContain("Usage:");
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it("routes make dev-convex through the hardened non-Docker dev script path", () => {
    const recipe = getTargetRecipe("dev-convex");

    expect(recipe).toContain("./scripts/dev.sh --convex-only --no-seed");
    expect(recipe).not.toContain("docker");
    expect(recipe).not.toContain("compose");
    expect(recipe).not.toContain("cd packages/convex");
  });

  it("routes detached Convex refresh through the same non-Docker dev script path", () => {
    const recipe = getTargetRecipe("dev-convex-refresh");

    expect(recipe).toContain("$(MAKE) dev-convex");
    expect(recipe).not.toContain("cd '$$project_root/packages/convex'");
    expect(recipe).not.toContain("bun run dev");
    expect(recipe).not.toContain("npm run dev");
    expect(recipe).not.toContain("docker");
    expect(recipe).not.toContain("compose");
  });

  it("exposes a convex-only dev script mode without Docker compose", () => {
    const optionStart = devScript.indexOf("--convex-only)");
    const nextOptionStart = devScript.indexOf("--mcp-only)", optionStart);
    const optionBranch = devScript.slice(optionStart, nextOptionStart);

    expect(devScript).toContain("--convex-only");
    expect(optionBranch).toContain('services=("convex")');
    expect(optionBranch).not.toContain("docker");
    expect(optionBranch).not.toContain("compose");
  });

  it("does not force-upgrade local Convex package scripts", () => {
    expect(convexPackageJson.scripts.dev).toContain("convex dev --local");
    expect(convexPackageJson.scripts.predev).toContain("convex dev --once --local");
    expect(convexPackageJson.scripts.dev).not.toContain("--local-force-upgrade");
    expect(convexPackageJson.scripts.predev).not.toContain("--local-force-upgrade");
  });

  it("does not force-upgrade the production Convex systemd service", () => {
    expect(productionConvexService).toContain("ExecStart=/usr/bin/npx convex dev --local");
    expect(productionConvexService).not.toContain("--local-force-upgrade");
  });

  it("does not force-upgrade the install-time Convex schema push", () => {
    const setupConvexLocal = extractShellFunction(installScript, "setup_convex_local");

    expect(setupConvexLocal).toContain("npx convex dev --local --once");
    expect(setupConvexLocal).not.toContain("--local-force-upgrade");
  });

  it("keeps dev-script force upgrade opt-in only", () => {
    expect(devScript).toContain('local local_mode_requested="true"');
    expect(devScript).toContain('CONVEX_LOCAL_FORCE_UPGRADE:-false');
    expect(devScript).toContain(
      "CONVEX_LOCAL_FORCE_UPGRADE Enable --local-force-upgrade on first attempt: true|false (default: false)",
    );
  });
});

describe("preview restore export compatibility", () => {
  it("strips removed screening-session fields before importing production data", () => {
    expect(restorePreviewScript).toContain("showBlocked");
    expect(restorePreviewScript).toContain("Stripped showBlocked");
  });

  it("materializes missing preview schema tables as empty before replace-all import", () => {
    expect(restorePreviewScript).toContain("packages/convex/convex/schema.ts");
    expect(restorePreviewScript).toContain("defineTable");
    expect(restorePreviewScript).toContain("generated_schema.jsonl");
    expect(restorePreviewScript).toContain("documents.jsonl");
    expect(restorePreviewScript).toContain("Materialized missing schema tables as empty");
  });

  it("supports optional digest backfill in bounded batches after replace-all import", () => {
    // Default is skip (parity-preserving); always/if-empty still use batched backfill.
    expect(restorePreviewScript).toContain("DIGEST_BACKFILL_MODE");
    expect(restorePreviewScript).toContain("resumes_search:backfillResumeDigests");
    expect(restorePreviewScript).toContain('"limit":');
    expect(restorePreviewScript).toContain("DIGEST_BACKFILL_BATCH_SIZE");
  });

  it("syncs preview AI env into Convex before importing production data", () => {
    expect(restorePreviewScript).toContain("Sync preview AI env into Convex");
    expect(restorePreviewScript).toContain("deploy/sync-preview-convex-env.sh");
    expect(restorePreviewScript.indexOf("deploy/sync-preview-convex-env.sh")).toBeLessThan(
      restorePreviewScript.indexOf("convex import --replace-all"),
    );
  });

  it("waits for the preview API after restart before final smoke checks", () => {
    expect(restorePreviewScript).toContain("wait_for_preview_api()");
    expect(restorePreviewScript).toContain('PREVIEW_API_URL="${PREVIEW_API_URL:-http://127.0.0.1:3002}"');
    expect(restorePreviewScript).toContain('"$PREVIEW_API_URL/"');
    expect(restorePreviewScript.indexOf("wait_for_preview_api")).toBeLessThan(
      restorePreviewScript.indexOf("=== Verification ==="),
    );
  });

  it("honors production and preview directory overrides", () => {
    expect(restorePreviewScript).toContain('PROD_DIR="${PROD_DIR:-/opt/trends}"');
    expect(restorePreviewScript).toContain('PREVIEW_DIR="${PREVIEW_DIR:-/home/ubuntu/trends-preview}"');
    expect(restorePreviewScript).toContain('PROD_CONVEX_DIR="$PROD_DIR/packages/convex"');
    expect(restorePreviewScript).toContain('cd "$PREVIEW_DIR"');
  });
});

describe("preview full-state restore", () => {
  it("exposes a host-local on-prod target with compatibility aliases and no SSH hop", () => {
    const recipe = getTargetRecipe("on-prod-preview-restore-full-state");

    expect(recipe).toContain("sudo ./deploy/restore-preview-full-state-from-prod.sh");
    expect(recipe).not.toContain("ssh ");
    expect(makefile).toMatch(/^preview-restore-full-state:\s+on-prod-preview-restore-full-state$/m);
    expect(makefile).toMatch(/^restore-preview-full-state:\s+on-prod-preview-restore-full-state$/m);
  });

  it("advertises the host-local preview full-state restore in help output", () => {
    expect(makefile).toContain("on-prod-preview-restore-full-state");
    expect(makefile).toContain("Restore prod Convex + SQLite candidate actions into preview");
  });

  it("runs Convex restore before replacing preview SQLite state", () => {
    expect(restorePreviewFullStateScript).toContain("restore-preview-from-prod.sh");
    expect(restorePreviewFullStateScript).toContain("restore_convex_state");
    expect(restorePreviewFullStateScript).toContain("restore_sqlite_state");
    const modeCaseStart = restorePreviewFullStateScript.indexOf('case "$MODE" in');
    const defaultModeBranch = restorePreviewFullStateScript.slice(
      restorePreviewFullStateScript.indexOf("all)", modeCaseStart),
      restorePreviewFullStateScript.indexOf("sqlite-only)", modeCaseStart),
    );
    expect(defaultModeBranch.indexOf("restore_convex_state")).toBeLessThan(
      defaultModeBranch.indexOf("restore_sqlite_state"),
    );
  });

  it("copies production SQLite through a consistent backup and preserves the old preview DB", () => {
    expect(restorePreviewFullStateScript).toContain(".backup");
    expect(restorePreviewFullStateScript).toContain("pre-full-state-restore-");
    expect(restorePreviewFullStateScript).toContain("$PREVIEW_DB-shm");
    expect(restorePreviewFullStateScript).toContain("$PREVIEW_DB-wal");
    expect(restorePreviewFullStateScript).toContain("candidate_actions");
  });

  it("stops and restarts only the preview API around the SQLite swap", () => {
    expect(restorePreviewFullStateScript).toContain("systemctl stop \"$PREVIEW_API_SERVICE\"");
    expect(restorePreviewFullStateScript).toContain("systemctl start \"$PREVIEW_API_SERVICE\"");
    expect(restorePreviewFullStateScript).toContain("wait_for_preview_api");
    expect(restorePreviewFullStateScript).toContain("/api/blocks");
    expect(restorePreviewFullStateScript).toContain("/api/resumes?source=convex&paged=true&limit=1");
    expect(restorePreviewFullStateScript).not.toContain("ssh ");
  });

  it("treats an auth-protected 401 as readiness, while leaving parity authenticated", () => {
    const fullStateWait = extractShellFunction(restorePreviewFullStateScript, "wait_for_preview_api");
    const fullStateVerify = extractShellFunction(restorePreviewFullStateScript, "verify_preview");
    const convexRestoreWait = extractShellFunction(restorePreviewScript, "wait_for_preview_api");
    const endpointCheck = extractShellFunction(restorePreviewScript, "check_preview_endpoint");

    expect(fullStateWait).toContain("200|401");
    expect(fullStateVerify).toContain('status" = "401"');
    expect(convexRestoreWait).toContain("200|401");
    expect(endpointCheck).toContain('status" = "401"');

    expect(restorePreviewScript).toContain("authenticated parity is still required");
    expect(restorePreviewFullStateScript).toContain("authenticated parity is still required");
  });
});

describe("preview AI env sync", () => {
  it("hydrates missing preview AI env values from production env during setup", () => {
    expect(setupPreviewScript).toContain("Hydrating missing preview AI env vars from production env");
    expect(setupPreviewScript).toContain("deploy/sync-preview-convex-env.sh");
    expect(setupPreviewScript).toContain("--hydrate-only");
  });

  it("syncs the resume scoring AI key fallback into preview Convex", () => {
    expect(syncPreviewConvexEnvScript).toContain("AI_API_KEY");
    expect(syncPreviewConvexEnvScript).toContain("OPENAI_API_KEY");
    expect(syncPreviewConvexEnvScript).toContain("AI_ANALYSIS_RESUMES_ENABLED");
    expect(syncPreviewConvexEnvScript).toContain("AI_OUTPUT_LOCALE");
    expect(syncPreviewConvexEnvScript).toContain("AI_ANALYSIS_PARALLELISM");
    expect(syncPreviewConvexEnvScript).toContain("/etc/trends/env");
    expect(syncPreviewConvexEnvScript).toContain("/opt/trends/.env.production");
    expect(syncPreviewConvexEnvScript).toContain("npx convex env set");
    expect(syncPreviewConvexEnvScript).toContain("shlex.quote");
    expect(syncPreviewConvexEnvScript).toContain("Preview resume AI is enabled but AI_API_KEY/OPENAI_API_KEY is empty");
  });

  it("shell-quotes hydrated values copied from production env", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "trends-preview-env-"));
    const previewEnv = join(tempDir, ".env.preview");
    const prodEnv = join(tempDir, "prod.env");

    try {
      writeFileSync(previewEnv, "AI_API_KEY=\nAI_ANALYSIS_RESUMES_ENABLED=true\n");
      writeFileSync(prodEnv, "AI_API_KEY=abc def#ghi\n");

      execFileSync("bash", ["deploy/sync-preview-convex-env.sh", "--hydrate-only"], {
        cwd: new URL("..", import.meta.url),
        env: {
          ...process.env,
          PREVIEW_DIR: tempDir,
          PREVIEW_ENV: previewEnv,
          PROD_ENV: prodEnv,
        },
      });

      expect(readFileSync(previewEnv, "utf8")).toContain("AI_API_KEY='abc def#ghi'");
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});

describe("production install refuses preview paths", () => {
  it("defines assert_production_install_target and calls it from install/upgrade flows", () => {
    expect(installScript).toContain("assert_production_install_target()");
    expect(installScript).toContain("trends-preview");
    expect(installScript).toContain("deploy/preview-upgrade.sh");
    // Match function bodies with ^ so env_only_upgrade_flow does not steal upgrade_flow
    expect(installScript).toMatch(/^install_flow\(\) \{\n\s+check_root\n\s+assert_production_install_target/m);
    expect(installScript).toMatch(/^upgrade_flow\(\) \{\n\s+check_root\n\s+assert_production_install_target/m);
    expect(installScript).toMatch(/^upgrade_check_flow\(\) \{\n\s+check_root\n\s+assert_production_install_target/m);
    expect(installScript).toMatch(/^uninstall_flow\(\) \{\n\s+check_root\n\s+assert_production_install_target/m);
    expectBefore(extractShellFunction(installScript, "install_flow"), "assert_production_install_target", "clone_or_update_repo");
  });

  it("routes context-aware make deploy to preview-upgrade from preview paths", () => {
    const recipe = getTargetRecipe("deploy");
    expect(recipe).toContain("trends-preview");
    expect(recipe).toContain("preview-upgrade.sh");
    expect(recipe).toContain("on-prod-deploy");
    expect(recipe).toContain("/opt/trends");
  });

  it("refuses on-prod-deploy when cwd is preview", () => {
    const recipe = getTargetRecipe("on-prod-deploy");
    expect(recipe).toContain("trends-preview");
    expect(recipe).toContain("refused");
  });
});

describe("preview release helpers", () => {
  const backupScript = readFileSync(new URL("../deploy/backup-prod-complete.sh", import.meta.url), "utf8");
  const preflightScript = readFileSync(new URL("../deploy/preview-preflight.sh", import.meta.url), "utf8");
  const cloneScript = readFileSync(new URL("../deploy/preview-clone-from-prod.sh", import.meta.url), "utf8");
  const upgradeScript = readFileSync(new URL("../deploy/preview-upgrade.sh", import.meta.url), "utf8");
  const isolateScript = readFileSync(new URL("../deploy/preview-isolate-integrations.sh", import.meta.url), "utf8");
  const commonLib = readFileSync(new URL("../deploy/lib-preview-common.sh", import.meta.url), "utf8");

  it("ships complete backup with verify and no prod import", () => {
    expect(backupScript).toContain("set -Eeuo pipefail");
    expect(backupScript).toContain("prod-complete-");
    expect(backupScript).toContain(".backup");
    expect(backupScript).toContain("npx convex export");
    expect(backupScript).toContain("integrity_check");
    expect(backupScript).toContain('status "OK"');
    expect(backupScript).not.toContain("convex import");
    expect(backupScript).not.toContain("restore-prod-from-preview");
  });

  it("preflight checks preview isolation and separate sqlite paths", () => {
    expect(preflightScript).toContain("assert_preview_env_file");
    expect(preflightScript).toContain("PREVIEW_CONVEX_URL");
    expect(preflightScript).toContain("preview SQLite is separate");
    expect(commonLib).toContain("4210");
  });

  it("clone-from-prod preserves preview env and never targets /opt/trends as destination", () => {
    expect(cloneScript).toContain("assert_not_prod_install_dir");
    expect(cloneScript).toContain("SOURCE=production");
    expect(cloneScript).toContain("preview-isolate-integrations.sh");
    expect(cloneScript).toContain("rsync");
    expect(cloneScript).toContain('systemctl restart "$PREVIEW_API_SERVICE"');
    expect(cloneScript).not.toContain("systemctl restart trends-api");
  });

  it("preview-upgrade refuses production cwd and restarts only preview units", () => {
    expect(upgradeScript).toContain("set -Eeuo pipefail");
    expect(upgradeScript).toContain("is_prod_path");
    expect(upgradeScript).toContain("REPO_MIRROR");
    expect(upgradeScript).toContain("SOURCE_REF");
    expect(upgradeScript).toContain("systemctl restart \"$PREVIEW_API_SERVICE\"");
    expect(upgradeScript).not.toContain("systemctl restart trends-api");
    expect(upgradeScript).toContain("Production was not modified");
  });

  it("preview-upgrade rebuilds digests when compute epoch changed since restore", () => {
    expect(upgradeScript).toContain("Digest rebuild after code upgrade");
    expect(upgradeScript).toContain("backfillResumeDigests");
    expect(upgradeScript).toContain("CURRENT_INGEST_COMPUTE_EPOCH");
    expect(upgradeScript).toContain(".digest-restore-epoch");
    expect(upgradeScript).toContain("SKIP_DIGEST_REBUILD");
    expect(upgradeScript).toContain("DIGEST_REBUILD_BATCH_SIZE");
  });

  it("preview-upgrade does not wipe the digest-restore-epoch marker during tree sync", () => {
    // The marker is local-only (written by restore-preview-from-prod.sh). The
    // mirror-to-preview rsync uses --delete, so without an explicit exclude the
    // marker is removed on every upgrade and the digest-rebuild-on-epoch-change
    // drift check below can never trigger. Regression: marker vanished in the
    // ebe46ae7 upgrade (log showed "restore-epoch=none").
    const deleteSyncStart = upgradeScript.indexOf("rsync -a --delete");
    expect(deleteSyncStart).toBeGreaterThan(-1);
    const deleteSyncEnd = upgradeScript.indexOf('"$REPO_MIRROR/" "$PREVIEW_DIR/"', deleteSyncStart);
    expect(deleteSyncEnd).toBeGreaterThan(deleteSyncStart);
    const deleteSyncBlock = upgradeScript.slice(deleteSyncStart, deleteSyncEnd);
    expect(deleteSyncBlock).toContain("--exclude '.digest-restore-epoch'");
    // The epoch check must read the marker the sync preserved.
    expect(upgradeScript).toMatch(/RESTORE_EPOCH_MARKER=.*\.digest-restore-epoch/);
  });

  it("search-freshness-gate uses capacity-safe reingest defaults", () => {
    const gateScript = readFileSync(new URL("../deploy/search-freshness-gate.sh", import.meta.url), "utf8");
    expect(gateScript).toContain("REINGEST_BATCH");
    expect(gateScript).toContain("REINGEST_SLEEP_SECS");
    // Capacity-safe defaults: batch ≤25, sleep ≥8
    expect(gateScript).toMatch(/REINGEST_BATCH.*\b25\b/);
    expect(gateScript).toMatch(/REINGEST_SLEEP_SECS.*\b8\b/);
    // CLI flags for overrides
    expect(gateScript).toContain("--reingest-batch");
    expect(gateScript).toContain("--reingest-sleep");
    // Cursor-paced loop with sleep between calls
    expect(gateScript).toContain("time.sleep");
    expect(gateScript).toContain("cursor");
  });

  it("restore-preview-from-prod supports if-epoch-changed digest mode", () => {
    expect(restorePreviewScript).toContain("if-epoch-changed");
    expect(restorePreviewScript).toContain(".digest-restore-epoch");
    expect(restorePreviewScript).toContain("DIGEST_BACKFILL_MODE:-skip");
  });

  it("isolate script clears telegram and forces preview URLs", () => {
    expect(isolateScript).toContain("TELEGRAM_BOT_TOKEN");
    expect(isolateScript).toContain("AUTH_ALLOWED_ORIGINS");
    expect(isolateScript).toContain("4210");
    expect(isolateScript).toContain("--apply");
  });

  it("shared lib defines canonical prod/preview paths", () => {
    expect(commonLib).toContain('/opt/trends');
    expect(commonLib).toContain("/home/ubuntu/trends-preview");
    expect(commonLib).toContain("print_context_report");
  });

  it("preserves digests by default and soft-fails admin login on restore", () => {
    expect(restorePreviewScript).toContain("DIGEST_BACKFILL_MODE");
    expect(restorePreviewScript).toContain('DIGEST_BACKFILL_MODE:-skip');
    expect(restorePreviewScript).toContain("Skipping digest backfill");
    expect(restorePreviewScript).toContain("RESTORE_STRICT");
    expect(restorePreviewScript).toContain("Data parity is independent of admin login");
    expect(restorePreviewScript).toContain("RUN_PREVIEW_AI_SMOKE");
  });

  it("ships orchestrator + parity check for prod→preview fidelity", () => {
    const syncScript = readFileSync(new URL("../deploy/preview-sync-from-prod.sh", import.meta.url), "utf8");
    const parityScript = readFileSync(new URL("../deploy/preview-parity-check.sh", import.meta.url), "utf8");
    expect(syncScript).toContain("preview-sync-from-prod");
    expect(syncScript).toContain("backup-prod-complete.sh");
    expect(syncScript).toContain("restore-preview-full-state-from-prod.sh");
    expect(syncScript).toContain("preview-parity-check.sh");
    expect(syncScript).toContain("DIGEST_BACKFILL_MODE");
    expect(parityScript).toContain("candidate_actions");
    expect(parityScript).toContain("summary");
    expect(parityScript).toContain("PARITY OK");
    expect(parityScript).toContain("Production AUTH_HR_DEMO_PASSWORD unset");
    expect(parityScript).toContain("preview_auth_login_at");
    expect(parityScript).toContain('fetch_summary_prod "$PROD_JAR"');
    expect(parityScript).toContain('preview_auth_curl "$PROD_JAR" "$PROD_HR_WS"');
    expect(parityScript).toContain("PARITY_STRICT_SEARCH");
    expect(parityScript).toContain("API version drift");
  });
});

describe("preview MCP image", () => {
  it("copies shared Python packages required by trendradar imports", () => {
    expect(previewMcpDockerfile).toContain("COPY trendradar/ ./trendradar/");
    expect(previewMcpDockerfile).toContain("COPY packages/ ./packages/");
  });
});

describe("preview Convex container", () => {
  it("installs and exposes system CA certificates for Convex action HTTPS calls", () => {
    expect(previewConvexStartScript).toContain("ca-certificates");
    expect(previewConvexStartScript).toContain("SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt");
    expect(previewCompose).toContain("SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt");
  });

  it("sizes preview Convex mem_limit above the observed OOM ceiling for prod-restored data", () => {
    // Observed (2026-08-05, preview ptcloud): convex-local-backend OOM-killed at
    // ~8.1 GiB anon-rss against mem_limit 8g while reingesting a prod-restored
    // 1.5 GiB SQLite (8,958 resumes) — three kills in one hour. Host has ~24 GiB.
    // The limit must leave margin above the kill ceiling, or every reingest
    // burst crash-loops the backend (jobs resume after each restart and re-kill).
    const match = previewCompose.match(/mem_limit:\s*(\d+)g/);
    expect(match).not.toBeNull();
    const memLimitGiB = Number(match![1]!);
    expect(memLimitGiB).toBeGreaterThanOrEqual(12);
  });
});
