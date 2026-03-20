import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "trends-source-backups-"));
  await mkdir(path.join(repoRoot, "bin"), { recursive: true });
  await writeFile(path.join(repoRoot, "bin", "trends"), "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(path.join(repoRoot, "bin", "trends"), 0o755);
  return repoRoot;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function baseOptions(repoRoot: string, source: SnapshotOptions["sources"][number]): SnapshotOptions {
  return {
    repoRoot,
    apiUrl: "http://localhost:3000",
    workspace: "dev",
    count: 20,
    outDir: path.join(repoRoot, "output", "resume-backups"),
    sources: [source],
    job5156Url: DEFAULT_JOB5156_URL,
    seekUrl: DEFAULT_SEEK_URL,
    manualFile: "~/Downloads/51job.rar",
    waitTimeoutSec: 1,
    openBrowser: false,
  };
}

describe("snapshot-source-backups", () => {
  const repoRoots: string[] = [];
  const originalSudoUser = process.env.SUDO_USER;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (typeof originalSudoUser === "string") {
      process.env.SUDO_USER = originalSudoUser;
    } else {
      delete process.env.SUDO_USER;
    }
    await Promise.all(repoRoots.map(async (repoRoot) => {
      await rm(repoRoot, { recursive: true, force: true });
    }));
    repoRoots.length = 0;
  });

  it("resolves the requested sources in stable order without duplicates", () => {
    expect(resolveRequestedSources(["seek", "job5156", "seek"])).toEqual(["seek", "job5156"]);
    expect(resolveRequestedSources([])).toEqual(["job5156", "seek", "51job-manual"]);
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

  it("prompts SEEK runs with the source-switch instruction before waiting for rows", async () => {
    const repoRoot = await createTestRepoRoot();
    repoRoots.push(repoRoot);

    const prompts: string[] = [];
    const result = await runSnapshotSourceBackups(
      baseOptions(repoRoot, "seek"),
      {
        now: () => new Date("2026-03-20T12:00:00Z"),
        sleep: async () => undefined,
        exec: async (_command, args) => {
          const outIndex = args.indexOf("--out");
          if (outIndex >= 0) {
            await writeFile(args[outIndex + 1]!, "{\n  \"metadata\": {},\n  \"resumes\": []\n}\n", "utf8");
          }
          return {
            stdout: JSON.stringify({
              file: args[outIndex + 1],
              count: 20,
              bytes: 100,
            }),
            stderr: "",
          };
        },
        fetch: vi.fn(async (_input, init) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as { sourceHosts?: string[] };
          if (Array.isArray(body.sourceHosts) && body.sourceHosts[0] === SOURCE_HOSTS.seek) {
            return jsonResponse({
              metadata: { totalResumes: 20 },
              resumes: Array.from({ length: 20 }, (_, index) => ({ resumeId: `seek-${index + 1}` })),
            });
          }
          return jsonResponse({
            metadata: { totalResumes: 0 },
            resumes: [],
          });
        }) as typeof fetch,
        promptEnter: async (message) => {
          prompts.push(message);
        },
        openUrl: async () => undefined,
        log: () => undefined,
        warn: () => undefined,
        resolveUserHomeDirectory: async () => "/Users/tester",
      },
    );

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("switch the source selector to SEEK");
    expect(result.sources[0]).toMatchObject({
      alias: "seek",
      sourceHost: SOURCE_HOSTS.seek,
      launchUrl: DEFAULT_SEEK_URL,
      count: 20,
    });
  });

  it("removes a written backup file when the CLI summary returns a short count", async () => {
    const repoRoot = await createTestRepoRoot();
    repoRoots.push(repoRoot);
    const expectedFile = path.join(
      repoRoot,
      "output",
      "resume-backups",
      "20260320-120000",
      "resume-backup-job5156-top20-20260320-120000.json",
    );

    await expect(runSnapshotSourceBackups(
      baseOptions(repoRoot, "job5156"),
      {
        now: () => new Date("2026-03-20T12:00:00Z"),
        sleep: async () => undefined,
        exec: async (_command, args) => {
          const outIndex = args.indexOf("--out");
          if (outIndex >= 0) {
            await mkdir(path.dirname(args[outIndex + 1]!), { recursive: true });
            await writeFile(args[outIndex + 1]!, "{\n  \"metadata\": {},\n  \"resumes\": []\n}\n", "utf8");
          }
          return {
            stdout: JSON.stringify({
              file: args[outIndex + 1],
              count: 19,
              bytes: 100,
            }),
            stderr: "",
          };
        },
        fetch: vi.fn(async (_input, init) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as { sourceHosts?: string[] };
          if (Array.isArray(body.sourceHosts) && body.sourceHosts[0] === SOURCE_HOSTS.job5156) {
            return jsonResponse({
              metadata: { totalResumes: 20 },
              resumes: Array.from({ length: 20 }, (_, index) => ({ resumeId: `job5156-${index + 1}` })),
            });
          }
          return jsonResponse({
            metadata: { totalResumes: 0 },
            resumes: [],
          });
        }) as typeof fetch,
        promptEnter: async () => undefined,
        openUrl: async () => undefined,
        log: () => undefined,
        warn: () => undefined,
        resolveUserHomeDirectory: async () => "/Users/tester",
      },
    )).rejects.toThrow("expected 20 resumes in job5156 backup, received 19");

    await expect(access(expectedFile)).rejects.toThrow();
  });

  it("imports the manual archive from ~/Downloads/51job.rar before creating the backup", async () => {
    const repoRoot = await createTestRepoRoot();
    repoRoots.push(repoRoot);

    const userHome = path.join(repoRoot, "fake-home");
    const manualArchive = path.join(userHome, "Downloads", "51job.rar");
    await mkdir(path.dirname(manualArchive), { recursive: true });
    await writeFile(manualArchive, "rar-bytes", "utf8");
    process.env.SUDO_USER = "tester";

    const manualImportCalls: Array<{ url: string; body: unknown }> = [];

    const summary = await runSnapshotSourceBackups(
      baseOptions(repoRoot, "51job-manual"),
      {
        now: () => new Date("2026-03-20T12:00:00Z"),
        sleep: async () => undefined,
        exec: async (_command, args) => {
          const outIndex = args.indexOf("--out");
          if (outIndex >= 0) {
            await writeFile(args[outIndex + 1]!, "{\n  \"metadata\": {},\n  \"resumes\": []\n}\n", "utf8");
          }
          return {
            stdout: JSON.stringify({
              file: args[outIndex + 1],
              count: 20,
              bytes: 100,
            }),
            stderr: "",
          };
        },
        fetch: vi.fn(async (input, init) => {
          const url = String(input);
          if (url.endsWith("/api/resumes/manual-import")) {
            manualImportCalls.push({ url, body: init?.body });
            return jsonResponse({
              success: true,
              source: { key: "51job-manual", label: "51job-manual" },
              summary: { imported: 20, uploadedFiles: 1, discoveredFiles: 1, parsedResumes: 20 },
              files: [],
              warnings: [],
            });
          }

          const body = JSON.parse(String(init?.body ?? "{}")) as { sourceHosts?: string[] };
          if (Array.isArray(body.sourceHosts) && body.sourceHosts[0] === SOURCE_HOSTS["51job-manual"]) {
            return jsonResponse({
              metadata: { totalResumes: 20 },
              resumes: Array.from({ length: 20 }, (_, index) => ({ resumeId: `manual-${index + 1}` })),
            });
          }

          return jsonResponse({
            metadata: { totalResumes: 0 },
            resumes: [],
          });
        }) as typeof fetch,
        promptEnter: async () => undefined,
        openUrl: async () => undefined,
        log: () => undefined,
        warn: () => undefined,
        resolveUserHomeDirectory: async () => userHome,
      },
    );

    expect(manualImportCalls).toHaveLength(1);
    expect(manualImportCalls[0]?.url).toBe("http://localhost:3000/api/resumes/manual-import");
    expect(manualImportCalls[0]?.body).toBeInstanceOf(FormData);
    expect(summary.sources[0]).toMatchObject({
      alias: "51job-manual",
      sourceHost: SOURCE_HOSTS["51job-manual"],
      manualFile: manualArchive,
      count: 20,
      manualImportSummary: expect.objectContaining({ imported: 20 }),
    });
  });
});
