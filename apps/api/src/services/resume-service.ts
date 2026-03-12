import fs from "node:fs";
import path from "node:path";
import { isLocationMatch, normalizeProfileUrlForDisplay, normalizeSharedResumeFields } from "@trends/shared";

import { findProjectRoot } from "./db.js";
import { DataNotFoundError, FileParseError } from "./errors.js";
import { IndustryDataService } from "./industry-data-service.js";
import { parseSearchQuery } from "./query-parser.js";
import { resolveResumeId } from "./resume-id.js";
import { ResumeIndexService } from "./resume-index.js";
import { SkillsKnowledgeService } from "./skills-knowledge.js";
import { UnifiedSearchService, type UnifiedKeywordExpansion } from "./unified-search-service.js";

import type {
  ResumeDigitalIdentity,
  ResumeIndustry,
  ResumeItem,
  ResumeLanguageDetail,
  ResumeLicenceDetail,
  ResumeProfileEducationItem,
  ResumeRightToWork,
  ResumeSampleFile,
  ResumeSkillDetail,
  ResumeSnippet,
  ResumeWorkHistoryItem,
} from "../types/resume.js";
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchText(item: ResumeItem): string {
  const parts = [
    item.name,
    item.jobIntention,
    item.selfIntro,
    item.education,
    item.expectedSalary,
    ...(item.workHistory?.map((entry) => entry.raw) ?? []),
  ];
  return parts.join(" ").toLowerCase();
}

function extractCompanyName(raw: string): string {
  return raw
    .replace(/^[\d\-~至今年月日()（）.\s]+/, "")
    .replace(/[\s,，。;；]+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeResumeItem(item: unknown): ResumeItem {
  const record = isRecord(item) ? item : {};

  const resumeId = toStringValue(record.resumeId);
  const perUserId = toStringValue(record.perUserId);
  const profileId = toStringValue(record.profileId);
  const externalId = toStringValue(record.externalId);

  return {
    name: toStringValue(record.name),
    activityStatus: toStringValue(record.activityStatus),
    age: toStringValue(record.age),
    experience: toStringValue(record.experience),
    education: toStringValue(record.education),
    location: toStringValue(record.location),
    selfIntro: toStringValue(record.selfIntro),
    jobIntention: toStringValue(record.jobIntention),
    expectedSalary: toStringValue(record.expectedSalary),
    extractedAt: toStringValue(record.extractedAt),
    ...normalizeSharedResumeFields(record, "hr.job5156.com"),
    resumeId: resumeId || undefined,
    perUserId: perUserId || undefined,
    profileId: profileId || undefined,
    profileType: toStringValue(record.profileType) || undefined,
    externalId: externalId || undefined,
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
  private readonly industryService: IndustryDataService;
  private readonly skillsService: SkillsKnowledgeService;
  private readonly unifiedSearchService: UnifiedSearchService;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    this.indexService = new ResumeIndexService(this.projectRoot);
    this.industryService = new IndustryDataService(this.projectRoot);
    this.skillsService = new SkillsKnowledgeService(this.projectRoot);
    this.unifiedSearchService = new UnifiedSearchService(this.skillsService);
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

  searchResumes(
    items: ResumeItem[],
    query?: string,
    indexMap?: Map<string, ResumeIndex>,
    ruleScoreMap?: Map<string, number>
  ): Array<ResumeItem & { relevanceScore: number }> {
    if (!query || !query.trim()) {
      return items.map(item => ({ ...item, relevanceScore: 0 }));
    }

    const parsedQuery = parseSearchQuery(query.trim());
    if (parsedQuery.keywords.length === 0) {
      return items.map(item => ({ ...item, relevanceScore: 0 }));
    }

    const keywordSets = parsedQuery.keywords.map((keyword) => {
      const expanded = this.unifiedSearchService.expandKeyword(keyword).flatTerms;
      const variants = Array.from(
        new Set(
          [keyword, ...expanded]
            .map((item) => item.trim().toLowerCase())
            .filter((item) => item.length >= 2)
        )
      );

      return {
        original: keyword,
        variants: variants.length > 0 ? variants : [keyword],
      };
    });

    const results: Array<ResumeItem & { relevanceScore: number }> = [];
    const industryLookup = this.industryService.getCompanyLookup();

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const resumeId = resolveResumeId(item, i);
      const index = indexMap?.get(resumeId);

      const name = (item.name || "").toLowerCase();
      const jobIntention = (item.jobIntention || "").toLowerCase();
      const searchText = index?.searchText || buildSearchText(item);
      const companies = index?.companies ?? (item.workHistory?.map(wh => extractCompanyName(wh.raw)) || []);

      const perKeywordScores = keywordSets.map(({ original, variants }) => {
        let score = 0;

        // 1. Exact Name Match (Highest priority, original keyword only)
        if (name === original) {
          score += 100;
        } else if (name.includes(original)) {
          score += 50;
        }

        // 2. Industry Company Match
        const hasIndustryCompanyMatch = companies.some((company) => {
          const normalizedCompany = company.toLowerCase().trim();
          if (!normalizedCompany || !industryLookup.has(normalizedCompany)) {
            return false;
          }
          return variants.some((variant) => normalizedCompany.includes(variant));
        });
        if (hasIndustryCompanyMatch) {
          score += 100;
        }

        // 3. Job Intention Match
        const intentionMatches = variants.filter((variant) => jobIntention.includes(variant));
        if (intentionMatches.length > 0) {
          score += 30;
          // Bonus for start of intention
          if (intentionMatches.some((variant) => jobIntention.startsWith(variant))) {
            score += 20;
          }
        }

        // 4. Skills Match (from index if available)
        if (index) {
          const matchedSkills = index.skills.filter((skill) =>
            variants.some((variant) => skill.includes(variant))
          );
          score += matchedSkills.length * 10;
        }

        // 5. Full Text Search (Expanded recall)
        let hasTextMatch = false;
        let occurrences = 0;
        for (const variant of variants) {
          if (!searchText.includes(variant)) {
            continue;
          }

          hasTextMatch = true;
          occurrences += (searchText.match(new RegExp(escapeRegex(variant), "g")) || []).length;
        }
        if (hasTextMatch) {
          score += 10;
          score += Math.min(occurrences, 5) * 2;
        }

        return {
          keyword: original,
          score,
          matched: score > 0,
        };
      });

      const matchedCount = perKeywordScores.filter((entry) => entry.matched).length;
      const isAndMode = parsedQuery.mode === "AND";
      if (isAndMode && matchedCount < keywordSets.length) {
        continue;
      }
      if (!isAndMode && matchedCount === 0) {
        continue;
      }

      const totalScore = perKeywordScores.reduce((sum, entry) => sum + entry.score, 0);
      const adHocScore = Math.round(totalScore / keywordSets.length);
      const ruleScore = ruleScoreMap?.get(resumeId);
      const relevanceScore = typeof ruleScore === "number"
        ? Math.round((adHocScore * 0.4) + (ruleScore * 0.6))
        : adHocScore;

      if (relevanceScore > 0) {
        results.push({
          ...item,
          relevanceScore,
        });
      }
    }

    return results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  expandSearchQuery(query?: string): UnifiedKeywordExpansion | undefined {
    if (!query || !query.trim()) {
      return undefined;
    }
    return this.unifiedSearchService.expandKeyword(query);
  }

  filterResumes<T extends ResumeItem>(items: T[], filters?: ResumeFilters): T[] {
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
        const hasLocation = filters.locations.some((target) => isLocationMatch(location, target));
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
