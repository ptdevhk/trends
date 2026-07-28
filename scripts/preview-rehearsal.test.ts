import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertEvidenceRedacted,
  EVIDENCE_SCHEMA,
  parseArgs,
  writeEvidenceAtomic,
  type BrowserEvidence,
} from "./preview-rehearsal-browser-smoke";

const repoRoot = resolve(import.meta.dirname, "..");
const created: string[] = [];

function temporaryDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  created.push(path);
  return path;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

interface Fixture {
  root: string;
  backup: string;
  manifest: string;
  evidence: string;
}

function createBackupFixture(): Fixture {
  const root = temporaryDirectory("trends-rehearsal-fixture-");
  const backup = join(root, "prod-complete-20260722T191315Z");
  const evidence = join(root, "evidence");
  mkdirSync(join(backup, "git"), { recursive: true });
  mkdirSync(join(backup, "sqlite"), { recursive: true });
  mkdirSync(join(backup, "convex"), { recursive: true });
  mkdirSync(join(backup, "output"), { recursive: true });
  const sqlite = join(backup, "sqlite", "resume_screening.db");
  execFileSync("sqlite3", [
    sqlite,
    "CREATE TABLE candidate_actions(id INTEGER PRIMARY KEY); INSERT INTO candidate_actions VALUES (1),(2);",
  ]);
  const convex = join(backup, "convex", "convex-export.zip");
  const output = join(backup, "output", "output-persistent.tgz");
  execFileSync("python3", [
    "-c",
    [
      "import io, tarfile, zipfile, pathlib",
      `z=zipfile.ZipFile(${JSON.stringify(convex)},'w')`,
      "z.writestr('resumes/documents.jsonl','{\"id\":1}\\n{\"id\":2}\\n')",
      "z.writestr('_storage/files/blob-1',b'payload')",
      "z.close()",
      `t=tarfile.open(${JSON.stringify(output)},'w:gz')`,
      "for name,data in [('output/resumes/location-info/job5156-location-info.json',b'{}\\n'),('output/worker-status.json',b'{}\\n')]:",
      " i=tarfile.TarInfo(name); i.size=len(data); t.addfile(i,io.BytesIO(data))",
      "t.close()",
    ].join("\n"),
  ]);
  const sourceSha = "ec0695935f08554b582d788e6db543bb6edd3f61";
  writeFileSync(join(backup, "git", "HEAD"), `${sourceSha}\n`);
  const manifest = join(backup, "MANIFEST.txt");
  writeFileSync(
    manifest,
    [
      "created_at=20260722T191315Z",
      "status=OK",
      `prod_sha=${sourceSha}`,
      "prod_branch=hotfix/v0.4.6-hr-candidate-status-api",
      "prod_version=0.4.6",
      "sqlite_path=sqlite/resume_screening.db",
      `sqlite_sha256=${sha256(sqlite)}`,
      "candidate_actions_count=2",
      "convex_zip=convex/convex-export.zip",
      `convex_zip_sha256=${sha256(convex)}`,
      "include_file_storage=true",
      "output_tgz=output/output-persistent.tgz",
      `output_tgz_sha256=${sha256(output)}`,
      "",
    ].join("\n"),
  );
  return { root, backup, manifest, evidence };
}

function validateFixture(fixture: Fixture): ReturnType<typeof spawnSync> {
  return spawnSync(
    "bash",
    [
      "-c",
      [
        "set -Eeuo pipefail",
        "source deploy/lib-complete-backup.sh",
        "complete_backup_validate \"$BACKUP\" \"$EVIDENCE\" deploy/preview-output-restore.allowlist",
      ].join("\n"),
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        BACKUP_ROOT: fixture.root,
        BACKUP: fixture.backup,
        EVIDENCE: fixture.evidence,
      },
    },
  );
}

