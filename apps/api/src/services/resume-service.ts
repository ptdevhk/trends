import fs from "node:fs";
import path from "node:path";
import {
  buildWorkHistoryEntryText,
  formatLocationHierarchySearchText,
  isLocationMatch,
  normalizeEducationLevel,
  normalizeKeywordPhrases,
  normalizeProfileUrlForDisplay,
  normalizeSharedResumeFields,
  parseExperienceYears,
  parseSalaryRange,
  selectLatestWorkHistory,
} from "@trends/shared";

import { findProjectRoot } from "./db.js";
import { DataNotFoundError, FileParseError } from "./errors.js";
import { IndustryDataService } from "./industry-data-service.js";
import { parseSearchQuery } from "./query-parser.js";
import { resolveResumeId } from "./resume-id.js";
import { ResumeIndexService } from "./resume-index.js";
import { extractCompanyFromWorkHistory } from "./work-history.js";
import { SkillsKnowledgeService } from "./skills-knowledge.js";
import { UnifiedSearchService, type UnifiedKeywordExpansion } from "./unified-search-service.js";

import type {
  ResumeIngestBrandHit,
  ResumeIngestData,
  ResumeIngestMatchedWorkEntry,
  ResumeIngestRoleSignal,
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
  requiredKeywords?: string[];
  locations?: string[];
  minSalary?: number;
  maxSalary?: number;
  minRoleYears?: number;
  roleFilterType?: string;
  minAge?: number;
  maxAge?: number;
  sources?: string[];
};

type ResumeMetadata = {
  sourceUrl?: string;
  sourceHost?: string;
  sourceKey?: string;
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

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toStringValue(item)).filter(Boolean);
}

function normalizeIngestBrandHits(value: unknown): ResumeIngestBrandHit[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const brandHits = value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const brand = toStringValue(item.brand);
      const role = toStringValue(item.role);
      const source = toStringValue(item.source);
      const context = toStringValue(item.context);
      const companyId = toOptionalNumber(item.companyId);

      if (!brand || !role || !source || !context) {
        return null;
      }

      return {
        brand,
        role,
        source,
        context,
        ...(companyId === undefined ? {} : { companyId }),
      } satisfies ResumeIngestBrandHit;
    })
    .filter((item): item is ResumeIngestBrandHit => item !== null);

  return brandHits.length > 0 ? brandHits : undefined;
}

function normalizeMatchedWorkEntries(value: unknown): ResumeIngestMatchedWorkEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const matchedWorkEntries = value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const years = toOptionalNumber(item.years);
      if (years === undefined) {
        return null;
      }

      const companyName = toStringValue(item.companyName) || undefined;
      const jobTitle = toStringValue(item.jobTitle) || undefined;
      const directRoleMatch = typeof item.directRoleMatch === "boolean" ? item.directRoleMatch : undefined;

      return {
        ...(companyName ? { companyName } : {}),
        ...(jobTitle ? { jobTitle } : {}),
        years,
        industryVerified: item.industryVerified === true,
        matchedSignals: toStringArray(item.matchedSignals),
        ...(directRoleMatch === undefined ? {} : { directRoleMatch }),
      } satisfies ResumeIngestMatchedWorkEntry;
    })
    .filter((item): item is ResumeIngestMatchedWorkEntry => item !== null);

  return matchedWorkEntries.length > 0 ? matchedWorkEntries : undefined;
}

function normalizeRoleSignals(value: unknown): ResumeIngestRoleSignal[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const roleSignals = value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const type = toStringValue(item.type);
      const years = toOptionalNumber(item.years);
      if (!type || years === undefined) {
        return null;
      }

      const matchedSignals = toStringArray(item.matchedSignals);
      const signalCount = toOptionalNumber(item.signalCount) ?? matchedSignals.length;
      const occurrences = toOptionalNumber(item.occurrences) ?? matchedSignals.length;
      const industryVerifiedYears = toOptionalNumber(item.industryVerifiedYears);
      const roleRelevantYears = toOptionalNumber(item.roleRelevantYears);
      const industryVerifiedRelevantYears = toOptionalNumber(item.industryVerifiedRelevantYears);
      const matchedWorkEntries = normalizeMatchedWorkEntries(item.matchedWorkEntries);
      const verifyIn = toStringValue(item.verifyIn) || "workHistory";

      return {
        type,
        matchedSignals,
        signalCount,
        occurrences,
        years,
        ...(industryVerifiedYears === undefined ? {} : { industryVerifiedYears }),
        ...(roleRelevantYears === undefined ? {} : { roleRelevantYears }),
        ...(industryVerifiedRelevantYears === undefined ? {} : { industryVerifiedRelevantYears }),
        ...(matchedWorkEntries ? { matchedWorkEntries } : {}),
        verifyIn,
      } satisfies ResumeIngestRoleSignal;
    })
    .filter((item): item is ResumeIngestRoleSignal => item !== null);

  return roleSignals.length > 0 ? roleSignals : undefined;
}

