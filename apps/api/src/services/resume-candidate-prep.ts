/**
 * Shared resume candidate preparation logic — extracted from
 * routes/resumes.ts and routes/resumes_search.ts to eliminate ~579 lines
 * of duplicated code.  Pure functions and types that both route files
 * use for preparing, filtering, and scoring resume candidates from
 * Convex query results.
 */
import {
  isRecord,
  buildKeywordAnalysisId,
  getCurrentResumeAiPromptVersion,
  resolveResumeAnalysisSourceKey,
  formatLocationHierarchySearchText,
  formatKeywordQuery,
  normalizeKeywordPhrases,
  normalizeWorkHistoryEntry,
  buildWorkHistoryEntryText,
  buildLatestWorkHistoryEvidence,
  selectLatestWorkHistory,
} from "@trends/shared";
import type { ResumeItem } from "../types/resume.js";
import type { ResumeIndex } from "./resume-index.js";
import {
  buildResumeIngestData,
  parseBrandHits,
  parseRoleSignals,
  toOptionalNumber,
  toStringArray,
  toStringValue,
} from "./resume-ingest-utils.js";
import { bffMatchesResumeFilters } from "./bff-filter-utils.js";
import { callConvexQuery, isConvexPaginatedQueryPage } from "./convex-utils.js";
import { ResumeService, type ResumeFilters } from "./resume-service.js";
import type { BrandHit, RoleSignalSummary } from "./rule-scoring.js";
import type { MatchingResult } from "./ai-matching.js";
import type { StoredMatch } from "./match-storage.js";
import { MatchStorage } from "./match-storage.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type ResumeKeywordExpansion = ReturnType<ResumeService["expandSearchQuery"]>;

export type ResumeSearchProvenance = {
  term: string;
  source: "searchText" | "industryTags" | "companyHits" | "synonymHits";
  expandedFrom?: string;
};

export type PreparedResumeCandidate = {
  resume: ResumeItem;
  resumeId: string;
  indexData: ResumeIndex;
  primaryRuleScore?: number;
  provenance?: ResumeSearchProvenance[];
  brandHits: BrandHit[];
  companyHits: string[];
  roleSignals: RoleSignalSummary[];
};

export type ResumeMatchContext = {
  score: number;
  recommendation: MatchingResult["recommendation"];
};

export type ResumeMatchContextEntry = ResumeMatchContext & {
  resumeId: string;
};

export type ExactKeywordScanCandidate = {
  candidate: PreparedResumeCandidate;
  identityKey: string;
  crawledAt: number;
  jobRuleScore: number;
  primaryRuleScore: number;
  provenance: ResumeSearchProvenance[];
};

export type SortableKeywordMatchEntry = {
  candidate: PreparedResumeCandidate;
  match: ResumeMatchContext | undefined;
  sortMetadata?: ExactKeywordScanCandidate;
};

// ---------------------------------------------------------------------------
// Constants (duplicated across route files)
// ---------------------------------------------------------------------------

export const MAX_SAFE_CONVEX_POST_FILTER_LIMIT = 2000;
export const MATCH_STORAGE_FILTER_SCAN_BATCH_SIZE = 250;

// ---------------------------------------------------------------------------
// Pure helpers (no service dependencies)
// ---------------------------------------------------------------------------

export function normalizeKeywords(keywords: string[] | undefined): string[] {
  if (!Array.isArray(keywords)) return [];
  return normalizeKeywordPhrases(keywords).map((item) => item.toLowerCase());
}

export function sourceMappingEntries(mapping: Record<string, string> | undefined): Array<{ term: string; expandedFrom: string }> {
  return Object.entries(mapping ?? {}).map(([term, expandedFrom]) => ({ term, expandedFrom }));
}

export function parseConvexProvenance(value: unknown): ResumeSearchProvenance[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const provenance = value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const term = toStringValue(item.term);
    const source: ResumeSearchProvenance["source"] | null = item.source === "searchText"
      || item.source === "industryTags"
      || item.source === "companyHits"
      || item.source === "synonymHits"
      ? item.source
      : null;
    const expandedFrom = toStringValue(item.expandedFrom) || undefined;
    if (!term || !source) {
      return [];
    }
    return [{ term, source, ...(expandedFrom ? { expandedFrom } : {}) }];
  });

  return provenance.length > 0 ? provenance : undefined;
}

