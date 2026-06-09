import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parsePositiveInteger,
  readPortableBackupFile,
  writePortableBackupFile,
} from "./operator-utils.ts";

type BackupPayload = {
  metadata?: Record<string, unknown>;
  resumes?: unknown[];
  data?: unknown[];
  candidateActions?: unknown[];
  candidateStatus?: unknown[];
};

export type LiteBackupOptions = {
  count: number;
  sourcePath: string;
  createdAt?: string;
};

type LiteBackupPayload = BackupPayload & {
  metadata: Record<string, unknown>;
  resumes: unknown[];
  candidateActions: unknown[];
  candidateStatus: unknown[];
};

const RESUME_ID_FIELDS = [
  "_id",
  "id",
  "resumeId",
  "resume_id",
  "convexResumeId",
  "resumeKey",
  "identityKey",
  "externalId",
  "external_id",
  "profileUrl",
  "profile_url",
] as const;

const CONTENT_ID_FIELDS = [
  "resumeId",
  "resume_id",
  "perUserId",
  "profileId",
  "externalId",
  "external_id",
  "profileUrl",
  "profile_url",
  "url",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readResumeArray(payload: BackupPayload): unknown[] {
  if (Array.isArray(payload.resumes)) {
    return payload.resumes;
  }
  if (Array.isArray(payload.data)) {
    return payload.data;
  }
  return [];
}

function readMetadataArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function addStringValue(target: Set<string>, value: unknown): void {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    target.add(trimmed);
  }
}

function collectResumeIdentityKeys(resume: unknown): Set<string> {
  const keys = new Set<string>();
  if (!isRecord(resume)) {
    return keys;
  }

  for (const field of RESUME_ID_FIELDS) {
    addStringValue(keys, resume[field]);
  }

  if (isRecord(resume.content)) {
    for (const field of CONTENT_ID_FIELDS) {
      addStringValue(keys, resume.content[field]);
    }
  }

  return keys;
}

function collectSelectedResumeIdentityKeys(resumes: unknown[]): Set<string> {
  const keys = new Set<string>();
  for (const resume of resumes) {
    for (const key of collectResumeIdentityKeys(resume)) {
      keys.add(key);
    }
  }
  return keys;
}

function metadataMatchesSelected(row: unknown, selectedKeys: Set<string>): boolean {
  if (selectedKeys.size === 0 || !isRecord(row)) {
    return false;
  }

  for (const field of RESUME_ID_FIELDS) {
    const value = row[field];
    if (typeof value === "string" && selectedKeys.has(value.trim())) {
      return true;
    }
  }

  return false;
}

function parseBackupPayload(raw: string): BackupPayload {
  const decoded: unknown = JSON.parse(raw);
  if (!isRecord(decoded)) {
    throw new Error("backup payload must be an object");
  }
  return decoded;
}

function parseCount(raw: string | undefined): number {
  const parsed = parsePositiveInteger(raw ?? "20");
  if (parsed === undefined) {
    throw new Error("COUNT must be a positive integer");
  }
  return parsed;
}

function resolveInputPath(): string {
  const filePath = process.env.FILE?.trim();
  if (!filePath) {
    throw new Error("FILE is required");
  }
  return filePath;
}

function resolveOutputPath(count: number): string {
  return process.env.OUT?.trim()
    || `output/resume-backups/resumes-prod-dev-lite-top${count}.tar.gz`;
}

export function createLiteBackupPayload(
  payload: BackupPayload,
  options: LiteBackupOptions,
): LiteBackupPayload {
  if (!Number.isInteger(options.count) || options.count < 1) {
    throw new Error("COUNT must be a positive integer");
  }

  const resumes = readResumeArray(payload);
  const selectedResumes = resumes.slice(0, options.count);
  const selectedKeys = collectSelectedResumeIdentityKeys(selectedResumes);
  const candidateActions = readMetadataArray(payload.candidateActions)
    .filter((row) => metadataMatchesSelected(row, selectedKeys));
  const candidateStatus = readMetadataArray(payload.candidateStatus)
    .filter((row) => metadataMatchesSelected(row, selectedKeys));
  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  const payloadWithoutLegacyData: BackupPayload = { ...payload };
  delete payloadWithoutLegacyData.data;

  return {
    ...payloadWithoutLegacyData,
    metadata: {
      ...metadata,
      liteBackup: {
        sourcePath: options.sourcePath,
        originalResumeCount: resumes.length,
        originalCandidateActionsCount: readMetadataArray(payload.candidateActions).length,
        originalCandidateStatusCount: readMetadataArray(payload.candidateStatus).length,
        count: selectedResumes.length,
        candidateActionsCount: candidateActions.length,
        candidateStatusCount: candidateStatus.length,
        createdAt: options.createdAt ?? new Date().toISOString(),
      },
    },
    resumes: selectedResumes,
    candidateActions,
    candidateStatus,
  };
}

async function main(): Promise<void> {
  const sourcePath = resolveInputPath();
  const count = parseCount(process.env.COUNT);
  const outputPath = resolveOutputPath(count);
  const raw = await readPortableBackupFile(sourcePath);
  const payload = parseBackupPayload(raw);
  const litePayload = createLiteBackupPayload(payload, {
    count,
    sourcePath,
  });
  const bytes = await writePortableBackupFile(outputPath, litePayload);

  console.log(JSON.stringify({
    success: true,
    source: sourcePath,
    file: outputPath,
    count: litePayload.resumes.length,
    candidateActions: litePayload.candidateActions.length,
    candidateStatus: litePayload.candidateStatus.length,
    bytes,
  }, null, 2));
}

const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (isMainModule) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
