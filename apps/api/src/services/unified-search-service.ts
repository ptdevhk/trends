import { buildWorkHistoryEntryText, formatLocationHierarchySearchText, selectLatestWorkHistory } from "@trends/shared";

import { parseSearchQuery } from "./query-parser.js";
import { resolveResumeId } from "./resume-id.js";
import { extractCompanyFromWorkHistory } from "./work-history.js";

import { buildCompanyPatternAliasLookup } from "./skills-knowledge.js";

import type { SkillsKnowledgeService } from "./skills-knowledge.js";
import type { ResumeIndex } from "./resume-index.js";
import type { ResumeItem } from "../types/resume.js";

export type UnifiedSearchMatchSource =
  | "searchText"
  | "industryTags"
  | "companyHits"
  | "synonymHits";

export type UnifiedSearchProvenance = {
  term: string;
  source: UnifiedSearchMatchSource;
  expandedFrom?: string;
};

export interface UnifiedSearchResult {
  resume: ResumeItem & { relevanceScore: number };
  provenance: UnifiedSearchProvenance[];
}

export type KeywordGroup = {
  original: string;
  variants: string[];
};

export interface UnifiedKeywordExpansion {
  flatTerms: string[];
  groups: KeywordGroup[];
  mode: "AND" | "OR";
  originalKeyword: string;
  sourceMapping: Record<string, string>;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

// BFF-side narrow haystack — same logic as resume-service.ts buildBffSearchText.
function buildBffSearchText(item: ResumeItem): string {
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

function dedupeProvenance(items: UnifiedSearchProvenance[]): UnifiedSearchProvenance[] {
  const seen = new Set<string>();
  const deduped: UnifiedSearchProvenance[] = [];

  for (const item of items) {
    const key = `${item.source}|${item.term}|${item.expandedFrom ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

export interface VerifiedIndustryEmployer {
  companyKey: string;
  industryClass: string;
  displayName: string;
  aliases: string[];
  updatedAt: number;
}

export interface VerifiedEmployerCatalog {
  getVerifiedEmployers(): VerifiedIndustryEmployer[];
}

const EMPTY_VERIFIED_EMPLOYER_CATALOG: VerifiedEmployerCatalog = {
  getVerifiedEmployers: () => [],
};

/**
 * Map skills.md domain tags to governed industry classes. A keyword group
 * matching one of these domain tags (via synonym expansion) becomes
 * industry-scoped and bridges verified employers of the mapped class.
 * Compatibility mirrors industry-verification-service isTaxonomyCompatible:
 * the industrial umbrella accepts cnc/automation/metrology/industrial.
 */
const DOMAIN_TAG_TO_INDUSTRY_CLASSES: Record<string, string[]> = {
  machinery: ["cnc", "automation", "metrology", "industrial"],
  metrology: ["metrology"],
};

const INDUSTRY_COMPATIBLE_CLASSES = new Set([
  "cnc",
  "automation",
  "metrology",
  "industrial",
]);

export class UnifiedSearchService {
  private readonly skillsService: SkillsKnowledgeService;
  private readonly verifiedEmployerCatalog: VerifiedEmployerCatalog;
  private readonly companyPatternAliasLookup: Map<string, string>;
  private readonly companyPatternsByCanonicalId: Map<string, ReturnType<SkillsKnowledgeService["getCompanyPatterns"]>[number]>;

  constructor(
    skillsService: SkillsKnowledgeService,
    verifiedEmployerCatalog?: VerifiedEmployerCatalog,
  ) {
    this.skillsService = skillsService;
    this.verifiedEmployerCatalog =
      verifiedEmployerCatalog ?? EMPTY_VERIFIED_EMPLOYER_CATALOG;
    const companyPatterns = this.skillsService.getCompanyPatterns();
    this.companyPatternAliasLookup = buildCompanyPatternAliasLookup(companyPatterns);
    this.companyPatternsByCanonicalId = new Map(
      companyPatterns.map((pattern) => [pattern.name.toLowerCase(), pattern])
    );
  }

  /**
   * Industry classes a keyword group is scoped to, based on the skills.md
   * domain taxonomy matched through the group's synonym-expanded variants.
   */
  private industryClassesForGroup(variants: string[]): string[] {
    const variantSet = new Set(variants.map((variant) => variant.toLowerCase()));
    const classes = new Set<string>();
    for (const domain of this.skillsService.getIndustryTaxonomy()) {
      const mapped = DOMAIN_TAG_TO_INDUSTRY_CLASSES[domain.tag];
      if (!mapped) {
        continue;
      }
      const hitsDomain = domain.keywords.some((keyword) =>
        variantSet.has(keyword.toLowerCase()),
      );
      if (hitsDomain) {
        for (const industryClass of mapped) {
          classes.add(industryClass);
        }
      }
    }
    return [...classes].sort();
  }

  expandKeyword(keyword: string): UnifiedKeywordExpansion {
    const parsedQuery = parseSearchQuery(keyword.trim());
    const groups: KeywordGroup[] = [];
    const flatTerms: string[] = [];
    const seenFlatTerms = new Set<string>();
    const sourceMapping: Record<string, string> = {};

    const pushFlatTerm = (term: string, expandedFrom?: string): void => {
      const normalized = normalizeToken(term);
      if (normalized.length < 2 || seenFlatTerms.has(normalized)) {
        return;
      }
      seenFlatTerms.add(normalized);
      flatTerms.push(normalized);
      if (expandedFrom && normalized !== expandedFrom) {
        sourceMapping[normalized] = expandedFrom;
      }
    };

    for (const rawKeyword of parsedQuery.keywords) {
      const original = normalizeToken(rawKeyword);
      if (original.length < 2) {
        continue;
      }

      const variants: string[] = [];
      const seenVariants = new Set<string>();
      const pushVariant = (term: string): void => {
        const normalized = normalizeToken(term);
        if (normalized.length < 2 || seenVariants.has(normalized)) {
          return;
        }
        seenVariants.add(normalized);
        variants.push(normalized);
        pushFlatTerm(normalized, original);
      };

      pushVariant(original);
      const expanded = this.skillsService.expandQueryWithSynonyms([original]);
      for (const term of expanded) {
        pushVariant(term);
      }

      const canonicalCompanyId = this.companyPatternAliasLookup.get(original);
      if (canonicalCompanyId) {
        pushVariant(canonicalCompanyId);
        const pattern = this.companyPatternsByCanonicalId.get(canonicalCompanyId);
        if (pattern) {
          for (const alias of pattern.allNames) {
            pushVariant(alias);
          }
        }
      }

      // Verified-employer bridge: if this group is industry-scoped, inject
      // the display names + aliases of companies whose current governed
      // verdict is verified for a taxonomy-compatible industry class.
      // Read-only; rejected/unknown profiles never bridge.
      const bridgedClasses = this.industryClassesForGroup(variants);
      if (bridgedClasses.length > 0) {
        const bridgedClassSet = new Set(bridgedClasses);
        for (const employer of this.verifiedEmployerCatalog.getVerifiedEmployers()) {
          const compatible =
            INDUSTRY_COMPATIBLE_CLASSES.has(employer.industryClass) &&
            (bridgedClassSet.has(employer.industryClass) ||
              (bridgedClasses.some((cls) => cls === "industrial") &&
                INDUSTRY_COMPATIBLE_CLASSES.has(employer.industryClass)));
          if (!compatible) {
            continue;
          }
          pushVariant(employer.displayName);
          for (const alias of employer.aliases) {
            pushVariant(alias);
          }
        }
      }

      if (variants.length > 0) {
        groups.push({
          original,
          variants,
        });
      }
    }

    return {
      flatTerms,
      groups,
      mode: parsedQuery.mode,
      originalKeyword: keyword.trim(),
      sourceMapping,
    };
  }

  searchUnified(
    items: ResumeItem[],
    query: string,
    options?: {
      indexMap?: Map<string, ResumeIndex>;
      ruleScoreMap?: Map<string, number>;
    }
  ): {
    expansion: UnifiedKeywordExpansion;
    results: UnifiedSearchResult[];
  } {
    const expansion = this.expandKeyword(query);
    if (expansion.flatTerms.length === 0) {
      return { expansion, results: [] };
    }

    const results: UnifiedSearchResult[] = [];

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const resumeId = resolveResumeId(item, i);
      const index = options?.indexMap?.get(resumeId);
      const searchText = index?.searchText || buildBffSearchText(item);
      const companies = index?.companies ?? selectLatestWorkHistory(item.workHistory).map((entry) => extractCompanyFromWorkHistory(entry));
      const industryTags = index?.industryTags ?? [];
      const provenance: UnifiedSearchProvenance[] = [];
      let matchedGroupCount = 0;

      for (const group of expansion.groups) {
        const groupMatches: UnifiedSearchProvenance[] = [];

        for (const term of group.variants) {
          const expandedFrom = expansion.sourceMapping[term];

          if (searchText.includes(term)) {
            groupMatches.push({ term, source: "searchText", expandedFrom });
          }

          if (industryTags.some((tag) => normalizeToken(tag) === term)) {
            groupMatches.push({ term, source: "industryTags", expandedFrom });
          }

          if (companies.some((company) => normalizeToken(company).includes(term))) {
            groupMatches.push({ term, source: "companyHits", expandedFrom });
          }
        }

        if (groupMatches.length > 0) {
          matchedGroupCount += 1;
          provenance.push(...groupMatches);
        }
      }

      const matched = expansion.mode === "AND"
        ? matchedGroupCount === expansion.groups.length
        : matchedGroupCount > 0;
      if (!matched) {
        continue;
      }

      const dedupedProvenance = dedupeProvenance(provenance);
      if (dedupedProvenance.length === 0) {
        continue;
      }

      const baseScore = dedupedProvenance.reduce((score, match) => {
        switch (match.source) {
          case "industryTags":
          case "companyHits":
            return score + 30;
          case "synonymHits":
            return score + 20;
          case "searchText":
          default:
            return score + 10;
        }
      }, 0);
      const ruleScore = options?.ruleScoreMap?.get(resumeId) ?? 0;
      const relevanceScore = ruleScore > 0
        ? Math.round((baseScore * 0.4) + (ruleScore * 0.6))
        : baseScore;

      results.push({
        resume: {
          ...item,
          relevanceScore,
        },
        provenance: dedupedProvenance,
      });
    }

    return {
      expansion,
      results: results.sort((left, right) => right.resume.relevanceScore - left.resume.relevanceScore),
    };
  }
}
