import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { writePortableBackupFile } from "./operator-utils.ts";
import { runRestoreResumes } from "./restore-resumes.ts";

async function createTempDir(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "trends-restore-resumes-"));
}

async function writeBackupFile(params: {
  dir: string;
  name: string;
  count: number;
}): Promise<string> {
  const filePath = path.join(params.dir, params.name);
  await writePortableBackupFile(filePath, {
    metadata: {
      sourceUrl: `https://example.com/${params.name}`,
      generatedBy: "test",
      totalResumes: params.count,
    },
    resumes: Array.from({ length: params.count }, (_, index) => ({
      resumeId: `${params.name}-${index + 1}`,
    })),
  });
  return filePath;
}

describe("restore-resumes", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
      }),
    );
    tempDirs.length = 0;
  });

  it("restores all supported backup files from a directory in deterministic source order", async () => {
    const dir = await createTempDir();
    tempDirs.push(dir);

    const seekFile = await writeBackupFile({
      dir,
      name: "resume-backup-seek-top20-20260321-015304.json",
      count: 20,
    });
    const manualFile = await writeBackupFile({
      dir,
      name: "resume-backup-51job-manual-top20-20260321-015304.json",
      count: 20,
    });
    const jobFile = await writeBackupFile({
      dir,
      name: "resume-backup-job5156-top20-20260321-015304.json",
      count: 20,
    });
    await mkdir(path.join(dir, "nested"), { recursive: true });

    const requests: Array<{ pathName: string; body: unknown }> = [];
    const summary = await runRestoreResumes(
      {
        apiUrl: "http://localhost:3000",
        workspace: "dev",
        filePath: dir,
        mode: "upsert",
        confirm: false,
      },
      {
        fetch: vi.fn(async (input, init) => {
          const url = typeof input === "string" ? input : input.toString();
          requests.push({
            pathName: new URL(url).pathname,
            body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
          });
          return new Response(
            JSON.stringify({
              success: true,
              submitted: 20,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }) as typeof fetch,
      },
    );

    expect(requests.map((entry) => entry.pathName)).toEqual([
      "/api/resumes/import",
      "/api/resumes/import",
      "/api/resumes/import",
    ]);
    expect(summary.files.map((entry) => entry.file)).toEqual([
      jobFile,
      seekFile,
      manualFile,
    ]);
    expect(summary.files.map((entry) => entry.count)).toEqual([20, 20, 20]);
  });

  it("resets until the API reports the workspace is fully cleared before importing", async () => {
    const dir = await createTempDir();
    tempDirs.push(dir);

    await writeBackupFile({
      dir,
      name: "resume-backup-job5156-top20-20260321-015304.json",
      count: 20,
    });
    await writeBackupFile({
      dir,
      name: "resume-backup-seek-top20-20260321-015304.json",
      count: 20,
    });

    const requests: string[] = [];
    let resetCalls = 0;
    const summary = await runRestoreResumes(
      {
        apiUrl: "http://localhost:3000",
        workspace: "dev",
        filePath: dir,
        mode: "replace",
        confirm: true,
      },
      {
        fetch: vi.fn(async (input) => {
          const url = typeof input === "string" ? input : input.toString();
          const pathName = new URL(url).pathname;
          requests.push(pathName);
          if (pathName === "/api/resumes/reset") {
            resetCalls += 1;
          }
          return new Response(
            JSON.stringify({
              success: true,
              ...(pathName === "/api/resumes/reset"
                ? resetCalls === 1
                  ? {
                      count: 200,
                      partial: true,
                      deleted: {
                        resumes: 200,
                      },
                    }
                  : {
                      count: 12,
                      partial: false,
                      deleted: {
                        resumes: 12,
                        analysis_tasks: 5,
                      },
                    }
                : {
                    submitted: 20,
                  }),
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }) as typeof fetch,
      },
    );

    expect(requests).toEqual([
      "/api/resumes/reset",
      "/api/resumes/reset",
      "/api/resumes/import",
      "/api/resumes/import",
    ]);
    expect(summary.reset).toBe(true);
    expect(summary.resetResult).toEqual({
      success: true,
      count: 212,
      partial: false,
      deleted: {
        resumes: 212,
        analysis_tasks: 5,
      },
    });
    expect(summary.files).toHaveLength(2);
  });

  it("rejects directories that do not contain supported backup files", async () => {
    const dir = await createTempDir();
    tempDirs.push(dir);

    await expect(
      runRestoreResumes({
        apiUrl: "http://localhost:3000",
        workspace: "dev",
        filePath: dir,
        mode: "upsert",
        confirm: false,
      }),
    ).rejects.toThrow("no restore backup files found in directory");
  });
});