export function collectBffAndModeProvenance(
  searchText: string,
  groups: Array<{ original: string; variants: string[] }>,
  sourceMapping: Record<string, string>,
): ResumeSearchProvenance[] {
  const provenance: ResumeSearchProvenance[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const variant of group.variants) {
      const normalized = variant.toLowerCase();
      if (searchText.includes(normalized) && !seen.has(normalized)) {
        seen.add(normalized);
        provenance.push({
          term: variant,
          source: "searchText",
          expandedFrom: sourceMapping[variant],
        });
      }
    }
  }
  return provenance;
}

export function normalizeMatchRecommendations(
  values: string[] | undefined
): MatchingResult["recommendation"][] | undefined {
  if (!values?.length) {
    return undefined;
  }

  const allowed = new Set<MatchingResult["recommendation"]>([
    "strong_match",
    "match",
    "potential",
    "no_match",
  ]);
  const normalized = Array.from(
    new Set(values.map((value) => value.trim()).filter((value): value is MatchingResult["recommendation"] => allowed.has(value as MatchingResult["recommendation"])))
  );
  return normalized.length > 0 ? normalized : undefined;
}

export function hasResumeListFilters(params: {
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
  showArchived?: boolean;
}): boolean {
  return typeof params.minExperience === "number"
    || typeof params.maxExperience === "number"
    || (params.education?.length ?? 0) > 0
    || (params.skills?.length ?? 0) > 0
    || (params.requiredKeywords?.length ?? 0) > 0
    || (params.locations?.length ?? 0) > 0
    || typeof params.minSalary === "number"
    || typeof params.maxSalary === "number"
    || typeof params.minRoleYears === "number"
    || typeof params.roleFilterType === "string"
    || typeof params.minAge === "number"
    || typeof params.maxAge === "number"
    || (params.sources?.length ?? 0) > 0;
}

export function resolveResumeSortOrder(
  sortBy: "score" | "name" | "experience" | "extractedAt" | undefined,
  sortOrder: "asc" | "desc" | undefined
): "asc" | "desc" | undefined {
  if (!sortBy || sortBy === "score") {
    return sortOrder;
  }
  return sortOrder || "asc";
}

// ---------------------------------------------------------------------------
// Resume record conversion helpers
// ---------------------------------------------------------------------------

