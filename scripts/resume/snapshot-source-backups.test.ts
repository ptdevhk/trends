import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { readPortableBackupFile } from "./operator-utils.ts";
import {
  DEFAULT_51JOB_URL,
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
  count = 20,
): string {
  return path.join(
    repoRoot,
    "output",
    "resume-backups",
    "20260320-120000",
    `resume-backup-${alias}-top${count}-20260320-120000.json`,
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
    job51Url: DEFAULT_51JOB_URL,
    seekUrl: DEFAULT_SEEK_URL,
    manualFile: "~/Downloads/51job.rar",
    cdpEndpoint: "http://127.0.0.1:9222",
    waitTimeoutSec: 600,
    unsafeLimits: false,
  };
}

function createCollectedPayload(
  alias: "job5156" | "seek" | "51job",
  count: number,
): Record<string, unknown> {
  const sourceUrl = alias === "seek"
    ? DEFAULT_SEEK_URL
    : alias === "51job"
      ? DEFAULT_51JOB_URL
      : DEFAULT_JOB5156_URL;
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
      "51job",
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

  it("fails when the only source fails (all sources failed)", async () => {
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
    ).rejects.toThrow("all sources failed");

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

  it("uses the SEEK collector sourceHost override in the run summary and snapshot file", async () => {
    const repoRoot = await createTestRepoRoot();
    repoRoots.push(repoRoot);
    const talentSearchUrl =
      "https://my.employer.seek.com/talentsearch?searchQuery=CNC+Sales&market=MY";
    const collectorSourceHost = "my.employer.seek.com";
    const exec = vi.fn(async (_command: string, args: string[]) => {
      if (args.includes("--check-only")) {
        return {
          stdout: JSON.stringify({
            mode: "check",
            source: "seek",
            sourceHost: collectorSourceHost,
            url: talentSearchUrl,
            status: { sourceKey: "seek" },
          }),
          stderr: "",
        };
      }

      return {
        stdout: JSON.stringify({
          mode: "collect",
          source: "seek",
          sourceHost: collectorSourceHost,
          url: talentSearchUrl,
          status: { sourceKey: "seek" },
          payload: {
            ...createCollectedPayload("seek", 20),
            metadata: {
              sourceUrl: talentSearchUrl,
              generatedBy: "test-collector",
            },
          },
        }),
        stderr: "",
      };
    });

    const result = await runSnapshotSourceBackups(
      { ...baseOptions(repoRoot, "seek"), seekUrl: talentSearchUrl },
      {
        now: fixedNow,
        exec,
        log: () => undefined,
        resolveUserHomeDirectory: async () => "/Users/tester",
      },
    );

    const written = JSON.parse(
      await readPortableBackupFile(buildExpectedFilePath(repoRoot, "seek")),
    ) as {
      metadata: Record<string, unknown>;
      resumes: Array<Record<string, unknown>>;
    };

    expect(result.sources[0]).toMatchObject({
      alias: "seek",
      sourceHost: collectorSourceHost,
      launchUrl: talentSearchUrl,
    });
    expect(written.metadata.sourceHost).toBe(collectorSourceHost);
    expect(written.metadata.sourceUrl).toBe(talentSearchUrl);
    expect(written.resumes[0]?.sourceHost).toBe(collectorSourceHost);
  });

  it("adds the unsafe limit override to 200+ live 51job launches", async () => {
    const repoRoot = await createTestRepoRoot();
    repoRoots.push(repoRoot);
    const exec = vi.fn(async (_command: string, args: string[]) => {
      const launchUrl = String(args[args.indexOf("--url") + 1] || "");
      if (args.includes("--check-only")) {
        return {
          stdout: JSON.stringify({
            mode: "check",
            source: "51job",
            sourceHost: SOURCE_HOSTS["51job"],
            url: launchUrl,
            status: { sourceKey: "51job" },
          }),
          stderr: "",
        };
      }

      return {
        stdout: JSON.stringify({
          mode: "collect",
          source: "51job",
          sourceHost: SOURCE_HOSTS["51job"],
          url: launchUrl,
          status: { sourceKey: "51job" },
          payload: createCollectedPayload("51job", 250),
        }),
        stderr: "",
      };
    });

    const result = await runSnapshotSourceBackups(
      {
        ...baseOptions(repoRoot, "51job"),
        count: 250,
        maxPages: 8,
        job51Url: "https://ehire.51job.com/Revision/talent/search?keyword=CNC",
        unsafeLimits: true,
      },
      {
        now: fixedNow,
        exec,
        log: () => undefined,
        resolveUserHomeDirectory: async () => "/Users/tester",
      },
    );

    expect(result.sources[0]).toMatchObject({
      alias: "51job",
      sourceHost: SOURCE_HOSTS["51job"],
      launchUrl: "https://ehire.51job.com/Revision/talent/search?keyword=CNC&tr_unsafe_limits=1",
      count: 250,
      observedCount: 250,
    });
    expect(exec).toHaveBeenCalledTimes(2);
    for (const [, args] of exec.mock.calls) {
      expect(args[args.indexOf("--limit") + 1]).toBe("250");
      expect(args[args.indexOf("--max-pages") + 1]).toBe("8");
    }
    await access(buildExpectedFilePath(repoRoot, "51job", 250));
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
    ).rejects.toThrow("all sources failed");

    await expect(
      access(buildExpectedFilePath(repoRoot, "job5156")),
    ).rejects.toThrow();
  });

  it("skips a failed source and succeeds when other sources complete", async () => {
    const repoRoot = await createTestRepoRoot();
    repoRoots.push(repoRoot);

    const exec = vi.fn(async (_command: string, args: string[]) => {
      const sourceIndex = args.indexOf("--source");
      const source = sourceIndex >= 0 ? args[sourceIndex + 1] : "";

      if (source === "seek") {
        const error = new Error("Command failed");
        Object.assign(error, {
          stderr: "seek redirected to an unsupported page",
          stdout: "",
        });
        throw error;
      }

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
          payload: createCollectedPayload("job5156", 20),
        }),
        stderr: "",
      };
    });

    const logs: string[] = [];
    const result = await runSnapshotSourceBackups(
      { ...baseOptions(repoRoot, "job5156"), sources: ["job5156", "seek"] },
      {
        now: fixedNow,
        exec,
        log: (msg) => logs.push(msg),
        resolveUserHomeDirectory: async () => "/Users/tester",
      },
    );

    expect(result.success).toBe(true);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.alias).toBe("job5156");
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.alias).toBe("seek");
    expect(result.skipped[0]?.reason).toContain("seek redirected");
    expect(logs.some((l) => l.includes("[seek] skipped:"))).toBe(true);
    await access(buildExpectedFilePath(repoRoot, "job5156"));
    await expect(access(buildExpectedFilePath(repoRoot, "seek"))).rejects.toThrow();
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
