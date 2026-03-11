import path from "node:path";

import { findProjectRoot } from "./db.js";
import { parseSearchQuery } from "./query-parser.js";
import { resolveResumeId } from "./resume-id.js";
import { SkillsKnowledgeService } from "./skills-knowledge.js";

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

export class UnifiedSearchService {
  readonly projectRoot: string;
  private readonly skillsService: SkillsKnowledgeService;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    this.skillsService = new SkillsKnowledgeService(this.projectRoot);
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
      const searchText = index?.searchText || buildSearchText(item);
      const companies = index?.companies ?? (item.workHistory?.map((entry) => extractCompanyName(entry.raw)) || []);
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
