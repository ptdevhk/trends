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

// Read-only completeness audit tests. The audit script
// (deploy/audit-complete-backup.sh) must NEVER restore, import, stop services,
// or accept a Convex-only artifact as complete. These tests drive it only
// against temp fixtures and assert the deterministic secret-safe JSON report.

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

// Build a complete prod-complete-* bundle fixture. `storage` controls whether
// the Convex ZIP carries a file-storage inventory; include_file_storage is
// always true so a storage-less ZIP exercises the "missing storage" path.
function createBackupFixture(opts: { storage?: boolean } = {}): Fixture {
  const { storage = true } = opts;
  const root = temporaryDirectory("trends-audit-fixture-");
  const backup = join(root, "prod-complete-20260722T191315Z");
  const evidence = join(root, "evidence");
  mkdirSync(join(backup, "git"), { recursive: true });
  mkdirSync(join(backup, "sqlite"), { recursive: true });
  mkdirSync(join(backup, "convex"), { recursive: true });
  mkdirSync(join(backup, "output"), { recursive: true });
  mkdirSync(join(backup, "config"), { recursive: true });

  // Required env copy. The producer treats the other environment files as optional.
  const configEnv = join(backup, "config", "etc-trends-env");
  writeFileSync(configEnv, "A=1\n", { mode: 0o600 });
  chmodSync(configEnv, 0o600);

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
      "import io, tarfile, zipfile",
      `z=zipfile.ZipFile(${JSON.stringify(convex)},'w')`,
      "z.writestr('resumes/documents.jsonl','{\"id\":1}\\n{\"id\":2}\\n')",
      ...(storage ? ["z.writestr('_storage/files/blob-1',b'payload')"] : []),
      "z.close()",
      `t=tarfile.open(${JSON.stringify(output)},'w:gz')`,
      "for name,data in [('output/resumes/location-info/job5156-location-info.json',b'{}\\n')]:",
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
      "config_env=config/etc-trends-env",
      `config_env_sha256=${sha256(configEnv)}`,
      "output_tgz=output/output-persistent.tgz",
      `output_tgz_sha256=${sha256(output)}`,
      "",
    ].join("\n"),
  );
  return { root, backup, manifest, evidence };
}

function replaceManifestLine(fixture: Fixture, key: string, value: string): void {
  const source = readFileSync(fixture.manifest, "utf8");
  const pattern = new RegExp(`^${key}=.*$`, "m");
  writeFileSync(fixture.manifest, source.replace(pattern, `${key}=${value}`));
}

function rewriteArchives(
  fixture: Fixture,
  options: {
    convexMembers?: Array<[string, string]>;
    outputMembers?: Array<[string, string]>;
  },
): void {
  const convex = join(fixture.backup, "convex", "convex-export.zip");
  const output = join(fixture.backup, "output", "output-persistent.tgz");
  execFileSync("python3", [
    "-c",
    [
      "import io, json, sys, tarfile, zipfile",
      "convex, output, convex_members, output_members = sys.argv[1:]",
      "with zipfile.ZipFile(convex, 'w') as z:",
      " for name, data in json.loads(convex_members): z.writestr(name, data)",
      "with tarfile.open(output, 'w:gz') as t:",
      " for name, data in json.loads(output_members):",
      "  raw=data.encode(); info=tarfile.TarInfo(name); info.size=len(raw); t.addfile(info, io.BytesIO(raw))",
    ].join("\n"),
    convex,
    output,
    JSON.stringify(options.convexMembers ?? []),
    JSON.stringify(options.outputMembers ?? []),
  ]);
  replaceManifestLine(fixture, "convex_zip_sha256", sha256(convex));
  replaceManifestLine(fixture, "output_tgz_sha256", sha256(output));
}
function runAudit(
  fixture: Fixture,
  options: { env?: NodeJS.ProcessEnv; allowlist?: string } = {},
): ReturnType<typeof spawnSync> {
  return spawnSync(
    "bash",
    [
      "deploy/audit-complete-backup.sh",
      "--backup-dir",
      fixture.backup,
      "--evidence-dir",
      fixture.evidence,
      ...(options.allowlist ? ["--allowlist", options.allowlist] : []),
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        BACKUP_ROOT: fixture.root,
        ...options.env,
      },
    },
  );
}

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { force: true, recursive: true });
});

