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
    expect(makefile).toMatch(/^deploy:\s+on-prod-deploy$/m);
    expect(makefile).toMatch(/^prod-deploy-check:\s+on-prod-deploy-check$/m);
    expect(makefile).toMatch(/^deploy-check:\s+on-prod-deploy-check$/m);
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
    body = extractShellFunction(installScript, "seed_and_migrate_convex");
    migrations = extractMigrationCalls(body);
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
    expect(body).toContain('backfillManual51jobStructuredContent');
    expect(body).toContain('{"batchSize":100}');
  });

  it("passes limit to backfillIngestData", () => {
    expect(body).toContain("backfillIngestData");
    expect(body).toContain('{"limit":100}');
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

    expect(restorePreviewScript).toContain("/api/resumes?source=convex&paged=true&limit=1");
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

  it("rebuilds resume digests in bounded batches after the replace-all preview import", () => {
    expect(restorePreviewScript).toContain("Rebuild resume digests");
    expect(restorePreviewScript).toContain("resumes_search:backfillResumeDigests");
    expect(restorePreviewScript).toContain('"limit": 200');
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
});
