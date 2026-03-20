import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { readPortableBackupFile } from "./operator-utils.ts";
import {
  DEFAULT_JOB5156_URL,
  DEFAULT_SEEK_URL,
  SOURCE_HOSTS,
  resolveRequestedSources,
  resolveUserFacingPath,
  runSnapshotSourceBackups,
  type SnapshotOptions,
} from "./snapshot-source-backups.ts";

async function createTestRepoRoot(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "trends-source-backups-"));
}

function fixedNow(): Date {
  return new Date(2026, 2, 20, 12, 0, 0);
}

function buildExpectedFilePath(
  repoRoot: string,
  alias: SnapshotOptions["sources"][number],
): string {
  return path.join(
    repoRoot,
    "output",
    "resume-backups",
    "20260320-120000",
    `resume-backup-${alias}-top20-20260320-120000.json`,
  );
}

function baseOptions(
  repoRoot: string,
  source: SnapshotOptions["sources"][number],
): SnapshotOptions {
  return {
    repoRoot,
    apiUrl: "http://localhost:3000",
    workspace: "dev",
    count: 20,
    maxPages: 10,
    outDir: path.join(repoRoot, "output", "resume-backups"),
    sources: [source],
    job5156Url: DEFAULT_JOB5156_URL,
    seekUrl: DEFAULT_SEEK_URL,
    manualFile: "~/Downloads/51job.rar",
    cdpEndpoint: "http://127.0.0.1:9222",
    waitTimeoutSec: 600,
  };
}

function createCollectedPayload(
  alias: "job5156" | "seek",
  count: number,
): Record<string, unknown> {
  const sourceUrl = alias === "seek" ? DEFAULT_SEEK_URL : DEFAULT_JOB5156_URL;
  return {
    metadata: {
      sourceUrl,
      generatedBy: "test-collector",
    },
    resumes: Array.from({ length: count }, (_, index) => ({
      resumeId: `${alias}-${index + 1}`,
      candidateName: `${alias}-candidate-${index + 1}`,
    })),
  };
}