function createGitMirror(root: string): { mirror: string; sourceSha: string; targetSha: string } {
  const origin = join(root, "origin.git");
  const mirror = join(root, "mirror");
  execFileSync("git", ["init", "--bare", origin], { stdio: "ignore" });
  execFileSync("git", ["clone", origin, mirror], { stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "tests@example.invalid"], { cwd: mirror });
  execFileSync("git", ["config", "user.name", "Rehearsal Tests"], { cwd: mirror });
  writeFileSync(join(mirror, "version"), "0.4.6\n");
  execFileSync("git", ["add", "version"], { cwd: mirror });
  execFileSync("git", ["commit", "-m", "source"], { cwd: mirror, stdio: "ignore" });
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: mirror, encoding: "utf8" }).trim();
  execFileSync("git", ["push", "-u", "origin", "HEAD:main"], { cwd: mirror, stdio: "ignore" });
  writeFileSync(join(mirror, "version"), "0.4.22\n");
  execFileSync("git", ["commit", "-am", "target"], { cwd: mirror, stdio: "ignore" });
  execFileSync("git", ["tag", "v0.4.22"], { cwd: mirror });
  execFileSync("git", ["push", "origin", "HEAD:main", "v0.4.22"], { cwd: mirror, stdio: "ignore" });
  const targetSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: mirror, encoding: "utf8" }).trim();
  return { mirror, sourceSha, targetSha };
}

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { force: true, recursive: true });
});

describe("complete backup parser and archive safety", () => {
  it("validates a complete fixture and inventories allowed/skipped output", () => {
    const fixture = createBackupFixture();
    const result = validateFixture(fixture);
    expect(result.status, result.stderr).toBe(0);
    const source = JSON.parse(readFileSync(join(fixture.evidence, "source-inventory.json"), "utf8"));
    const output = JSON.parse(readFileSync(join(fixture.evidence, "output-inventory.json"), "utf8"));
    expect(source.tables.resumes).toBe(2);
    expect(source.storage).toHaveLength(1);
    expect(output.allowed.map((item: { path: string }) => item.path)).toEqual([
      "output/resumes/location-info/job5156-location-info.json",
    ]);
    expect(output.skipped.map((item: { path: string }) => item.path)).toContain(
      "output/worker-status.json",
    );
  });

  it("rejects duplicate security keys", () => {
    const fixture = createBackupFixture();
    writeFileSync(fixture.manifest, `${readFileSync(fixture.manifest, "utf8")}prod_sha=${"a".repeat(40)}\n`);
    const result = validateFixture(fixture);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("duplicate security-sensitive");
  });

  it("rejects checksum drift", () => {
    const fixture = createBackupFixture();
    writeFileSync(join(fixture.backup, "sqlite", "resume_screening.db"), "corrupt");
    const result = validateFixture(fixture);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("checksum mismatch");
  });

  it("rejects unsafe manifest branch syntax", () => {
    const fixture = createBackupFixture();
    writeFileSync(
      fixture.manifest,
      readFileSync(fixture.manifest, "utf8").replace(
        "prod_branch=hotfix/v0.4.6-hr-candidate-status-api",
        "prod_branch=main..malicious",
      ),
    );
    const result = validateFixture(fixture);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unsafe prod_branch");
  });

  it("rejects unsafe TAR member types", () => {
    const fixture = createBackupFixture();
    const output = join(fixture.backup, "output", "output-persistent.tgz");
    execFileSync("python3", [
      "-c",
      [
        "import tarfile",
        `p=${JSON.stringify(output)}`,
        "t=tarfile.open(p,'w:gz')",
        "i=tarfile.TarInfo('output/link'); i.type=tarfile.SYMTYPE; i.linkname='/etc/passwd'; t.addfile(i)",
        "t.close()",
      ].join("\n"),
    ]);
    const manifest = readFileSync(fixture.manifest, "utf8").replace(
      /output_tgz_sha256=[0-9a-f]{64}/u,
      `output_tgz_sha256=${sha256(output)}`,
    );
    writeFileSync(fixture.manifest, manifest);
    const result = validateFixture(fixture);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unsafe TAR member type");
  });
});

