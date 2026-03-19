import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { readPortableBackupFile, writePortableBackupFile } from "./operator-utils.ts";

const execFileAsync = promisify(execFile);

describe("resume operator utils", () => {
  it("writes and reads plain JSON backups", async () => {
    const filePath = `${process.env.TMPDIR ?? "/tmp"}/trends-resume-backup-${randomUUID()}.json`;
    const payload = {
      metadata: { generatedBy: "test" },
      resumes: [{ resumeId: "r1" }],
    };

    try {
      const bytes = await writePortableBackupFile(filePath, payload);
      const restored = await readPortableBackupFile(filePath);

      expect(bytes).toBeGreaterThan(0);
      expect(JSON.parse(restored)).toEqual(payload);
    } finally {
      await unlink(filePath).catch(() => undefined);
    }
  });

  it("writes and reads tar.gz backups", async () => {
    const filePath = `${process.env.TMPDIR ?? "/tmp"}/trends-resume-backup-${randomUUID()}.tar.gz`;
    const payload = {
      metadata: { generatedBy: "test" },
      resumes: [{ resumeId: "r1" }, { resumeId: "r2" }],
    };

    try {
      const bytes = await writePortableBackupFile(filePath, payload);
      const restored = await readPortableBackupFile(filePath);

      expect(bytes).toBeGreaterThan(0);
      expect(JSON.parse(restored)).toEqual(payload);
    } finally {
      await unlink(filePath).catch(() => undefined);
    }
  });

  it("reads tar.gz backups created by the system tar command", async () => {
    const basePath = `${process.env.TMPDIR ?? "/tmp"}/trends-resume-backup-${randomUUID()}`;
    const jsonPath = `${basePath}.json`;
    const archivePath = `${basePath}.tar.gz`;
    const payload = {
      metadata: { generatedBy: "tar" },
      resumes: [{ resumeId: "external" }],
    };

    try {
      await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await execFileAsync("tar", ["-czf", archivePath, "-C", dirname(jsonPath), basename(jsonPath)], {
        env: { ...process.env, COPYFILE_DISABLE: "1" },
      });

      const restored = await readPortableBackupFile(archivePath);
      expect(JSON.parse(restored)).toEqual(payload);
    } finally {
      await unlink(jsonPath).catch(() => undefined);
      await unlink(archivePath).catch(() => undefined);
    }
  });

  it("reads gzip-compressed tar backups even without a .tar.gz extension", async () => {
    const basePath = `${process.env.TMPDIR ?? "/tmp"}/trends-resume-backup-${randomUUID()}`;
    const jsonPath = `${basePath}.json`;
    const archivePath = `${basePath}.backup`;
    const payload = {
      metadata: { generatedBy: "tar" },
      resumes: [{ resumeId: "extensionless" }],
    };

    try {
      await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await execFileAsync("tar", ["-czf", archivePath, "-C", dirname(jsonPath), basename(jsonPath)], {
        env: { ...process.env, COPYFILE_DISABLE: "1" },
      });

      const restored = await readPortableBackupFile(archivePath);
      expect(JSON.parse(restored)).toEqual(payload);
    } finally {
      await unlink(jsonPath).catch(() => undefined);
      await unlink(archivePath).catch(() => undefined);
    }
  });
});