function normalizeIngestData(value: unknown): ResumeIngestData | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const industryTags = toStringArray(value.industryTags);
  const brandHits = normalizeIngestBrandHits(value.brandHits);
  const companyHits = toStringArray(value.companyHits);
  const roleSignals = normalizeRoleSignals(value.roleSignals);

  if (
    industryTags.length === 0
    && brandHits === undefined
    && companyHits.length === 0
    && roleSignals === undefined
  ) {
    return undefined;
  }

  return {
    ...(industryTags.length > 0 ? { industryTags } : {}),
    ...(brandHits ? { brandHits } : {}),
    ...(companyHits.length > 0 ? { companyHits } : {}),
    ...(roleSignals ? { roleSignals } : {}),
    ...(isRecord(value.ruleScores) && Object.keys(value.ruleScores).length > 0 ? { ruleScores: value.ruleScores as Record<string, number> } : {}),
    ...(typeof value.market === 'string' && value.market ? { market: value.market } : {}),
  };
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;

  let count = 0;
  let startIndex = 0;

  while (startIndex < haystack.length) {
    const matchIndex = haystack.indexOf(needle, startIndex);
    if (matchIndex === -1) {
      return count;
    }
    count += 1;
    startIndex = matchIndex + needle.length;
  }

  return count;
}

function buildSearchText(item: ResumeItem): string {
  const locationText = formatLocationHierarchySearchText(item.locationHierarchy) || item.location || "";
  const latestWorkHistory = selectLatestWorkHistory(item.workHistory);
  const latestProjectExperience = selectLatestWorkHistory(item.projectExperience ?? []);
  const parts = [
    item.name,
    item.education,
    locationText,
    item.expectedSalary,
    ...latestWorkHistory.map((entry) => buildWorkHistoryEntryText(entry)),
    ...latestProjectExperience.map((entry) => buildWorkHistoryEntryText(entry)),
  ];
  return parts.join(" ").toLowerCase();
}