describe("canonical Convex migration library", () => {
  it("declares one exact ordered stream with validation last", () => {
    const output = execFileSync(
      "bash",
      ["-c", "source deploy/lib-convex-migrations.sh; convex_migration_declarations"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    const rows = output.trim().split("\n").map((row) => row.split("\t"));
    expect(rows.map(([name]) => name)).toEqual([
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
    ]);
    expect(rows.find(([name]) => name === "backfillManual51jobStructuredContent")?.[1]).toBe(
      '{"batchSize":100}',
    );
    expect(rows.find(([name]) => name === "backfillIngestData")?.[1]).toBe('{"limit":100}');
  });

  it("stops after three consecutive cursor batches with zero changes", () => {
    const root = temporaryDirectory("trends-migration-loop-");
    const counter = join(root, "counter");
    writeFileSync(counter, "0");
    const result = spawnSync(
      "bash",
      [
        "-c",
        [
          "set -Eeuo pipefail",
          "source deploy/lib-convex-migrations.sh",
          "convex_migration_execute() {",
          "  n=$(cat \"$COUNTER\"); n=$((n+1)); printf '%s' \"$n\" > \"$COUNTER\"",
          "  printf '{\"hasMore\":true,\"cursor\":\"c%s\",\"updated\":0,\"scannedResumes\":1}\\n' \"$n\"",
          "}",
          "run_convex_migration_loop /tmp/convex sample '{}' 10000 3",
        ].join("\n"),
      ],
      { cwd: repoRoot, encoding: "utf8", env: { ...process.env, COUNTER: counter } },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(counter, "utf8")).toBe("3");
    expect(result.stdout).toContain("3 consecutive batches");
  });
});

describe("orchestrator safety contracts", () => {
  const orchestrator = readFileSync(join(repoRoot, "deploy", "preview-rehearse-backup.sh"), "utf8");
  const worker = readFileSync(join(repoRoot, "deploy", "restore-preview-from-backup.sh"), "utf8");

  it("requires explicit backup and target and stops at the baseline approval gate", () => {
    expect(orchestrator).toContain("--backup-dir");
    expect(orchestrator).toContain("--target-ref");
    expect(orchestrator).toContain("awaiting-approval");
    expect(orchestrator.indexOf("run_exact_phase verify-baseline")).toBeLessThan(
      orchestrator.indexOf("review $RUN_DIR/evidence"),
    );
  });

  it("freezes every fixed controller helper and rejects application checkouts as the mirror", () => {
    for (const helper of [
      "lib-preview-common.sh",
      "lib-preview-auth-session.sh",
      "lib-bff-defaults.sh",
      "preview-isolate-integrations.sh",
      "preview-seed-auth.sh",
      "search-freshness-gate.sh",
      "sync-preview-convex-env.sh",
    ]) {
      expect(orchestrator).toContain(`"$SCRIPT_DIR/${helper}"`);
    }
    expect(orchestrator).toContain("REPO_MIRROR must not be the production checkout");
    expect(orchestrator).toContain("REPO_MIRROR must not be the preview checkout");
  });

  it("never exports current production during historical restore", () => {
    expect(worker).not.toMatch(/PROD_DIR[\s\S]{0,200}convex export/u);
    expect(worker).toContain("convex import --replace-all --yes");
    expect(worker).toContain("git -C \"$REPO_MIRROR\" archive");
    expect(worker).not.toContain("git -C \"$REPO_MIRROR\" reset --hard");
    expect(worker).not.toContain("git -C \"$REPO_MIRROR\" checkout");
  });

  it("keeps rollback explicit and never invokes it from the error trap", () => {
    expect(orchestrator).toContain("--phase rollback");
    const errorHandler = orchestrator.slice(
      orchestrator.indexOf("on_error()"),
      orchestrator.indexOf("initialize_new_run()"),
    );
    expect(errorHandler).not.toContain("rollback_preview");
    expect(errorHandler).not.toContain("phase_worker rollback");
  });

  it("keeps rollback isolated, rebuilds the restored version, and resets allowlisted output", () => {
    const rollback = worker.slice(worker.indexOf("rollback_preview()"), worker.indexOf("main()"));
    expect(rollback).toContain("apply_preview_isolation");
    expect(rollback).toContain("install_dependencies_and_build");
    expect(rollback).toContain('rm -f "$PREVIEW_DIR/$relative"');
  });

  it("excludes environment-local system settings from both snapshot inventories", () => {
    const backupLibrary = readFileSync(join(repoRoot, "deploy", "lib-complete-backup.sh"), "utf8");
    const verifier = readFileSync(join(repoRoot, "deploy", "preview-verify-snapshot.sh"), "utf8");
    expect(backupLibrary).toContain('if table == "system_settings"');
    expect(verifier).toContain('if parts[-2] == "system_settings"');
  });

  it("runs a local preflight-only phase, freezes identities, and refuses controller drift", () => {
    const fixture = createBackupFixture();
    const git = createGitMirror(fixture.root);
    writeFileSync(join(fixture.backup, "git", "HEAD"), `${git.sourceSha}\n`);
    writeFileSync(
      fixture.manifest,
      readFileSync(fixture.manifest, "utf8")
        .replace(/prod_sha=[0-9a-f]{40}/u, `prod_sha=${git.sourceSha}`)
        .replace("prod_branch=hotfix/v0.4.6-hr-candidate-status-api", "prod_branch=main"),
    );
    const fakeBin = join(fixture.root, "fake-bin");
    const runs = join(fixture.root, "runs");
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, "flock"), "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(join(fakeBin, "flock"), 0o755);
    const env = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      BACKUP_ROOT: fixture.root,
      PREVIEW_REHEARSAL_ROOT: runs,
      PREVIEW_REHEARSAL_LOCK_FILE: join(fixture.root, "rehearsal.lock"),
      REPO_MIRROR: git.mirror,
    };
    const first = spawnSync(
      "bash",
      [
        "deploy/preview-rehearse-backup.sh",
        "--backup-dir",
        fixture.backup,
        "--target-ref",
        "v0.4.22",
        "--phase",
        "preflight",
      ],
      { cwd: repoRoot, encoding: "utf8", env },
    );
    expect(first.status, first.stderr).toBe(0);
    const runId = readFileSync(
      join(runs, execFileSync("bash", ["-c", `basename "${runs}"/*`], { encoding: "utf8" }).trim(), "state.env"),
      "utf8",
    ).match(/^run_id=(.+)$/mu)?.[1];
    expect(runId).toMatch(/^[0-9]{8}T[0-9]{6}Z-[a-z0-9]{8}$/u);
    const statePath = join(runs, runId!, "state.env");
    const state = readFileSync(statePath, "utf8");
    expect(state).toContain("preflight_status=passed");
    expect(state).toContain(`source_sha=${git.sourceSha}`);
    expect(state).toContain(`target_sha=${git.targetSha}`);
    writeFileSync(statePath, state.replace(/^controller_hash=.*$/mu, `controller_hash=${"0".repeat(64)}`));
    const drift = spawnSync(
      "bash",
      ["deploy/preview-rehearse-backup.sh", "--run-id", runId!],
      { cwd: repoRoot, encoding: "utf8", env },
    );
    expect(drift.status).not.toBe(0);
    expect(drift.stderr).toContain("controller drift");
  });
});

