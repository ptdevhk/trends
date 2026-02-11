import path from "node:path";

import { findProjectRoot } from "./db.js";
import { FilterPresetService } from "./filter-preset-service.js";
import type { AutoMatchConfig, JobDescriptionFull } from "./job-description-service.js";
import type { MatchingResult } from "./ai-matching.js";
import { ResumeIndexService } from "./resume-index.js";

import type { ResumeIndex } from "./resume-index.js";

type RuleBreakdown = {
  skillMatch: number;
  experienceMatch: number;
  educationMatch: number;
  locationMatch: number;
  industryMatch: number;
};

export interface RuleScoringResult {
  score: number;
  recommendation: MatchingResult["recommendation"];
  breakdown: RuleBreakdown;
  matchedSkills: string[];
  matchedCompanies: string[];
}

type EffectiveFilters = {
  minExperience?: number;
  maxExperience?: number | null;
  education?: string[];
  salaryRange?: { min?: number; max?: number };
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function uniq(items: string[]): string[] {
  return Array.from(new Set(items));
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type EducationRank = 1 | 2 | 3 | 4 | 5;

function educationRank(value: string | null | undefined): EducationRank | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;

  const canonical = normalized.toLowerCase();
  if (canonical === "high_school") return 1;
  if (canonical === "associate") return 2;
  if (canonical === "bachelor") return 3;
  if (canonical === "master") return 4;
  if (canonical === "phd") return 5;

  if (/博士/.test(normalized)) return 5;
  if (/硕士|研究生/.test(normalized)) return 4;
  if (/mba|emba/i.test(normalized)) return 4;
  if (/本科/.test(normalized)) return 3;
  if (/大专|专科/.test(normalized)) return 2;
  if (/中专|高中|中技/.test(normalized)) return 1;

  return null;
}

function resolveMinEducationRank(values: string[] | undefined): EducationRank | null {
  if (!values?.length) return null;
  const ranks = values
    .map((value) => educationRank(value))
    .filter((rank): rank is EducationRank => rank !== null);
  if (!ranks.length) return null;
  return ranks.reduce((min, current) => (current < min ? current : min), ranks[0]);
}

function recommendationFromScore(score: number): MatchingResult["recommendation"] {
  if (score >= 90) return "strong_match";
  if (score >= 70) return "match";
  if (score >= 50) return "potential";
  return "no_match";
}

function scoreExperience(expYears: number | null, filters: EffectiveFilters): number {
  if (expYears === null) return 0;

  const minExperience = filters.minExperience;
  const maxExperience = filters.maxExperience ?? undefined;

  if (minExperience === undefined && maxExperience === undefined) return 25;

  if (minExperience !== undefined && expYears < minExperience) {
    const diff = minExperience - expYears;
    return clamp(Math.round(25 - diff * 8), 0, 25);
  }

  if (maxExperience !== undefined && expYears > maxExperience) {
    const diff = expYears - maxExperience;
    return clamp(Math.round(25 - diff * 5), 0, 25);
  }

  return 25;
}

function scoreEducation(resumeRank: EducationRank | null, requiredRank: EducationRank | null): number {
  if (!requiredRank) return 15;
  if (!resumeRank) return 0;
  if (resumeRank >= requiredRank) return 15;
  const diff = requiredRank - resumeRank;
  return clamp(Math.round(15 - diff * 8), 0, 15);
}

function scoreLocation(searchText: string, locations: string[] | undefined): number {
  if (!locations?.length) return 15;
  const haystack = normalizeText(searchText);
  const matched = locations.some((loc) => {
    const normalized = normalizeText(loc);
    return normalized ? haystack.includes(normalized) : false;
  });
  return matched ? 15 : 0;
}

function scoreIndustry(params: {
  resume: ResumeIndex;
  jdKeywords: string[];
  jdIndustryTags: string[];
}): { score: number; matchedCompanies: string[] } {
  const { resume, jdKeywords, jdIndustryTags } = params;
  const normalizedKeywords = jdKeywords.map((kw) => normalizeText(kw)).filter(Boolean);

  const matchedCompanies = (resume.companies ?? []).filter((company) => {
    const normalized = normalizeText(company);
    if (!normalized) return false;
    return normalizedKeywords.some((kw) => kw && normalized.includes(kw));
  });

  if (matchedCompanies.length > 0) {
    return { score: 15, matchedCompanies: uniq(matchedCompanies) };
  }

  if (!jdIndustryTags.length) {
    return { score: 0, matchedCompanies: [] };
  }

  const resumeTags = new Set(resume.industryTags);
  const overlap = jdIndustryTags.filter((tag) => resumeTags.has(tag));
  if (!overlap.length) {
    return { score: 0, matchedCompanies: [] };
  }

  const ratio = overlap.length / jdIndustryTags.length;
  return { score: clamp(Math.round(ratio * 15), 0, 15), matchedCompanies: [] };
}

function resolveJobKeywords(job: JobDescriptionFull): string[] {
  const keywords = job.autoMatch?.keywords ?? [];
  return uniq(keywords.map((kw) => kw.trim()).filter(Boolean));
}

function resolveJobLocations(job: JobDescriptionFull): string[] {
  const locations = job.autoMatch?.locations ?? [];
  return uniq(locations.map((loc) => loc.trim()).filter(Boolean));
}

function mergeFilters(params: {
  preset?: { minExperience?: number; maxExperience?: number | null; education?: string[]; salaryRange?: { min?: number; max?: number } };
  suggested?: AutoMatchConfig["suggested_filters"];
}): EffectiveFilters {
  const merged: EffectiveFilters = {};

  if (params.preset) {
    if (typeof params.preset.minExperience === "number") merged.minExperience = params.preset.minExperience;
    if (params.preset.maxExperience !== undefined) merged.maxExperience = params.preset.maxExperience;
    if (Array.isArray(params.preset.education)) merged.education = params.preset.education;
    if (params.preset.salaryRange) merged.salaryRange = params.preset.salaryRange;
  }

  const suggested = params.suggested;
  if (suggested) {
    if (typeof suggested.minExperience === "number") merged.minExperience = suggested.minExperience;
    if (typeof suggested.maxExperience === "number") merged.maxExperience = suggested.maxExperience;
    if (Array.isArray(suggested.education)) merged.education = suggested.education;
    if (suggested.salaryRange) merged.salaryRange = suggested.salaryRange;
  }

  return merged;
}

export class RuleScoringService {
  private readonly projectRoot: string;
  private readonly indexService: ResumeIndexService;
  private readonly presetService: FilterPresetService;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    this.indexService = new ResumeIndexService(this.projectRoot);
    this.presetService = new FilterPresetService(this.projectRoot);
  }

  getIndexService(): ResumeIndexService {
    return this.indexService;
  }

  scoreResume(resumeIndex: ResumeIndex, job: JobDescriptionFull): RuleScoringResult {
    const jdKeywords = resolveJobKeywords(job);
    const jdLocations = resolveJobLocations(job);

    const presetId = job.autoMatch?.filter_preset;
    const preset = presetId ? this.presetService.getPreset(presetId) : undefined;
    const effective = mergeFilters({
      preset: preset?.filters,
      suggested: job.autoMatch?.suggested_filters,
    });

    const searchText = resumeIndex.searchText ?? "";
    const matchedSkills = jdKeywords.filter((kw) => {
      const normalized = normalizeText(kw);
      return normalized ? searchText.includes(normalized) : false;
    });

    const skillMatch = jdKeywords.length
      ? clamp(Math.round((matchedSkills.length / jdKeywords.length) * 30), 0, 30)
      : 0;

    const experienceMatch = scoreExperience(resumeIndex.experienceYears, effective);

    const requiredRank = resolveMinEducationRank(effective.education);
    const resumeRank = educationRank(resumeIndex.educationLevel);
    const educationMatch = scoreEducation(resumeRank, requiredRank);

    const locationMatch = scoreLocation(searchText, jdLocations);

    const jdIndustryTags = this.indexService.inferIndustryTagsFromText(
      `${job.title ?? ""} ${jdKeywords.join(" ")}`
    );

    const industryResult = scoreIndustry({
      resume: resumeIndex,
      jdKeywords,
      jdIndustryTags,
    });

    const breakdown: RuleBreakdown = {
      skillMatch,
      experienceMatch,
      educationMatch,
      locationMatch,
      industryMatch: industryResult.score,
    };

    const totalScore = clamp(
      breakdown.skillMatch
        + breakdown.experienceMatch
        + breakdown.educationMatch
        + breakdown.locationMatch
        + breakdown.industryMatch,
      0,
      100
    );

    return {
      score: totalScore,
      recommendation: recommendationFromScore(totalScore),
      breakdown,
      matchedSkills: uniq(matchedSkills),
      matchedCompanies: uniq(industryResult.matchedCompanies),
    };
  }

  toMatchingResult(rule: RuleScoringResult): MatchingResult & { breakdown: RuleBreakdown } {
    const highlights: string[] = [];
    if (rule.matchedSkills.length) {
      highlights.push(`命中关键词: ${rule.matchedSkills.slice(0, 8).join(", ")}`);
    }
    if (rule.matchedCompanies.length) {
      highlights.push(`相关公司/经历: ${rule.matchedCompanies.slice(0, 4).join(", ")}`);
    }
    highlights.push(`规则评分: ${rule.score}`);

    const concerns: string[] = [];
    if (!rule.matchedSkills.length) {
      concerns.push("未命中JD关键词");
    }
    if (rule.breakdown.locationMatch === 0) {
      concerns.push("地点不匹配");
    }
    if (rule.breakdown.experienceMatch < 20) {
      concerns.push("经验可能不足");
    }
    if (rule.breakdown.educationMatch < 10) {
      concerns.push("学历可能不足");
    }

    const summary = `规则引擎评分 ${rule.score} 分，建议：${rule.recommendation}`;

    return {
      score: rule.score,
      recommendation: rule.recommendation,
      highlights,
      concerns,
      summary,
      breakdown: rule.breakdown,
    };
  }

  pickTopCandidates(params: {
    resumeIndexes: ResumeIndex[];
    job: JobDescriptionFull;
    limit: number;
    minScore?: number;
  }): Array<{ resumeId: string; score: number }> {
    const limit = Math.max(0, Math.floor(params.limit));
    if (limit === 0) return [];

    const minScore = toNumberOrNull(params.minScore) ?? null;

    const scored = params.resumeIndexes.map((index) => {
      const result = this.scoreResume(index, params.job);
      return { resumeId: index.resumeId, score: result.score };
    });

    const filtered = minScore === null ? scored : scored.filter((item) => item.score >= minScore);
    return filtered.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
