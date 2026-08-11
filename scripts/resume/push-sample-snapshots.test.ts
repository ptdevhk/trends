import { execFile } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: vi.fn() };
});

import {
  DEFAULT_EXCLUDE_PATTERNS,
  compileGlobPattern,
  filterSnapshotJsonFiles,
  isExcludedFileName,
  main,
  resolveExcludePatterns,
} from "./push-sample-snapshots.ts";

const SNAPSHOT_FILES = [
  "resume-backup-51job-top50-20260725-000601.json",
  "resume-backup-job5156-top50-20260725-000601.json",
  "resume-backup-seek-top50-20260725-000601.json",
  "resume-backup-seek-talentsearch-top50-20260725-000601.json",
];

describe("resolveExcludePatterns", () => {
  it("uses the built-in default patterns when SNAPSHOT_EXCLUDE is unset", () => {
    expect(resolveExcludePatterns({})).toEqual(DEFAULT_EXCLUDE_PATTERNS);
  });

  it("uses the built-in default patterns when SNAPSHOT_EXCLUDE is blank", () => {
    expect(resolveExcludePatterns({ SNAPSHOT_EXCLUDE: "   " })).toEqual(
      DEFAULT_EXCLUDE_PATTERNS,
    );
  });

  it("replaces the defaults with comma-separated patterns when set", () => {
    expect(
      resolveExcludePatterns({ SNAPSHOT_EXCLUDE: "*.tmp.json, resume-backup-51job-*" }),
    ).toEqual(["*.tmp.json", "resume-backup-51job-*"]);
  });
});

describe("compileGlobPattern", () => {
  it("anchors the pattern and supports * and ?", () => {
    const pattern = compileGlobPattern("resume-backup-seek-top*.json");
    expect(pattern.test("resume-backup-seek-top50-20260725-000601.json")).toBe(true);
    expect(pattern.test("resume-backup-seek-talentsearch-top50-20260725-000601.json")).toBe(false);
    expect(pattern.test("resume-backup-51job-top50-20260725-000601.json")).toBe(false);
  });

  it("treats regex metacharacters literally", () => {
    const pattern = compileGlobPattern("file[1].json");
    expect(pattern.test("file[1].json")).toBe(true);
    expect(pattern.test("file1.json")).toBe(false);
  });
});

describe("isExcludedFileName", () => {
  it("matches seek recommended but not seek talentsearch with the default pattern", () => {
    expect(
      isExcludedFileName("resume-backup-seek-top50-20260725-000601.json", DEFAULT_EXCLUDE_PATTERNS),
    ).toBe(true);
    expect(
      isExcludedFileName(
        "resume-backup-seek-talentsearch-top50-20260725-000601.json",
        DEFAULT_EXCLUDE_PATTERNS,
      ),
    ).toBe(false);
  });
});

describe("filterSnapshotJsonFiles", () => {
  it("excludes only the seek recommended file by default", () => {
    const { included, excluded } = filterSnapshotJsonFiles(
      SNAPSHOT_FILES,
      DEFAULT_EXCLUDE_PATTERNS,
    );
    expect(included).toEqual([
      "resume-backup-51job-top50-20260725-000601.json",
      "resume-backup-job5156-top50-20260725-000601.json",
      "resume-backup-seek-talentsearch-top50-20260725-000601.json",
    ]);
    expect(excluded).toEqual(["resume-backup-seek-top50-20260725-000601.json"]);
  });

  it("honors a custom exclusion list (e.g. talentsearch only)", () => {
    const { included, excluded } = filterSnapshotJsonFiles(SNAPSHOT_FILES, [
      "resume-backup-seek-talentsearch*.json",
    ]);
    expect(included).toContain("resume-backup-seek-top50-20260725-000601.json");
    expect(excluded).toEqual(["resume-backup-seek-talentsearch-top50-20260725-000601.json"]);
  });

  it("can exclude every file", () => {
    const { included, excluded } = filterSnapshotJsonFiles(SNAPSHOT_FILES, ["*.json"]);
    expect(included).toEqual([]);
    expect(excluded).toHaveLength(SNAPSHOT_FILES.length);
  });
});

describe("main (integration, git mocked)", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.mocked(execFile).mockReset();
  });

  it("pushes only non-excluded files and regenerates the README from them", async () => {
    const snapshotDir = await mkdtemp(path.join(os.tmpdir(), "trends-push-snap-"));
    try {
      for (const name of SNAPSHOT_FILES) {
        writeFileSync(
          path.join(snapshotDir, name),
          JSON.stringify({ resumes: [{ id: name }] }),
          "utf8",
        );
      }

      const pushCwds: string[] = [];
      const stagedAtPush: { files: string[]; readme: string } = { files: [], readme: "" };
      const mockedExecFile = vi.mocked(execFile);
      const mockImplementation = (...all: unknown[]) => {
        const args = all[1] as string[];
        const callback = all[all.length - 1] as (
          error: Error | null,
          result: { stdout: string; stderr: string },
        ) => void;
        const ok = { stdout: "", stderr: "" };
        if (args[0] === "clone") {
          callback(null, ok);
          return;
        }
        if (args[0] === "auth") {
          callback(null, ok);
          return;
        }
        if (args[0] === "diff") {
          callback(new Error("exit 1 — changes present"), ok);
          return;
        }
        if (args[0] === "push") {
          const cwd = (all[2] as { cwd?: string } | undefined)?.cwd ?? "";
          pushCwds.push(cwd);
          // Snapshot the staged state now — main() deletes the temp clone in its finally block.
          stagedAtPush.files = readdirSync(path.join(cwd, "snapshots")).sort();
          stagedAtPush.readme = readFileSync(path.join(cwd, "README.md"), "utf8");
        }
        callback(null, ok);
      };
      mockedExecFile.mockImplementation(
        mockImplementation as unknown as typeof execFile,
      );

      process.env.SNAPSHOT_DIR = snapshotDir;
      process.env.SAMPLE_REPO = "ptdevhk/fake-samples";
      delete process.env.SNAPSHOT_EXCLUDE;

      await main();

      expect(pushCwds).toHaveLength(1);
      expect(stagedAtPush.files).toEqual([
        "resume-backup-51job-top50-20260725-000601.json",
        "resume-backup-job5156-top50-20260725-000601.json",
        "resume-backup-seek-talentsearch-top50-20260725-000601.json",
      ]);

      expect(stagedAtPush.readme).toContain("resume-backup-seek-talentsearch-top50-20260725-000601.json");
      expect(stagedAtPush.readme).not.toContain("resume-backup-seek-top50-20260725-000601.json");
    } finally {
      await rm(snapshotDir, { recursive: true, force: true });
    }
  });
});