describe("browser evidence helpers", () => {
  it("parses exact preview identity arguments", () => {
    expect(
      parseArgs([
        "--base-url",
        "https://preview.pt-mes.com/",
        "--run-id",
        "20260728T120000Z-abc123",
        "--target-sha",
        "d771f5a913dd3905c7e50759cd11c64d04340224",
        "--output",
        "/tmp/evidence.json",
      ]),
    ).toEqual({
      baseUrl: "https://preview.pt-mes.com",
      runId: "20260728T120000Z-abc123",
      targetSha: "d771f5a913dd3905c7e50759cd11c64d04340224",
      output: "/tmp/evidence.json",
    });
  });

  it("rejects unknown and duplicate browser arguments", () => {
    expect(() => parseArgs(["--unknown", "value"])).toThrow(/Unknown argument/u);
    expect(() =>
      parseArgs([
        "--base-url",
        "https://preview.pt-mes.com",
        "--base-url",
        "https://preview.example.com",
      ]),
    ).toThrow(/Duplicate argument/u);
  });

  it("writes a redacted evidence document atomically", () => {
    const root = temporaryDirectory("trends-browser-evidence-");
    const output = join(root, "evidence.json");
    const evidence: BrowserEvidence = {
      schema: EVIDENCE_SCHEMA,
      runId: "20260728T120000Z-abc123",
      targetSha: "d771f5a913dd3905c7e50759cd11c64d04340224",
      baseUrl: "https://preview.pt-mes.com",
      startedAt: "2026-07-28T12:00:00.000Z",
      completedAt: "2026-07-28T12:01:00.000Z",
      result: "passed",
      identities: [
        {
          username: "admin",
          workspace: "dev",
          route: "/dev/resumes",
          finalUrl: "https://preview.pt-mes.com/dev/resumes",
          passed: true,
        },
      ],
    };
    writeEvidenceAtomic(output, evidence);
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(evidence);
  });

  it("rejects accidental secret-shaped evidence fields", () => {
    const evidence = {
      schema: EVIDENCE_SCHEMA,
      runId: "20260728T120000Z-abc123",
      targetSha: "d771f5a913dd3905c7e50759cd11c64d04340224",
      baseUrl: "https://preview.pt-mes.com",
      startedAt: "2026-07-28T12:00:00.000Z",
      completedAt: "2026-07-28T12:01:00.000Z",
      result: "passed",
      identities: [],
      password: "should-never-be-written",
    } as unknown as BrowserEvidence;
    expect(() => assertEvidenceRedacted(evidence)).toThrow(/forbidden/u);
  });
});
