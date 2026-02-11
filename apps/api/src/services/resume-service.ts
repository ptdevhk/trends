import fs from "node:fs";
import path from "node:path";

import { findProjectRoot } from "./db.js";
import { DataNotFoundError, FileParseError } from "./errors.js";
import { ResumeIndexService } from "./resume-index.js";

import type { ResumeItem, ResumeSampleFile, ResumeWorkHistoryItem } from "../types/resume.js";
import type { ResumeIndex } from "./resume-index.js";

export type ResumeFilters = {
  minExperience?: number;
  maxExperience?: number;
  education?: string[];
  skills?: string[];
  locations?: string[];
  minSalary?: number;
  maxSalary?: number;
};

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
  private readonly indexService: ResumeIndexService;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    this.indexService = new ResumeIndexService(this.projectRoot);
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

  loadSample(name?: string): {
    items: ResumeItem[];
    sample: ResumeSampleFile;
    metadata?: ResumeMetadata;
    indexes: Map<string, ResumeIndex>;
  } {
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
    const cacheKey = `${sample.filename}:${sample.updatedAt}`;
    const indexes = this.indexService.buildIndex(cacheKey, items);
    return { items, sample, metadata: resolvedMetadata, indexes };
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

  filterResumes(items: ResumeItem[], filters?: ResumeFilters): ResumeItem[] {
    if (!filters) return items;

    return items.filter((item) => {
      if (filters.minExperience !== undefined || filters.maxExperience !== undefined) {
        const experience = parseExperienceYears(item.experience);
        if (experience === null) return false;
        if (filters.minExperience !== undefined && experience < filters.minExperience) return false;
        if (filters.maxExperience !== undefined && experience > filters.maxExperience) return false;
      }

      if (filters.education?.length) {
        const level = normalizeEducationLevel(item.education);
        if (!level || !filters.education.includes(level)) return false;
      }

      if (filters.locations?.length) {
        const location = item.location || "";
        const hasLocation = filters.locations.some((target) => location.includes(target));
        if (!hasLocation) return false;
      }

      if (filters.skills?.length) {
        const haystack = buildSearchText(item);
        const hasSkill = filters.skills.some((skill) => haystack.includes(skill.toLowerCase()));
        if (!hasSkill) return false;
      }

      if (filters.minSalary !== undefined || filters.maxSalary !== undefined) {
        const salary = parseSalaryRange(item.expectedSalary);
        if (!salary) return false;
        if (filters.minSalary !== undefined) {
          const maxSalary = salary.max ?? salary.min;
          if (maxSalary !== undefined && maxSalary < filters.minSalary) return false;
        }
        if (filters.maxSalary !== undefined) {
          const minSalary = salary.min ?? salary.max;
          if (minSalary !== undefined && minSalary > filters.maxSalary) return false;
        }
      }

      return true;
    });
  }
}

export function parseExperienceYears(value: string): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (/应届|无经验/.test(normalized)) return 0;
  const match = normalized.match(/(\d+)(?:\s*[-~到]\s*(\d+))?/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : min;
  return Number.isNaN(max) ? null : max;
}

export function normalizeEducationLevel(value: string): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (/博士/.test(normalized)) return "phd";
  if (/硕士|研究生/.test(normalized)) return "master";
  if (/本科/.test(normalized)) return "bachelor";
  if (/大专|专科/.test(normalized)) return "associate";
  if (/中专|高中|中技/.test(normalized)) return "high_school";
  return null;
}

export function parseSalaryRange(value: string): { min?: number; max?: number; currency?: string; period?: string } | null {
  if (!value) return null;
  const normalized = value.replace(/\s/g, "");
  if (!normalized || /面议/.test(normalized)) return null;
  const match = normalized.match(/(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : undefined;
  if (Number.isNaN(min)) return null;
  const periodMatch = normalized.match(/\/(月|年)/);
  const period = periodMatch ? (periodMatch[1] === "年" ? "year" : "month") : undefined;
  return {
    min,
    max,
    currency: "CNY",
    period,
  };
}

function buildSearchText(item: ResumeItem): string {
  const parts = [
    item.name,
    item.jobIntention,
    item.selfIntro,
    item.education,
    item.location,
    ...(item.workHistory?.map((entry) => entry.raw) ?? []),
  ];
  return parts.join(" ").toLowerCase();
}