describe("snapshot-source-backups", () => {
  const repoRoots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      repoRoots.map(async (repoRoot) => {
        await rm(repoRoot, { recursive: true, force: true });
      }),
    );
    repoRoots.length = 0;
  });

  it("resolves the requested sources in stable order without duplicates", () => {
    expect(resolveRequestedSources(["seek", "job5156", "seek"])).toEqual([
      "seek",
      "job5156",
    ]);
    expect(resolveRequestedSources([])).toEqual([
      "job5156",
      "seek",
      "51job-manual",
    ]);
  });

  it("resolves ~/ paths against the invoking sudo user home directory", async () => {
    const resolved = await resolveUserFacingPath(
      "~/Downloads/51job.rar",
      "/repo",
      {
        resolveUserHomeDirectory: async () => "/Users/tester",
      },
      { SUDO_USER: "tester" },
    );

    expect(resolved).toBe(path.join("/Users/tester", "Downloads", "51job.rar"));
  });

  it("fails before writing a snapshot file when browser preflight fails", async () => {
    const repoRoot = await createTestRepoRoot();
    repoRoots.push(repoRoot);
    const exec = vi.fn(async () => {
      const error = new Error("Command failed");
      Object.assign(error, {
        stderr: "Error: Chrome is not reachable on the CDP endpoint.",
        stdout: "",
      });
      throw error;
    });

    await expect(
      runSnapshotSourceBackups(baseOptions(repoRoot, "seek"), {
        now: fixedNow,
        exec,
        log: () => undefined,
        resolveUserHomeDirectory: async () => "/Users/tester",
      }),
    ).rejects.toThrow(
      "[seek] browser collector failed: Chrome is not reachable on the CDP endpoint.",
    );

    expect(exec).toHaveBeenCalledTimes(1);
    await expect(access(buildExpectedFilePath(repoRoot, "seek"))).rejects.toThrow();
  });

  it("writes a direct SEEK snapshot file from the browser collector payload", async () => {
    const repoRoot = await createTestRepoRoot();
    repoRoots.push(repoRoot);
    const exec = vi.fn(async (_command: string, args: string[]) => {
      if (args.includes("--check-only")) {
        return {
          stdout: JSON.stringify({
            mode: "check",
            source: "seek",
            sourceHost: SOURCE_HOSTS.seek,
            url: DEFAULT_SEEK_URL,
            status: { sourceKey: "seek" },
          }),
          stderr: "",
        };
      }

      return {
        stdout: JSON.stringify({
          mode: "collect",
          source: "seek",
          sourceHost: SOURCE_HOSTS.seek,
          url: DEFAULT_SEEK_URL,
          status: { sourceKey: "seek" },
          payload: createCollectedPayload("seek", 20),
        }),
        stderr: "",
      };
    });

    const result = await runSnapshotSourceBackups(baseOptions(repoRoot, "seek"), {
      now: fixedNow,
      exec,
      log: () => undefined,
      resolveUserHomeDirectory: async () => "/Users/tester",
    });

    const written = JSON.parse(
      await readPortableBackupFile(buildExpectedFilePath(repoRoot, "seek")),
    ) as {
      metadata: Record<string, unknown>;
      resumes: Array<Record<string, unknown>>;
    };

    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[0]?.[1]).toContain("--check-only");
    expect(result.sources[0]).toMatchObject({
      alias: "seek",
      sourceHost: SOURCE_HOSTS.seek,
      launchUrl: DEFAULT_SEEK_URL,
      count: 20,
      resetCount: 0,
      resetPartial: false,
      observedCount: 20,
    });
    expect(written.metadata.sourceKey).toBe("seek");
    expect(written.metadata.sourceHost).toBe(SOURCE_HOSTS.seek);
    expect(written.metadata.sourceUrl).toBe(DEFAULT_SEEK_URL);
    expect(written.metadata.totalResumes).toBe(20);
    expect(written.resumes).toHaveLength(20);
    expect(written.resumes[0]?.sourceHost).toBe(SOURCE_HOSTS.seek);
  });

  it("fails and leaves no output file when the collected snapshot is short", async () => {
    const repoRoot = await createTestRepoRoot();
    repoRoots.push(repoRoot);

    await expect(
      runSnapshotSourceBackups(baseOptions(repoRoot, "job5156"), {
        now: fixedNow,
        exec: async (_command, args) => {
          if (args.includes("--check-only")) {
            return {
              stdout: JSON.stringify({
                mode: "check",
                source: "job5156",
                sourceHost: SOURCE_HOSTS.job5156,
                url: DEFAULT_JOB5156_URL,
                status: { sourceKey: "job5156" },
              }),
              stderr: "",
            };
          }

          return {
            stdout: JSON.stringify({
              mode: "collect",
              source: "job5156",
              sourceHost: SOURCE_HOSTS.job5156,
              url: DEFAULT_JOB5156_URL,
              status: { sourceKey: "job5156" },
              payload: createCollectedPayload("job5156", 19),
            }),
            stderr: "",
          };
        },
        log: () => undefined,
        resolveUserHomeDirectory: async () => "/Users/tester",
      }),
    ).rejects.toThrow("expected 20 resumes in job5156 snapshot, received 19");

    await expect(
      access(buildExpectedFilePath(repoRoot, "job5156")),
    ).rejects.toThrow();
  });

  it("writes the manual snapshot file directly from the local archive builder", async () => {
    const repoRoot = await createTestRepoRoot();
    repoRoots.push(repoRoot);

    const userHome = path.join(repoRoot, "fake-home");
    const manualArchive = path.join(userHome, "Downloads", "51job.rar");
    await mkdir(path.dirname(manualArchive), { recursive: true });
    await writeFile(manualArchive, "rar-bytes", "utf8");

    const buildManualSnapshotPayload = vi.fn(
      async ({
        archivePath,
        limit,
      }: {
        archivePath: string;
        limit: number;
      }) => ({
        payload: {
          metadata: {
            sourceKey: "51job-manual",
            sourceHost: SOURCE_HOSTS["51job-manual"],
            sourceUrl: "https://www.51job.com/",
            totalResumes: limit,
          },
          resumes: Array.from({ length: limit }, (_, index) => ({
            resumeId: `manual-${index + 1}`,
            candidateName: `manual-candidate-${index + 1}`,
          })),
        },
        summary: {
          uploadedFiles: 1,
          discoveredFiles: 1,
          parsedResumes: limit,
          imported: limit,
          skipped: 0,
          failed: 0,
        },
      }),
    );

    const result = await runSnapshotSourceBackups(
      baseOptions(repoRoot, "51job-manual"),
      {
        now: fixedNow,
        exec: async () => {
          throw new Error("browser collector should not run for manual snapshots");
        },
        log: () => undefined,
        buildManualSnapshotPayload,
        resolveUserHomeDirectory: async () => userHome,
      },
    );

    const written = JSON.parse(
      await readPortableBackupFile(
        buildExpectedFilePath(repoRoot, "51job-manual"),
      ),
    ) as {
      metadata: Record<string, unknown>;
      resumes: Array<Record<string, unknown>>;
    };

    expect(buildManualSnapshotPayload).toHaveBeenCalledWith({
      archivePath: manualArchive,
      limit: 20,
    });
    expect(result.sources[0]).toMatchObject({
      alias: "51job-manual",
      sourceHost: SOURCE_HOSTS["51job-manual"],
      manualFile: manualArchive,
      count: 20,
      resetCount: 0,
      resetPartial: false,
      observedCount: 20,
      manualImportSummary: expect.objectContaining({
        imported: 20,
        parsedResumes: 20,
      }),
    });
    expect(written.metadata.sourceHost).toBe(SOURCE_HOSTS["51job-manual"]);
    expect(written.resumes).toHaveLength(20);
  });
});