describe("complete backup audit", () => {
  it("reports a complete bundle as rollback-ready", () => {
    const fixture = createBackupFixture();
    const result = runAudit(fixture);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.schema).toBe("trends-complete-backup-audit/v1");
    expect(report.complete).toBe(true);
    expect(report.no_go_reasons).toEqual([]);
    expect(report.status).toBe("OK");
    expect(report.checks.manifest.state).toBe("ok");
    expect(report.checks.allowlist.state).toBe("ok");
    expect(report.checks.env_copies.state).toBe("ok");
    expect(report.checks.git_identity.state).toBe("ok");
    expect(report.checks.sqlite_path.state).toBe("ok");
    expect(report.checks.convex_zip.state).toBe("ok");
    expect(report.checks.hashes.state).toBe("ok");
    expect(report.checks.sqlite_integrity.state).toBe("ok");
    expect(report.checks.candidate_actions.state).toBe("ok");
    expect(report.checks.zip_integrity.state).toBe("ok");
    expect(report.checks.file_storage.state).toBe("ok");
    expect(report.checks.safe_paths.state).toBe("ok");
  });

  it("flags missing file storage as not complete", () => {
    const fixture = createBackupFixture({ storage: false });
    const result = runAudit(fixture);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.complete).toBe(false);
    expect(report.checks.file_storage.state).toBe("fail");
    expect(report.no_go_reasons.join(" ")).toMatch(/file storage/i);
  });

  it("rejects a Convex-only artifact as not complete", () => {
    const fixture = createBackupFixture();
    // Keep only the Convex ZIP; strip manifest, sqlite, env, git, output.
    rmSync(join(fixture.backup, "MANIFEST.txt"));
    rmSync(join(fixture.backup, "sqlite"), { recursive: true });
    rmSync(join(fixture.backup, "config"), { recursive: true });
    rmSync(join(fixture.backup, "git"), { recursive: true });
    rmSync(join(fixture.backup, "output"), { recursive: true });
    const result = runAudit(fixture);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.complete).toBe(false);
    expect(report.checks.manifest.state).toBe("fail");
    expect(report.no_go_reasons.length).toBeGreaterThan(0);
  });

  it("flags a SHA mismatch as not complete", () => {
    const fixture = createBackupFixture();
    writeFileSync(join(fixture.backup, "sqlite", "resume_screening.db"), "corrupt");
    const result = runAudit(fixture);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.complete).toBe(false);
    expect(report.checks.hashes.state).toBe("fail");
    expect(report.no_go_reasons.join(" ")).toMatch(/checksum/i);
  });

  it("flags an unsafe artifact path as not complete", () => {
    const fixture = createBackupFixture();
    writeFileSync(
      fixture.manifest,
      readFileSync(fixture.manifest, "utf8").replace(
        "sqlite_path=sqlite/resume_screening.db",
        "sqlite_path=../../etc/passwd",
      ),
    );
    const result = runAudit(fixture);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.complete).toBe(false);
    expect(report.checks.sqlite_path.state).toBe("fail");
    expect(report.no_go_reasons.join(" ")).toMatch(/unsafe|escape/i);
  });

  it("flags a corrupt manifest as not complete", () => {
    const fixture = createBackupFixture();
    writeFileSync(fixture.manifest, "not-a-manifest-line\n");
    const result = runAudit(fixture);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.complete).toBe(false);
    expect(report.checks.manifest.state).toBe("fail");
  });

  it("flags a missing required env copy as not complete", () => {
    const fixture = createBackupFixture();
    rmSync(join(fixture.backup, "config", "etc-trends-env"));
    const result = runAudit(fixture);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.complete).toBe(false);
    expect(report.checks.env_copies.state).toBe("fail");
    expect(report.no_go_reasons.join(" ")).toMatch(/env/i);
  });

  it("accepts producer-optional environment files being absent", () => {
    const fixture = createBackupFixture();
    const result = runAudit(fixture);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).checks.env_copies.state).toBe("ok");
  });

  it("requires include_file_storage=true even when storage members exist", () => {
    const fixture = createBackupFixture();
    replaceManifestLine(fixture, "include_file_storage", "false");
    const result = runAudit(fixture);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.checks.file_storage.state).toBe("fail");
    expect(report.no_go_reasons.join(" ")).toMatch(/include_file_storage/i);
  });

  it("does not treat a table name containing storage as file storage", () => {
    const fixture = createBackupFixture();
    rewriteArchives(fixture, {
      convexMembers: [
        ["resumes/documents.jsonl", '{"id":1}\n'],
        ["storage_events/documents.jsonl", '{"id":2}\n'],
      ],
      outputMembers: [["output/resumes/location-info/job5156-location-info.json", "{}\n"]],
    });
    const result = runAudit(fixture);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.checks.file_storage.state).toBe("fail");
  });

  it.each([
    ["missing", ""],
    ["wrong", "0".repeat(64)],
  ])("flags a %s config_env_sha256", (_case, value) => {
    const fixture = createBackupFixture();
    replaceManifestLine(fixture, "config_env_sha256", value);
    const result = runAudit(fixture);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.checks.env_copies.state).toBe("fail");
    expect(report.checks.config_hash.state).toBe("fail");
  });

  it("requires config/etc-trends-env mode 0600", () => {
    const fixture = createBackupFixture();
    chmodSync(join(fixture.backup, "config", "etc-trends-env"), 0o644);
    const result = runAudit(fixture);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.checks.env_copies.state).toBe("fail");
    expect(report.no_go_reasons.join(" ")).toMatch(/0600/);
  });

  it("requires every exact allowlisted TAR member", () => {
    const fixture = createBackupFixture();
    const allowlist = join(fixture.root, "restore.allowlist");
    writeFileSync(
      allowlist,
      [
        "output/resumes/location-info/job5156-location-info.json",
        "output/resumes/location-info/missing.json",
        "",
      ].join("\n"),
    );
    const result = runAudit(fixture, { allowlist });
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.checks.output_members.state).toBe("fail");
    expect(report.no_go_reasons.join(" ")).toMatch(/missing\.json/);
  });

  it("rejects an otherwise valid Convex export with no documents", () => {
    const fixture = createBackupFixture();
    rewriteArchives(fixture, {
      convexMembers: [
        ["resumes/documents.jsonl", ""],
        ["_storage/files/blob-1", "payload"],
      ],
      outputMembers: [["output/resumes/location-info/job5156-location-info.json", "{}\n"]],
    });
    const result = runAudit(fixture);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.checks.convex_documents.state).toBe("fail");
    expect(report.no_go_reasons.join(" ")).toMatch(/no documents/i);
  });

  it("fails explicitly when the shell hash command returns an empty digest", () => {
    const fixture = createBackupFixture();
    const bin = join(fixture.root, "bin");
    mkdirSync(bin);
    const shim = join(bin, "sha256sum");
    writeFileSync(shim, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    chmodSync(shim, 0o755);
    const result = runAudit(fixture, {
      env: { PATH: `${bin}:${process.env.PATH ?? ""}` },
    });
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.checks.hashes.state).toBe("fail");
    expect(report.checks.convex_hash.state).toBe("fail");
    expect(report.checks.output_hash.state).toBe("fail");
    expect(report.checks.config_hash.state).toBe("fail");
  }, 10_000);

  it("writes valid audit and inventory evidence JSON", () => {
    const fixture = createBackupFixture();
    const result = runAudit(fixture);
    expect(result.status, result.stderr).toBe(0);
    const audit = JSON.parse(readFileSync(join(fixture.evidence, "audit-report.json"), "utf8"));
    const source = JSON.parse(readFileSync(join(fixture.evidence, "source-inventory.json"), "utf8"));
    const output = JSON.parse(readFileSync(join(fixture.evidence, "output-inventory.json"), "utf8"));
    expect(audit.complete).toBe(true);
    expect(source.schema).toBe("trends-convex-inventory/v1");
    expect(source.document_count).toBe(2);
    expect(source.storage).toHaveLength(1);
    expect(output.schema).toBe("trends-output-inventory/v1");
    expect(output.missing).toEqual([]);
  });
});