function stripFrontMatter(content: string): string {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return content;
  const endIndex = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (endIndex === -1) return content;
  return lines.slice(endIndex + 2).join("\n");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSection(content: string, headings: string[]): string | undefined {
  const lines = stripFrontMatter(content).split("\n");
  let startIndex = -1;
  let endIndex = lines.length;
  const headingRegex = new RegExp(
    `^##\\s+(${headings.map((h) => escapeRegex(h)).join("|")})\\s*$`,
    "i"
  );

  for (let i = 0; i < lines.length; i += 1) {
    if (headingRegex.test(lines[i].trim())) {
      startIndex = i + 1;
      for (let j = startIndex; j < lines.length; j += 1) {
        if (/^##\s+/.test(lines[j].trim())) {
          endIndex = j;
          break;
        }
      }
      break;
    }
  }

  if (startIndex === -1) return undefined;
  return lines.slice(startIndex, endIndex).join("\n").trim();
}

function extractSkills(...texts: (string | undefined)[]): string[] | undefined {
  const allParts: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    const parts = text
      .split(/[，,、/\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    allParts.push(...parts);
  }
  if (allParts.length === 0) return undefined;
  return Array.from(new Set(allParts)).slice(0, 20);
}

function getLatestWorkHistory(workHistory: ResumeItem["workHistory"] | undefined): ResumeItem["workHistory"] {
  return selectLatestWorkHistory(workHistory ?? []);
}

function extractCompanies(workHistory: ResumeItem["workHistory"]): string[] | undefined {
  if (!workHistory?.length) return undefined;
  const entries = workHistory
    .map((item) => {
      const normalized = normalizeWorkHistoryEntry(item);
      return normalized?.companyName || buildWorkHistoryEntryText(item);
    })
    .filter(Boolean)
    .map((raw) => raw.replace(/^\d[\d\-~至今()年月日\s]*?/g, "").trim())
    .filter(Boolean);
  if (entries.length === 0) return undefined;
  return Array.from(new Set(entries)).slice(0, 8);
}

export function toResumeItemFromRecord(record: Record<string, unknown>, source?: string): ResumeItem {
  const profileUrl = toStringValue(
    record.profileUrl ?? record.profile_url ?? record.profileURL ?? record.url
  );
  const workHistory = Array.isArray(record.workHistory)
    ? record.workHistory
      .map((entry) => normalizeWorkHistoryEntry(entry))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : [];
  const projectExperience = Array.isArray(record.projectExperience)
    ? record.projectExperience
      .map((entry) => normalizeWorkHistoryEntry(entry))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : [];
  const profileEducation = Array.isArray(record.profileEducation)
    ? record.profileEducation
      .map((entry) => {
        if (!isRecord(entry)) {
          return null;
        }

        const institution = toStringValue(entry.institution) || undefined;
        const qualification = toStringValue(entry.qualification) || undefined;
        const fieldOfStudy = toStringValue(entry.fieldOfStudy) || undefined;
        const description = toStringValue(entry.description) || undefined;
        const startDate = toStringValue(entry.startDate) || undefined;
        const endDate = toStringValue(entry.endDate) || undefined;

        if (
          !institution
          && !qualification
          && !fieldOfStudy
          && !description
          && !startDate
          && !endDate
        ) {
          return null;
        }

        return {
          ...(institution ? { institution } : {}),
          ...(qualification ? { qualification } : {}),
          ...(fieldOfStudy ? { fieldOfStudy } : {}),
          ...(description ? { description } : {}),
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : [];

  return {
    name: toStringValue(record.name),
    profileUrl,
    ...(toStringValue(record.source) || source ? { source: toStringValue(record.source) || source } : {}),
    activityStatus: toStringValue(record.activityStatus),
    age: toStringValue(record.age),
    experience: toStringValue(record.experience),
    education: toStringValue(record.education),
    location: toStringValue(record.location),
    selfIntro: toStringValue(record.selfIntro),
    jobIntention: toStringValue(record.jobIntention),
    expectedSalary: toStringValue(record.expectedSalary),
    workHistory,
    ...(projectExperience.length > 0 ? { projectExperience } : {}),
    ...(profileEducation.length > 0 ? { profileEducation } : {}),
    extractedAt: toStringValue(record.extractedAt),
    ingestData: buildResumeIngestData(record.ingestData),
    resumeId: toStringValue(record.resumeId) || undefined,
    perUserId: toStringValue(record.perUserId) || undefined,
    profileId: toStringValue(record.profileId) || undefined,
    profileType: toStringValue(record.profileType) || (source ? source : undefined),
    externalId: toStringValue(record.externalId) || undefined,
    ...(typeof record.searchText === 'string' ? { searchText: record.searchText } : {}),
  };
}

// ---------------------------------------------------------------------------
// Candidate preparation
// ---------------------------------------------------------------------------

function createFallbackIndex(resume: ResumeItem, resumeId: string): ResumeIndex {
  const latestWorkHistory = getLatestWorkHistory(resume.workHistory);
  const locationText = formatLocationHierarchySearchText(resume.locationHierarchy) || resume.location || "";
  const text = [
    resume.name,
    locationText,
    resume.education,
    ...latestWorkHistory.map((item) => buildWorkHistoryEntryText(item)),
  ].join(" ").toLowerCase();

  return {
    resumeId,
    experienceYears: null,
    educationLevel: resume.education || null,
    locationCity: resume.locationHierarchy?.city
      || resume.locationHierarchy?.province
      || resume.locationHierarchy?.country
      || resume.location
      || null,
    skills: [],
    companies: extractCompanies(latestWorkHistory) ?? [],
    industryTags: [],
    salaryRange: null,
    searchText: text,
    evidenceText: buildLatestWorkHistoryEvidence(latestWorkHistory).text,
  };
}

export function prepareResumeCandidate(params: {
  resume: ResumeItem;
  resumeId: string;
  indexData?: ResumeIndex;
  primaryRuleScore?: number;
  provenance?: ResumeSearchProvenance[];
  ingestData?: unknown;
}): PreparedResumeCandidate {
  const rawIngestData = params.ingestData ?? params.resume.ingestData;
  const parsedIngestData = params.resume.ingestData ?? buildResumeIngestData(params.ingestData);
  const baseResume = params.resume.resumeId
    ? params.resume
    : {
        ...params.resume,
        resumeId: params.resumeId,
      };
  const resume = parsedIngestData
    ? {
        ...baseResume,
        ingestData: parsedIngestData,
      }
    : baseResume;
  return {
    resume,
    resumeId: params.resumeId,
    indexData: params.indexData ?? createFallbackIndex(resume, params.resumeId),
    primaryRuleScore: params.primaryRuleScore,
    provenance: params.provenance,
    brandHits: parseBrandHits(isRecord(rawIngestData) ? rawIngestData.brandHits : undefined),
    companyHits: toStringArray(isRecord(rawIngestData) ? rawIngestData.companyHits : undefined),
    roleSignals: parseRoleSignals(isRecord(rawIngestData) ? rawIngestData.roleSignals : undefined),
  };
}

// ---------------------------------------------------------------------------
// prepareConvexCandidates — the large duplicated function
// ---------------------------------------------------------------------------

export async function prepareConvexCandidates(params: {
  resumeIds?: string[];
  keywords?: string[];
  keywordQuery?: string;
  location?: string;
  limit?: number;
  offset?: number;
  sortBy?: "name" | "experience" | "extractedAt";
  sortOrder?: "asc" | "desc";
  filters?: {
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
    showArchived?: boolean;
  };
  jobDescriptionId?: string;
  paged?: boolean;
  resumeService: ResumeService;
}): Promise<{
  prepared: PreparedResumeCandidate[];
  keywordExpansion?: ResumeKeywordExpansion;
  total?: number;
  usedServerSideFilters?: boolean;
}> {
  const resumeIds = Array.from(new Set((params.resumeIds ?? []).map((resumeId) => resumeId.trim()).filter(Boolean)));
  if (resumeIds.length > 0) {
    const value = await callConvexQuery("resumes:getByIdsForExport", { resumeIds });
    if (!Array.isArray(value)) {
      throw new Error("Invalid resume response from Convex");
    }

    const byId = new Map<string, PreparedResumeCandidate>();
    value.forEach((item) => {
      if (!isRecord(item)) {
        return;
      }
      const resumeId = toStringValue(item.resumeId);
      const resumeRecord = isRecord(item.resume) ? item.resume : null;
      if (!resumeId || !resumeRecord) {
        return;
      }
      const resume = toResumeItemFromRecord(resumeRecord);
      byId.set(resumeId, prepareResumeCandidate({
        resume,
        resumeId,
        ingestData: resumeRecord.ingestData,
      }));
    });

    const prepared = resumeIds
      .map((resumeId) => byId.get(resumeId))
      .filter((item): item is PreparedResumeCandidate => Boolean(item));
    const limited = typeof params.limit === "number" ? prepared.slice(0, params.limit) : prepared;
    return { prepared: limited };
  }

  const normalizedKeywords = normalizeKeywords(params.keywords);
  const keywordQuery = params.keywordQuery?.trim() || undefined;
  if (normalizedKeywords.length > 0 || keywordQuery) {
    const canonicalKeywordQuery = keywordQuery ?? formatKeywordQuery(normalizedKeywords);
    const keywordExpansion = params.resumeService.expandSearchQuery(canonicalKeywordQuery);

    // AND-mode full-table-scan search: when the keyword expansion yields AND mode,
    // paginate ALL resumes from Convex and filter in-memory.  This avoids two
    // Convex platform limits that the search-index approaches hit:
    //   1. Search index returns at most 1024 results per query (BM25-ranked).
    //      Resumes with long searchText (6KB+ from AI analysis / synonyms) score
    //      low and fall beyond the 1024-position cutoff, making them invisible.
    //   2. Convex action memory limit (64 MB) prevents full-table scan inside
    //      a Convex action.  BFF (Node.js) has no such limit.
    if (keywordExpansion?.mode === "AND") {
      const allResults: PreparedResumeCandidate[] = [];
      let scanCursor: string | null = null;
      const groups = keywordExpansion.groups;
      const filters = params.filters;
      const loweredGroups = groups.map((g) => ({
        ...g,
        loweredVariants: g.variants.map((v: string) => v.toLowerCase()),
      }));

      // Phase 1: Scan digest pages (lightweight, <1KB per row) for candidate
      // discovery. Digest rows are pre-built from resume fields at ingest and
      // backfill time, so the Convex query avoids the monolithic ~27KB searchText
      // transfer that dominated the old scanResumePageSlim path.
      const matchingIds: string[] = [];
      while (true) {
        const page = await callConvexQuery("resumes_search:scanResumeDigestPage", {
          ...(scanCursor ? { cursor: scanCursor } : {}),
          numItems: 1000,
        });

        if (!isRecord(page) || !Array.isArray(page.docs)) {
          break;
        }

        for (const doc of page.docs) {
          if (!isRecord(doc)) continue;
          const searchText = typeof doc.searchText === "string" ? doc.searchText.toLowerCase() : "";
          const allGroupsMatch = loweredGroups.every((group) =>
            group.loweredVariants.some((lv: string) => searchText.includes(lv))
          );
          if (!allGroupsMatch) continue;

          // Basic filters that run on digest fields
          if (filters) {
            if (typeof filters.minAge === 'number' && typeof doc.age === 'number' && doc.age < filters.minAge) continue;
            if (typeof filters.maxAge === 'number' && typeof doc.age === 'number' && doc.age > filters.maxAge) continue;
            if (Array.isArray(filters.sources) && filters.sources.length > 0) {
              const resumeSourceKey = (typeof doc.sourceKey === 'string' ? doc.sourceKey : undefined)
                ?? resolveResumeAnalysisSourceKey({ source: typeof doc.source === 'string' ? doc.source : undefined });
              if (!resumeSourceKey || !filters.sources.includes(resumeSourceKey)) continue;
            }
          }

          const resumeId = toStringValue(doc.resumeId);
          if (resumeId) matchingIds.push(resumeId);
        }

        if (!page.cursor || page.isDone) break;
        scanCursor = toStringValue(page.cursor) ?? null;
      }

      // Phase 2: Fetch full docs only for matches, then apply remaining filters.
      const BATCH_SIZE = 100;
      for (let i = 0; i < matchingIds.length; i += BATCH_SIZE) {
        const batchIds = matchingIds.slice(i, i + BATCH_SIZE);
        const fullDocs = await callConvexQuery("resumes_search:getResumeDocsByIds", {
          ids: batchIds,
        });

        if (!isRecord(fullDocs) || !Array.isArray(fullDocs)) continue;

        for (const doc of fullDocs) {
          if (!isRecord(doc)) continue;
          const resumeId = toStringValue(doc._id);
          if (!resumeId) continue;

          const searchText = typeof doc.searchText === "string" ? doc.searchText.toLowerCase() : "";

          // Apply remaining filters that need full docs (role, education, etc.)
          if (filters && !bffMatchesResumeFilters(doc, searchText, filters)) continue;

          const provenance = collectBffAndModeProvenance(searchText, groups, keywordExpansion.sourceMapping);
          const resume = toResumeItemFromRecord(isRecord(doc.content) ? doc.content : {}, toStringValue(doc.source));
          // Override resumeId with Convex _id so the frontend can use it
          // for Convex mutations (dispatch analysis, etc.). Content's
          // resumeId is a source-specific ID (e.g., "13467969") that
          // doesn't match v.id("resumes").
          resume.resumeId = resumeId;
          // Propagate Convex doc-level fields that the frontend's mapResumeDoc
          // reads from the doc (not from content). Without these, analysis
          // scores never appear on AND-mode search results.
          if (doc.analysis !== undefined && doc.analysis !== null) {
            (resume as Record<string, unknown>).analysis = doc.analysis;
          }
          if (doc.analyses !== undefined && doc.analyses !== null) {
            (resume as Record<string, unknown>).analyses = doc.analyses;
          }
          if (typeof doc.identityKey === "string") {
            (resume as Record<string, unknown>).identityKey = doc.identityKey;
          }
          if (typeof doc.crawledAt === "number") {
            (resume as Record<string, unknown>).crawledAt = doc.crawledAt;
          }
          if (Array.isArray(doc.tags)) {
            (resume as Record<string, unknown>).tags = doc.tags;
          }
          if (typeof doc.searchText === "string") {
            resume.searchText = doc.searchText;
          }
          allResults.push(prepareResumeCandidate({
            resume,
            resumeId,
            primaryRuleScore: toOptionalNumber(doc.primaryRuleScore),
            provenance,
            ingestData: doc.ingestData,
          }));
        }
      }

      const hasActiveFilters = filters ? hasResumeListFilters(filters) : false;
      return {
        prepared: allResults,
        keywordExpansion,
        total: allResults.length,
        usedServerSideFilters: hasActiveFilters,
      };
    }

    // OR-mode or mode-less with paged/filters: single-pass cursor scan
    const hasActiveFilters = params.filters ? hasResumeListFilters(params.filters) : false;
    const useCursorScan = params.paged || hasActiveFilters;

    if (useCursorScan) {
      const allResults: PreparedResumeCandidate[] = [];
      let cursor: string | null = null;
      let totalScanned = 0;

      while (true) {
        const value = await callConvexQuery("resumes_search:searchWithTagExpansionScanPage", {
          paginationOpts: {
            cursor,
            numItems: MATCH_STORAGE_FILTER_SCAN_BATCH_SIZE,
          },
          query: canonicalKeywordQuery,
          keywordGroups: keywordExpansion?.groups ?? [],
          mode: keywordExpansion?.mode ?? "AND",
          sourceMappings: sourceMappingEntries(keywordExpansion?.sourceMapping),
          ...(params.filters ?? {}),
        });

        if (!isConvexPaginatedQueryPage(value)) {
          throw new Error("Invalid paginated search response from Convex");
        }

        for (const entry of value.page) {
          if (!isRecord(entry) || !isRecord(entry.resume)) {
            continue;
          }
          const resumeRecord = entry.resume;
          const resumeId = toStringValue(resumeRecord._id);
          if (!resumeId) {
            continue;
          }

          const resumeItem = toResumeItemFromRecord(isRecord(resumeRecord.content) ? resumeRecord.content : {}, toStringValue(resumeRecord.source));
          if (typeof resumeRecord.searchText === 'string') {
            resumeItem.searchText = resumeRecord.searchText;
          }
          allResults.push(prepareResumeCandidate({
            resume: resumeItem,
            resumeId,
            primaryRuleScore: toOptionalNumber(resumeRecord.primaryRuleScore),
            provenance: parseConvexProvenance(entry.provenance),
            ingestData: resumeRecord.ingestData,
          }));
        }

        if (value.isDone) {
          break;
        }
        if (!value.continueCursor) {
          break;
        }
        cursor = value.continueCursor;
        totalScanned += value.page?.length ?? 0;
        if (totalScanned >= MAX_SAFE_CONVEX_POST_FILTER_LIMIT) {
          break;
        }
      }

      return {
        prepared: allResults,
        keywordExpansion,
        total: allResults.length,
        usedServerSideFilters: hasActiveFilters,
      };
    }

    // Fallback: non-paged, no-filters path uses the simple search query
    const value = await callConvexQuery("resumes_search:searchWithTagExpansion", {
      query: canonicalKeywordQuery,
      keywordGroups: keywordExpansion?.groups ?? [],
      mode: keywordExpansion?.mode ?? "AND",
      sourceMappings: sourceMappingEntries(keywordExpansion?.sourceMapping),
      limit: params.limit,
      jobDescriptionId: params.jobDescriptionId,
    });

    if (!isRecord(value) || !Array.isArray(value.results)) {
      throw new Error("Invalid resume search response from Convex");
    }

    const prepared = value.results.flatMap((entry) => {
      if (!isRecord(entry) || !isRecord(entry.resume)) {
        return [];
      }
      const resumeRecord = entry.resume;
      const resumeId = toStringValue(resumeRecord._id);
      if (!resumeId) {
        return [];
      }

      const resumeItem = toResumeItemFromRecord(isRecord(resumeRecord.content) ? resumeRecord.content : {}, toStringValue(resumeRecord.source));
      if (typeof resumeRecord.searchText === 'string') {
        resumeItem.searchText = resumeRecord.searchText;
      }
      return [prepareResumeCandidate({
        resume: resumeItem,
        resumeId,
        primaryRuleScore: toOptionalNumber(resumeRecord.primaryRuleScore),
        provenance: parseConvexProvenance(entry.provenance),
        ingestData: resumeRecord.ingestData,
      })];
    });

    return {
      prepared,
      keywordExpansion,
    };
  }

  const value = await callConvexQuery(params.paged ? "resumes:listWithIngestDataPage" : "resumes:listWithIngestData", {
    limit: params.limit,
    ...(params.paged ? { offset: params.offset } : {}),
    ...(params.paged && params.sortBy ? { sortBy: params.sortBy, sortOrder: params.sortOrder } : {}),
    ...(params.paged && params.filters ? params.filters : {}),
    jobDescriptionId: params.jobDescriptionId,
  });
  const items = params.paged && isRecord(value) && Array.isArray(value.results)
    ? value.results
    : value;
  if (!Array.isArray(items)) {
    throw new Error("Invalid resume list response from Convex");
  }

  return {
    prepared: items.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }
      const resumeId = toStringValue(item._id);
      if (!resumeId) {
        return [];
      }
      const resumeItem = toResumeItemFromRecord(isRecord(item.content) ? item.content : {}, toStringValue(item.source));
      if (typeof item.searchText === 'string') {
        resumeItem.searchText = item.searchText;
      }
      return [prepareResumeCandidate({
        resume: resumeItem,
        resumeId,
        primaryRuleScore: toOptionalNumber(item.primaryRuleScore),
        ingestData: item.ingestData,
      })];
    }),
    total: params.paged && isRecord(value) ? (toOptionalNumber(value.total) ?? undefined) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Other shared helpers (previously duplicated across route files)
// ---------------------------------------------------------------------------

export function dedupeResumeSearchProvenance(items: ResumeSearchProvenance[] | undefined): ResumeSearchProvenance[] {
  const deduped: ResumeSearchProvenance[] = [];
  const seen = new Set<string>();

  for (const item of items ?? []) {
    const key = `${item.source}|${item.term}|${item.expandedFrom ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

export function resolveProjectedResumeRuleScore(resumeRecord: Record<string, unknown>, jobDescriptionId: string): number {
  const ingestData = isRecord(resumeRecord.ingestData) ? resumeRecord.ingestData : null;
  const ruleScores = ingestData && isRecord(ingestData.ruleScores) ? ingestData.ruleScores : null;
  return ruleScores ? (toOptionalNumber(ruleScores[jobDescriptionId]) ?? 0) : 0;
}

export function buildKeywordExpansionSummary(expansion: ResumeKeywordExpansion): {
  expandedTo?: string[];
  mode?: "AND" | "OR";
  keywordGroups?: Array<{ original: string; variants: string[] }>;
  sourceMapping?: Record<string, string>;
} {
  return {
    expandedTo: expansion?.flatTerms,
    mode: expansion?.mode,
    keywordGroups: expansion?.groups,
    sourceMapping: expansion?.sourceMapping,
  };
}

export function filterPreparedCandidatesByResumeFilters(
  prepared: PreparedResumeCandidate[],
  filters: ResumeFilters | undefined,
  resumeService: ResumeService,
): PreparedResumeCandidate[] {
  if (!filters) {
    return prepared;
  }

  const allowed = new Set(resumeService.filterResumes(prepared.map((item) => item.resume), filters));
  return prepared.filter((item) => allowed.has(item.resume));
}

export function createResumeMatchContextMap(matches: Array<StoredMatch | ResumeMatchContextEntry>): Map<string, ResumeMatchContext> {
  return new Map(matches.map((match) => [
    match.resumeId,
    {
      score: match.score,
      recommendation: match.recommendation,
    },
  ]));
}

export function loadResumeMatchContextMap(
  matchStorage: MatchStorage,
  jobDescriptionId: string,
  resumeIds: string[],
): Map<string, ResumeMatchContext> {
  const normalizedResumeIds = Array.from(new Set(
    resumeIds.map((resumeId) => resumeId.trim()).filter(Boolean),
  ));
  const matchMap = new Map<string, ResumeMatchContext>();

  for (let index = 0; index < normalizedResumeIds.length; index += MATCH_STORAGE_FILTER_SCAN_BATCH_SIZE) {
    const batchIds = normalizedResumeIds.slice(index, index + MATCH_STORAGE_FILTER_SCAN_BATCH_SIZE);
    const matches = matchStorage.getMatchesByResumeIds(batchIds, jobDescriptionId);
    for (const match of matches) {
      matchMap.set(match.resumeId, {
        score: match.score,
        recommendation: match.recommendation,
      });
    }
  }

  return matchMap;
}

export function buildAiResumePayload(item: {
  resume: ResumeItem;
  resumeId: string;
  indexData: ResumeIndex;
  companyHits: string[];
  roleSignals: PreparedResumeCandidate["roleSignals"];
}): import("./ai-matching.js").MatchingRequest["resume"] {
  const latestWorkHistory = getLatestWorkHistory(item.resume.workHistory);
  return {
    id: item.resumeId,
    name: item.resume.name || "未命名",
    workExperience: item.indexData.experienceYears ?? undefined,
    education: item.resume.education || undefined,
    skills: item.indexData.skills,
    companies: item.indexData.companies.length > 0 ? item.indexData.companies : extractCompanies(latestWorkHistory),
    companyHits: item.companyHits,
    roleSignals: item.roleSignals,
    workHistory: buildLatestWorkHistoryEvidence(latestWorkHistory).lines.join("\n") || undefined,
    sourceKey: resolveResumeAnalysisSourceKey({ sourceKey: item.resume.profileType }),
  };
}

export function buildSearchEventQuery(params: {
  keywords: string[];
  location?: string;
  jobDescriptionId?: string;
}): string | null {
  const keywordQuery = formatKeywordQuery(params.keywords).trim();
  if (keywordQuery) {
    const location = params.location?.trim();
    return location ? `${keywordQuery} ${location}` : keywordQuery;
  }

  const jobDescriptionId = params.jobDescriptionId?.trim();
  if (jobDescriptionId) {
    return `jd:${jobDescriptionId}`;
  }

  return null;
}

export function toKeywordJobDescriptionId(keywords: string[], location?: string): string {
  return buildKeywordAnalysisId(keywords, {
    location,
    promptVersion: getCurrentResumeAiPromptVersion(),
  });
}

export function createSsePayload(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function buildKeywordRequirements(keywords: string[]): string {
  return `候选人需具备以下关键技能/经验:\n${keywords.map((keyword) => `- ${keyword}`).join("\n")}`;
}

export function buildKeywordResponsibilities(keywords: string[], location?: string): string | undefined {
  const parts = [
    `核心关键词: ${keywords.join(", ")}`,
    location?.trim() ? `目标地点: ${location.trim()}` : undefined,
  ].filter((item): item is string => Boolean(item));
  if (parts.length === 0) return undefined;
  return parts.join("\n");
}
