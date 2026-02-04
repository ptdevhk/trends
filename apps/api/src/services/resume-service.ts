import fs from "node:fs";
import path from "node:path";

import { findProjectRoot } from "./db.js";
import { DataNotFoundError, FileParseError } from "./errors.js";

import type { ResumeItem, ResumeSampleFile, ResumeWorkHistoryItem } from "../types/resume.js";

type ResumeMetadata = {
  sourceUrl?: string;
  searchCriteria?: {
    keyword?: string;
    location?: string;
    filters?: Record<string, string>;
  };
  generatedAt?: string;
  generatedBy?: string;
  totalPages?: number;
  totalResumes?: number;
  reproduction?: string;
};

type ResumePayload = ResumeItem[] | { data?: ResumeItem[]; resumes?: ResumeItem[]; metadata?: ResumeMetadata };

function toStringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value);
}

function normalizeWorkHistory(value: unknown): ResumeWorkHistoryItem[] {
  if (typeof value === "string") {
    const raw = value.trim();
    return raw ? [{ raw }] : [];
  }
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (typeof entry === "string") return { raw: entry.trim() };
      if (entry && typeof entry === "object") {
        const raw = toStringValue((entry as { raw?: unknown }).raw);
        return raw ? { raw } : null;
      }
      return null;
    })
    .filter((item): item is ResumeWorkHistoryItem => Boolean(item && item.raw));
}

function normalizeResumeItem(item: unknown): ResumeItem {
  const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};

  const resumeId = toStringValue(record.resumeId);
  const perUserId = toStringValue(record.perUserId);

  return {
    name: toStringValue(record.name),
    profileUrl: toStringValue(record.profileUrl),
    activityStatus: toStringValue(record.activityStatus),
    age: toStringValue(record.age),
    experience: toStringValue(record.experience),
    education: toStringValue(record.education),
    location: toStringValue(record.location),
    selfIntro: toStringValue(record.selfIntro),
    jobIntention: toStringValue(record.jobIntention),
    expectedSalary: toStringValue(record.expectedSalary),
    workHistory: normalizeWorkHistory(record.workHistory),
    extractedAt: toStringValue(record.extractedAt),
    resumeId: resumeId || undefined,
    perUserId: perUserId || undefined,
  };
}

function normalizePayload(payload: ResumePayload, filepath: string): ResumeItem[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.resumes)
        ? payload.resumes
        : null;

  if (!list) {
    throw new FileParseError(filepath, "Expected a JSON array of resumes");
  }

  return list.map((item) => normalizeResumeItem(item));
}

export class ResumeService {
  readonly projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
  }

  private getSamplesDir(): string {
    return path.join(this.projectRoot, "output", "resumes", "samples");
  }

  listSampleFiles(): ResumeSampleFile[] {
    const samplesDir = this.getSamplesDir();
    if (!fs.existsSync(samplesDir)) return [];

    const entries = fs.readdirSync(samplesDir)
      .filter((filename) => filename.endsWith(".json"))
      .map((filename) => {
        const filePath = path.join(samplesDir, filename);
        const stat = fs.statSync(filePath);
        return {
          name: filename.replace(/\.json$/i, ""),
          filename,
          updatedAt: stat.mtime.toISOString(),
          size: stat.size,
        } satisfies ResumeSampleFile;
      });

    return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  loadSample(name?: string): { items: ResumeItem[]; sample: ResumeSampleFile; metadata?: ResumeMetadata } {
    const samplesDir = this.getSamplesDir();
    const samples = this.listSampleFiles();

    if (samples.length === 0) {
      throw new DataNotFoundError("No resume sample files found", {
        suggestion: "Copy exported JSON into output/resumes/samples (e.g., sample-initial.json)",
      });
    }

    const normalizedName = name?.replace(/\.json$/i, "");
    const sample = normalizedName
      ? samples.find((item) => item.name === normalizedName || item.filename === name)
      : samples[0];

    if (!sample) {
      throw new DataNotFoundError(`Sample not found: ${name}`, {
        suggestion: `Available samples: ${samples.map((item) => item.name).join(", ")}`,
      });
    }

    const filePath = path.join(samplesDir, sample.filename);
    let parsed: ResumePayload;

    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as ResumePayload;
    } catch (error) {
      throw new FileParseError(filePath, error instanceof Error ? error.message : "Invalid JSON");
    }

    const items = normalizePayload(parsed, filePath);
    const metadata = !Array.isArray(parsed) && parsed ? parsed.metadata : undefined;
    const resolvedMetadata = metadata ?? {
      generatedAt: sample.updatedAt,
      generatedBy: "legacy-sample",
      totalResumes: items.length,
    };
    return { items, sample, metadata: resolvedMetadata };
  }

  searchResumes(items: ResumeItem[], query?: string): ResumeItem[] {
    if (!query) return items;
    const trimmed = query.trim();
    if (!trimmed) return items;
    const keyword = trimmed.toLowerCase();

    return items.filter((item) => {
      return item.name.toLowerCase().includes(keyword)
        || item.jobIntention.toLowerCase().includes(keyword);
    });
  }
}