function matchesAllRequiredKeywords(text: string, requiredKeywords: string[] | undefined): boolean {
  const normalizedKeywords = normalizeKeywordPhrases(requiredKeywords ?? []).map((keyword) => keyword.toLowerCase());
  if (normalizedKeywords.length === 0) {
    return true;
  }

  const haystack = text.trim().toLowerCase();
  if (!haystack) {
    return false;
  }

  return normalizedKeywords.every((keyword) => haystack.includes(keyword));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function inferResumeSource(metadata?: ResumeMetadata): string | undefined {
  const sourceHost = toStringValue(metadata?.sourceHost).toLowerCase();
  if (sourceHost) {
    return sourceHost;
  }

  const sourceUrl = toStringValue(metadata?.sourceUrl);
  if (sourceUrl) {
    try {
      return new URL(sourceUrl).hostname.toLowerCase();
    } catch {
      // ignore
    }
  }

  const sourceKey = toStringValue(metadata?.sourceKey).toLowerCase();
  if (sourceKey === "job5156") {
    return "hr.job5156.com";
  }
  if (sourceKey === "seek") {
    return "seek";
  }
  if (sourceKey === "51job") {
    return "ehire.51job.com";
  }

  return undefined;
}

function normalizeResumeItem(item: unknown, source?: string): ResumeItem {
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
    ingestData: normalizeIngestData(record.ingestData),
    extractedAt: toStringValue(record.extractedAt),
    ...normalizeSharedResumeFields(record, source),
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

  const metadata = !Array.isArray(payload) && payload ? payload.metadata : undefined;
  const source = inferResumeSource(metadata);
  return list.map((item) => normalizeResumeItem(item, source));
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
      const searchText = index?.searchText || buildSearchText(item);
      const companies = index?.companies ?? selectLatestWorkHistory(item.workHistory).map((wh) => extractCompanyFromWorkHistory(wh));

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

        // 3. Skills Match (from index if available)
        if (index) {
          const matchedSkills = index.skills.filter((skill) =>
            variants.some((variant) => skill.includes(variant))
          );
          score += matchedSkills.length * 10;
        }

        // 4. Full Text Search (Expanded recall)
        let hasTextMatch = false;
        let occurrences = 0;
        for (const variant of variants) {
          if (!searchText.includes(variant)) {
            continue;
          }

          hasTextMatch = true;
          occurrences += countOccurrences(searchText, variant);
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
    const effectiveMinExperience = (filters.minExperience ?? 0) > 0 ? filters.minExperience : undefined;

    return items.filter((item) => {
      if (effectiveMinExperience !== undefined || filters.maxExperience !== undefined) {
        const experience = parseExperienceYears(item.experience);
        if (experience === null) {
          // Unknown experience — exclude if maxExperience is set (cannot guarantee cap),
          // but skip minExperience (resume might meet the minimum).
          if (filters.maxExperience !== undefined) return false;
        } else {
          if (effectiveMinExperience !== undefined && experience < effectiveMinExperience) return false;
          if (filters.maxExperience !== undefined && experience > filters.maxExperience) return false;
        }
      }

      if (filters.education?.length) {
        const level = normalizeEducationLevel(item.education);
        if (!level || !filters.education.includes(level)) return false;
      }

      if (filters.locations?.length) {
        const location = formatLocationHierarchySearchText(item.locationHierarchy) || item.location || "";
        const hasLocation = filters.locations.some((target) => isLocationMatch(location, target));
        if (!hasLocation) return false;
      }

      if (filters.skills?.length) {
        // Use full searchText (includes all workHistory, industryTags, synonyms, etc.)
        // rather than narrow buildSearchText (only latest workHistory). Aligns with
        // Convex matchesResumeListFilters and BFF bffMatchesResumeFilters.
        const haystack = item.searchText?.toLowerCase() ?? buildSearchText(item);
        const hasSkill = filters.skills.some((skill) => haystack.includes(skill.toLowerCase()));
        if (!hasSkill) return false;
      }

      if (filters.requiredKeywords?.length) {
        const haystack = item.searchText?.toLowerCase() ?? buildSearchText(item);
        if (!matchesAllRequiredKeywords(haystack, filters.requiredKeywords)) return false;
      }

      if (filters.minSalary !== undefined || filters.maxSalary !== undefined) {
        const salary = parseSalaryRange(item.expectedSalary);
        if (!salary) {
          // Unknown salary — exclude if maxSalary is set (cannot guarantee cap),
          // but skip minSalary (resume might meet the minimum).
          if (filters.maxSalary !== undefined) return false;
        } else {
          if (filters.minSalary !== undefined) {
            const maxSalary = salary.max ?? salary.min;
            if (maxSalary !== undefined && maxSalary < filters.minSalary) return false;
          }
          if (filters.maxSalary !== undefined) {
            const minSalary = salary.min ?? salary.max;
            if (minSalary !== undefined && minSalary > filters.maxSalary) return false;
          }
        }
      }

      return true;
    });
  }
}

// Re-export from @trends/shared for backward compatibility
export { normalizeEducationLevel, parseExperienceYears } from "@trends/shared";

export function parseSalaryRangeWithMeta(value: string | undefined): { min?: number; max?: number; currency?: string; period?: string } | null {
  const parsed = parseSalaryRange(value);
  if (!parsed) return null;
  const normalized = value!.replace(/\s/g, "");
  const periodMatch = normalized.match(/\/(月|年)/);
  const period = periodMatch ? (periodMatch[1] === "年" ? "year" : "month") : undefined;
  return {
    min: parsed.min,
    max: parsed.max,
    currency: "CNY",
    period,
  };
}
