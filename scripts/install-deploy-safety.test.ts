import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const makefile = readFileSync(new URL("../Makefile", import.meta.url), "utf8");
const installScript = readFileSync(new URL("./install.sh", import.meta.url), "utf8");
const setupPreviewScript = readFileSync(new URL("../deploy/setup-preview.sh", import.meta.url), "utf8");
const restorePreviewScript = readFileSync(new URL("../deploy/restore-preview-from-prod.sh", import.meta.url), "utf8");
const syncPreviewConvexEnvScript = readFileSync(new URL("../deploy/sync-preview-convex-env.sh", import.meta.url), "utf8");
const previewMcpDockerfile = readFileSync(new URL("../deploy/docker/Dockerfile.mcp", import.meta.url), "utf8");
const previewCompose = readFileSync(new URL("../deploy/docker/docker-compose.preview.yml", import.meta.url), "utf8");
const previewConvexStartScript = readFileSync(new URL("../deploy/docker/start-convex.sh", import.meta.url), "utf8");
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
