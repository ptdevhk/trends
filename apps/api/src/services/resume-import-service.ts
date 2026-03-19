import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { z } from "@hono/zod-openapi";

import {
  formatLocationHierarchyLabel,
  normalizeResumeLocationHierarchy,
} from "@trends/shared";
import {
  ResumeImportItemSchema,
  ResumeImportMetadataSchema,
  ResumeImportRequestSchema,
  ResumeSubmitSummarySchema,
} from "../schemas/resumes.js";
import { config } from "./config.js";

const JOB5156_HOST = "hr.job5156.com";
const RESUME_IMPORT_CONVEX_BATCH_SIZE = 200;

type ResumeImportMetadata = z.infer<typeof ResumeImportMetadataSchema>;
export type ResumeImportItem = z.infer<typeof ResumeImportItemSchema>;
export type ResumeImportRequest = z.infer<typeof ResumeImportRequestSchema>;
export type ResumeSubmitSummary = z.infer<typeof ResumeSubmitSummarySchema>;

type ConvexResumeSubmitItem = {
  externalId: string;
  content: unknown;
  hash: string;
  source: string;
  tags: string[];
};

export type NormalizedResumeImportPayload = {
  metadata: ResumeImportMetadata;
  resumes: ResumeImportItem[];
  source: string;
  tags: string[];
  convexResumes: ConvexResumeSubmitItem[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    return `{${keys.map((key) => `${key}:${stableStringify(value[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function readEnvVarFromFile(filePath: string, key: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx < 0) continue;
      const currentKey = trimmed.slice(0, idx).trim();
      if (currentKey !== key) continue;
      const value = trimmed.slice(idx + 1).trim();
      return value.replace(/^['"]|['"]$/g, "");
    }
    return null;
  } catch (error) {
    console.error("Failed to read env var from file", { filePath, key, error });
    return null;
  }
}

export function resolveConvexUrl(): string {
  if (process.env.CONVEX_URL) return process.env.CONVEX_URL;
  if (process.env.VITE_CONVEX_URL) return process.env.VITE_CONVEX_URL;

  const candidateFiles = [
    path.join(config.projectRoot, "packages", "convex", ".env.local"),
    path.join(config.projectRoot, "apps", "web", ".env.local"),
    path.join(config.projectRoot, ".env.local"),
    path.join(config.projectRoot, ".env"),
  ];

  for (const filePath of candidateFiles) {
    const direct = readEnvVarFromFile(filePath, "CONVEX_URL");
    if (direct) return direct;
    const vite = readEnvVarFromFile(filePath, "VITE_CONVEX_URL");
    if (vite) return vite;
  }

  return "http://127.0.0.1:3210";
}

function normalizeOptionalString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeSourceHost(value: string | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeTagList(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const tags = Array.from(
    new Set(
      values
        .map((value) => normalizeOptionalString(value))
        .filter((value): value is string => value !== null),
    ),
  );

  return tags.length > 0 ? tags : undefined;
}

function normalizeImportMetadata(metadata: ResumeImportMetadata): ResumeImportMetadata {
  const searchKeyword = normalizeOptionalString(metadata.searchCriteria?.keyword);
  const searchLocation = normalizeOptionalString(metadata.searchCriteria?.location);

  return ResumeImportMetadataSchema.parse({
    ...metadata,
    sourceKey: normalizeOptionalString(metadata.sourceKey) ?? undefined,
    sourceHost: normalizeSourceHost(metadata.sourceHost) ?? undefined,
    keyword: normalizeOptionalString(metadata.keyword) ?? searchKeyword ?? undefined,
    location: normalizeOptionalString(metadata.location) ?? searchLocation ?? undefined,
    searchProfileId: normalizeOptionalString(metadata.searchProfileId) ?? undefined,
    searchCriteria: metadata.searchCriteria
      ? {
          ...metadata.searchCriteria,
          keyword: searchKeyword ?? undefined,
          location: searchLocation ?? undefined,
        }
      : undefined,
  });
}

function resolveResumeSource(metadata: ResumeImportMetadata): string {
  const sourceHost = normalizeSourceHost(metadata.sourceHost);
  if (sourceHost) {
    return sourceHost;
  }

  const sourceKey = normalizeSourceHost(metadata.sourceKey);
  if (sourceKey === "job5156") {
    return JOB5156_HOST;
  }

  try {
    return new URL(metadata.sourceUrl).hostname.toLowerCase();
  } catch (error) {
    console.error("Failed to parse resume source URL", { sourceUrl: metadata.sourceUrl, error });
    return sourceKey || JOB5156_HOST;
  }
}

function normalizeCandidateId(value: string | undefined): string | null {
  return normalizeOptionalString(value);
}

function buildResumeExternalId(resume: ResumeImportItem, source: string, hash: string): string {
  const explicitExternalId = normalizeCandidateId(resume.externalId);
  if (explicitExternalId) {
    return explicitExternalId;
  }

  const profileId = normalizeCandidateId(resume.profileId);
  if (profileId) {
    return `${source}:profile:${profileId}`;
  }

  const resumeId = normalizeCandidateId(resume.resumeId);
  if (resumeId) {
    return `${source}:resume:${resumeId}`;
  }

  const perUserId = normalizeCandidateId(resume.perUserId);
  if (perUserId) {
    return `${source}:user:${perUserId}`;
  }

  return `${source}:hash:${hash}`;
}

function buildNormalizedResumeContent(resume: ResumeImportItem): Record<string, unknown> {
  const { sourceHost: _sourceHost, tags: _tags, ...content } = resume;
  const locationHierarchy = normalizeResumeLocationHierarchy(resume);
  const rawLocation = typeof content.location === "string" ? content.location.trim() : "";
  const location = rawLocation || (locationHierarchy ? formatLocationHierarchyLabel(locationHierarchy) : "");

  return {
    ...content,
    location,
    ...(locationHierarchy ? { locationHierarchy } : {}),
  };
}

async function submitResumesToConvex(args: { resumes: ConvexResumeSubmitItem[] }): Promise<{
  submitted: number;
  deduped: number;
  inserted: number;
  updated: number;
  unchanged: number;
}> {
  const convexUrl = resolveConvexUrl().replace(/\/$/, "");
  const totals = {
    submitted: 0,
    deduped: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
  };

  for (let index = 0; index < args.resumes.length; index += RESUME_IMPORT_CONVEX_BATCH_SIZE) {
    const batch = args.resumes.slice(index, index + RESUME_IMPORT_CONVEX_BATCH_SIZE);
    // Keep each Convex mutation comfortably below the per-execution read limit.
    const response = await fetch(`${convexUrl}/api/mutation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        path: "resume_tasks:submitResumes",
        args: {
          resumes: batch,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Convex mutation failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as {
      status?: string;
      value?: unknown;
      errorMessage?: string;
    };

    if (payload.status !== "success") {
      throw new Error(payload.errorMessage || "Convex mutation failed");
    }

    if (!isRecord(payload.value)) {
      throw new Error("Invalid submitResumes response from Convex");
    }

    const value = payload.value;
    totals.submitted += typeof value.submitted === "number" ? value.submitted : 0;
    totals.deduped += typeof value.deduped === "number" ? value.deduped : 0;
    totals.inserted += typeof value.inserted === "number" ? value.inserted : 0;
    totals.updated += typeof value.updated === "number" ? value.updated : 0;
    totals.unchanged += typeof value.unchanged === "number" ? value.unchanged : 0;
  }

  return totals;
}

export function normalizeResumeImportPayload(input: ResumeImportRequest): NormalizedResumeImportPayload {
  const parsedInput = ResumeImportRequestSchema.parse(input);
  const metadata = normalizeImportMetadata(parsedInput.metadata);
  const resumes = parsedInput.resumes ?? parsedInput.data ?? [];
  const tag = normalizeOptionalString(metadata.searchProfileId) ?? normalizeOptionalString(metadata.keyword);
  const defaultTags = tag ? [tag] : [];
  const source = resolveResumeSource(metadata);

  const convexResumes = resumes.map((resume) => {
    const itemSource = normalizeSourceHost(resume.sourceHost) ?? source;
    const itemTags = normalizeTagList(resume.tags) ?? defaultTags;
    const content: unknown = buildNormalizedResumeContent(resume);
    const hash = crypto.createHash("sha256").update(stableStringify(content), "utf8").digest("hex");
    const externalId = buildResumeExternalId(resume, itemSource, hash);

    return {
      externalId,
      content,
      hash,
      source: itemSource,
      tags: itemTags,
    };
  });

  return {
    metadata,
    resumes,
    source,
    tags: defaultTags,
    convexResumes,
  };
}

export async function submitNormalizedResumeImport(
  payload: NormalizedResumeImportPayload,
): Promise<ResumeSubmitSummary> {
  const result = await submitResumesToConvex({ resumes: payload.convexResumes });

  return ResumeSubmitSummarySchema.parse({
    success: true,
    submitted: result.submitted,
    inserted: result.inserted,
    updated: result.updated,
    unchanged: result.unchanged,
    deduped: result.deduped,
  });
}

export async function submitResumeImport(input: ResumeImportRequest): Promise<ResumeSubmitSummary> {
  return submitNormalizedResumeImport(normalizeResumeImportPayload(input));
}
