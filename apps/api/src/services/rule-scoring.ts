import fs from "node:fs";
import path from "node:path";

import JSON5 from "json5";
import { FALLBACK_INDUSTRY_KEYWORDS, normalizeEducationLevel, normalizeIndustryTags, type KeywordMarket } from "@trends/shared";
import { z } from "zod";

import { findProjectRoot } from "./db.js";
import { FilterPresetService } from "./filter-preset-service.js";
import { logger } from "./logger.js";
import { JobDescriptionService } from "./job-description-service.js";
import { SkillsKnowledgeService } from "./skills-knowledge.js";
import type { MatchingResult } from "./ai-matching.js";
import type { ResumeIndex } from "./resume-index.js";

export type BrandContext = "employer" | "equipment" | "sales" | "technical" | "general";
export type BrandRole = "employer" | "equipment" | "both";

export interface RuleWeightsConfig {
  categoryWeights: {
    skillMatch: number;
    roleMatch: number;
    experienceMatch: number;
    educationMatch: number;
    locationMatch: number;
    industryMatch: number;
    brandRelevance: number;
  };
  roleContext: {
    enabled: boolean;
    capRatio: number;
    softGateFloorRatio: number;
  };
  brandContextWithTarget: Record<BrandContext, number>;
  brandContextNoTarget: Record<BrandContext, number>;
  brandRoleMultipliers: Record<BrandRole, number>;
  recommendationThresholds: {
    strongMatch: number;
    match: number;
    potential: number;
  };
}

const DEFAULT_WEIGHTS: RuleWeightsConfig = {
  categoryWeights: {
    skillMatch: 15,
    roleMatch: 10,
    experienceMatch: 25,
    educationMatch: 15,
    locationMatch: 15,
    industryMatch: 10,
    brandRelevance: 10,
  },
  roleContext: {
    enabled: true,
    capRatio: 0.8,
    softGateFloorRatio: 0.2,
  },
  brandContextWithTarget: { employer: 10, sales: 9, equipment: 7, technical: 6, general: 4 },
  brandContextNoTarget: { employer: 4, sales: 3, equipment: 2, technical: 2, general: 1 },
  brandRoleMultipliers: { employer: 1, equipment: 0.7, both: 1 },
  recommendationThresholds: { strongMatch: 85, match: 70, potential: 50 },
};

const nonNegativeNumber = z.number().finite().min(0);
const ratioNumber = z.number().finite().min(0).max(1);
const brandContextWeightsSchema = z.object({
  employer: nonNegativeNumber,
  equipment: nonNegativeNumber,
  sales: nonNegativeNumber,
  technical: nonNegativeNumber,
  general: nonNegativeNumber,
}).partial();
const brandRoleMultipliersSchema = z.object({
  employer: nonNegativeNumber,
  equipment: nonNegativeNumber,
  both: nonNegativeNumber,
}).partial();

const ruleWeightsSchema = z.object({
  categoryWeights: z.object({
    skillMatch: nonNegativeNumber,
    roleMatch: nonNegativeNumber,
    experienceMatch: nonNegativeNumber,
    educationMatch: nonNegativeNumber,
    locationMatch: nonNegativeNumber,
    industryMatch: nonNegativeNumber,
    brandRelevance: nonNegativeNumber,
  }).partial().optional(),
  roleContext: z.object({
    enabled: z.boolean(),
    capRatio: ratioNumber,
    softGateFloorRatio: ratioNumber,
  }).partial().optional(),
  brandContextWithTarget: brandContextWeightsSchema.optional(),
  brandContextNoTarget: brandContextWeightsSchema.optional(),
  brandRoleMultipliers: brandRoleMultipliersSchema.optional(),
  recommendationThresholds: z.object({
    strongMatch: nonNegativeNumber,
    match: nonNegativeNumber,
    potential: nonNegativeNumber,
  }).partial().optional(),
}).partial();

export type RuleWeightsConfigOverrides = z.infer<typeof ruleWeightsSchema>;

export function mergeRuleWeights(overrides: RuleWeightsConfigOverrides | undefined): RuleWeightsConfig {
  if (!overrides) {
    return DEFAULT_WEIGHTS;
  }

  return {
    categoryWeights: {
      ...DEFAULT_WEIGHTS.categoryWeights,
      ...(overrides.categoryWeights ?? {}),
    },
    roleContext: {
      ...DEFAULT_WEIGHTS.roleContext,
      ...(overrides.roleContext ?? {}),
    },
    brandContextWithTarget: {
      ...DEFAULT_WEIGHTS.brandContextWithTarget,
      ...(overrides.brandContextWithTarget ?? {}),
    },
    brandContextNoTarget: {
      ...DEFAULT_WEIGHTS.brandContextNoTarget,
      ...(overrides.brandContextNoTarget ?? {}),
    },
    brandRoleMultipliers: {
      ...DEFAULT_WEIGHTS.brandRoleMultipliers,
      ...(overrides.brandRoleMultipliers ?? {}),
    },
    recommendationThresholds: {
      ...DEFAULT_WEIGHTS.recommendationThresholds,
      ...(overrides.recommendationThresholds ?? {}),
    },
  };
}

export function parseRuleWeightsOverrides(raw: unknown): RuleWeightsConfigOverrides | undefined {
  const parsed = ruleWeightsSchema.safeParse(raw);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

export function loadRuleWeightsConfig(projectRoot: string): RuleWeightsConfig {
  const configPath = path.join(projectRoot, "config", "resume", "rule-weights.json5");
  if (!fs.existsSync(configPath)) {
    return DEFAULT_WEIGHTS;
  }

  try {
    const content = fs.readFileSync(configPath, "utf8");
    const raw: unknown = JSON5.parse(content);
    const parsed = parseRuleWeightsOverrides(raw);
    if (!parsed) {
      logger.error("[RuleScoring] Failed to parse rule-weights.json5", "", { service: "rule-scoring" });
      return DEFAULT_WEIGHTS;
    }

    return mergeRuleWeights(parsed);
  } catch (error) {
    logger.error("[RuleScoring] Failed to load rule-weights.json5", error, { service: "rule-scoring" });
    return DEFAULT_WEIGHTS;
  }
}

export interface BrandHit {
  brand: string;
  role: BrandRole;
  source: "workHistory" | "selfIntro" | "jobIntention";
  context: BrandContext;
}

export interface RuleScoringResult {
  score: number;
  recommendation: MatchingResult["recommendation"];
  breakdown: {
    skillMatch: number;
    roleMatch: number;
    experienceMatch: number;
    educationMatch: number;
    locationMatch: number;
    industryMatch: number;
    brandRelevance: number;
  };
  brandContext?: BrandHit[];
  matchedSkills: string[];
  matchedCompanies: string[];
}

export interface RuleScoringContext {
  jobDescriptionId: string;
  title: string;
  keywords: string[];
  targetLocations: string[];
  minExperience?: number;
  educationRequirements: string[];
  industryKeywords: string[];
  industryTags: string[];
  brandKeywords?: string[];
  requiredRoles: RequiredRoleRequirement[];
}

export interface RequiredRoleRequirement {
  type: string;
  minYears?: number;
  signals: string[];
  verifyIn: "workHistory" | "searchText";
}

export interface MatchedWorkEntry {
  companyName?: string;
  jobTitle?: string;
  years: number;
  industryVerified: boolean;
  matchedSignals: string[];
  directRoleMatch?: boolean;
}

export interface RoleSignalSummary {
  type: string;
  matchedSignals: string[];
  signalCount: number;
  occurrences: number;
  years: number;
  industryVerifiedYears: number;
  roleRelevantYears?: number;
  industryVerifiedRelevantYears?: number;
  matchedWorkEntries?: MatchedWorkEntry[];
  verifyIn: "workHistory" | "searchText";
}

const EDUCATION_RANK: Record<string, number> = {
  high_school: 1,
  associate: 2,
  bachelor: 3,
  master: 4,
  phd: 5,
};

// Role types that require industry-verified years for accurate scoring
const INDUSTRY_VERIFIED_ROLE_TYPES = new Set(["sales"]);

function requiresIndustryVerification(roleType: string): boolean {
  return INDUSTRY_VERIFIED_ROLE_TYPES.has(roleType.toLowerCase());
}

const INDUSTRY_MAP: Array<{ tag: string; keywords: string[] }> = Object.entries(FALLBACK_INDUSTRY_KEYWORDS).map(
  ([tag, keywords]) => ({ tag, keywords })
);

const KEYWORD_ROLE_SIGNAL_LIBRARY: Record<string, string[]> = {
  sales: [
    "销售",
    "业务",
    "商务",
    "销售员",
    "销售经理",
    "销售工程师",
    "大客户",
    "渠道",
    "客户开发",
    "sales",
    "account",
    "key account",
    "bd",
    "business development",
  ],
  engineer: [
    "工程师",
    "研发",
    "设计",
    "开发",
    "编程",
    "engineer",
    "developer",
    "design",
  ],
  operator: [
    "操作员",
    "操作",
    "操机",
    "开机",
    "机台",
    "operator",
  ],
  technician: [
    "技术员",
    "维修",
    "维护",
    "安装",
    "保养",
    "售后",
    "technician",
    "service",
    "after-sales",
  ],
  manager: [
    "经理",
    "主管",
    "总监",
    "负责人",
    "manager",
    "lead",
    "leader",
    "director",
  ],
};

const LOCATION_PROXIMITY_GROUPS: Record<string, string[]> = {
  pearlRiverDelta: ["东莞", "深圳", "广州", "佛山", "惠州", "中山", "珠海", "江门"],
  yangtzeRiverDelta: ["上海", "苏州", "杭州", "南京", "无锡", "宁波", "常州", "嘉兴"],
  bohaiRim: ["北京", "天津", "大连", "青岛", "济南"],
};

function ensureKeywords(value: string[]): string[] {
  return Array.from(
    new Set(
      value
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length >= 2)
    )
  );
}

function inferIndustryTagsForMap(tokens: string[], industryMap: Array<{ tag: string; keywords: string[] }>): string[] {
  const haystack = tokens.join(" ").toLowerCase();
  const tags = new Set<string>();

  for (const item of industryMap) {
    if (item.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      tags.add(item.tag);
    }
  }

  return normalizeIndustryTags(Array.from(tags));
}

function inferIndustryTags(tokens: string[]): string[] {
  return inferIndustryTagsForMap(tokens, INDUSTRY_MAP);
}

function getMinEducationRank(requirements: string[]): number | null {
  const ranks = requirements
    .map((item) => normalizeEducationLevel(item))
    .filter((item): item is string => Boolean(item))
    .map((item) => EDUCATION_RANK[item] ?? 0)
    .filter((rank) => rank > 0);

  if (ranks.length === 0) return null;
  return Math.min(...ranks);
}

function compactText(value: string): string {
  return value.toLowerCase().replace(/[\u3000\s]+/g, " ");
}

function locationMatches(candidateLocation: string, targetLocation: string): boolean {
  const candidate = candidateLocation.trim().toLowerCase();
  const target = targetLocation.trim().toLowerCase();
  if (!candidate || !target) {
    return false;
  }

  if (candidate === target) {
    return true;
  }

  const canUseSubstring = candidate.length >= 2 && target.length >= 2;
  if (!canUseSubstring) {
    return false;
  }

  return candidate.includes(target) || target.includes(candidate);
}

function normalizeLocationToken(value: string): string {
  return value.trim().toLowerCase().replace(/市$/u, "");
}

function resolveProximityGroup(location: string): string | null {
  const normalized = normalizeLocationToken(location);
  if (normalized.length < 2) {
    return null;
  }

  for (const [group, cities] of Object.entries(LOCATION_PROXIMITY_GROUPS)) {
    const inGroup = cities.some((city) => {
      const normalizedCity = normalizeLocationToken(city);
      if (!normalizedCity || normalizedCity.length < 2) {
        return false;
      }
      return normalized === normalizedCity
        || normalized.includes(normalizedCity)
        || normalizedCity.includes(normalized);
    });

    if (inGroup) {
      return group;
    }
  }

  return null;
}

function getLocationProximityScore(candidateLocation: string, targetLocations: string[], exactWeight: number): number {
  const candidate = candidateLocation.trim();
  if (!candidate || targetLocations.length === 0) {
    return 0;
  }

  if (targetLocations.some((target) => locationMatches(candidate, target))) {
    return exactWeight;
  }

  const candidateGroup = resolveProximityGroup(candidate);
  if (!candidateGroup) {
    return 0;
  }

  const groupCities = LOCATION_PROXIMITY_GROUPS[candidateGroup] ?? [];
  const hasProximityMatch = targetLocations.some((target) => {
    const normalizedTarget = normalizeLocationToken(target);
    if (!normalizedTarget || normalizedTarget.length < 2) {
      return false;
    }

    return groupCities.some((city) => {
      const normalizedCity = normalizeLocationToken(city);
      return normalizedTarget === normalizedCity
        || normalizedTarget.includes(normalizedCity)
        || normalizedCity.includes(normalizedTarget);
    });
  });

  const proximityWeight = Math.round((exactWeight * 8) / DEFAULT_WEIGHTS.categoryWeights.locationMatch);
  return hasProximityMatch ? proximityWeight : 0;
}

function getIndustryMap(skillsService?: SkillsKnowledgeService): Array<{ tag: string; keywords: string[] }> {
  try {
    if (skillsService) {
      return skillsService.getIndustryTaxonomy().map((d) => ({
        tag: d.tag,
        keywords: d.keywords,
      }));
    }
    return INDUSTRY_MAP;
  } catch {
    return INDUSTRY_MAP;
  }
}

function normalizeRoleVerifyIn(value: string | undefined): "workHistory" | "searchText" {
  if (value === "searchText") {
    return "searchText";
  }
  return "workHistory";
}

function normalizeRequiredRoles(rawRoles: Array<{
  type: string;
  min_years?: number;
  signals: string[];
  verify_in?: string;
}> | undefined): RequiredRoleRequirement[] {
  if (!Array.isArray(rawRoles) || rawRoles.length === 0) {
    return [];
  }

  return rawRoles
    .map((role) => {
      const type = role.type.trim().toLowerCase();
      const signals = ensureKeywords(role.signals);
      if (!type || signals.length === 0) {
        return null;
      }

      const normalized: RequiredRoleRequirement = {
        type,
        signals,
        verifyIn: normalizeRoleVerifyIn(role.verify_in),
      };
      if (typeof role.min_years === "number" && Number.isFinite(role.min_years) && role.min_years > 0) {
        normalized.minYears = role.min_years;
      }
      return normalized;
    })
    .filter((role): role is RequiredRoleRequirement => role !== null);
}

export class RuleScoringService {
  private readonly jobService: JobDescriptionService;
  private readonly filterPresetService: FilterPresetService;
  private readonly skillsService: SkillsKnowledgeService;
  private readonly weights: RuleWeightsConfig;

  constructor(projectRoot?: string) {
    const resolvedProjectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    this.weights = loadRuleWeightsConfig(resolvedProjectRoot);
    this.jobService = new JobDescriptionService(resolvedProjectRoot);
    this.filterPresetService = new FilterPresetService(resolvedProjectRoot);
    this.skillsService = new SkillsKnowledgeService(resolvedProjectRoot);
  }

  private recommendationFromScore(score: number): MatchingResult["recommendation"] {
    const thresholds = this.weights.recommendationThresholds;
    if (score >= thresholds.strongMatch) return "strong_match";
    if (score >= thresholds.match) return "match";
    if (score >= thresholds.potential) return "potential";
    return "no_match";
  }

  buildContext(jobDescriptionId: string): RuleScoringContext {
    const jd = this.jobService.loadFile(jobDescriptionId);
    const autoMatch = jd.autoMatch;
    const requiredRoles = normalizeRequiredRoles(jd.requiredRoles);

    const keywords = ensureKeywords(autoMatch?.keywords ?? []);
    const targetLocations = jd.location?.trim() ? [jd.location.trim()] : [];
    const presetId = jd.filterPreset;
    const preset = presetId ? this.filterPresetService.getPreset(presetId) : undefined;

    const minExperience = jd.suggestedFilters?.minExperience
      ?? requiredRoles.map((role) => role.minYears).find((value): value is number => typeof value === "number")
      ?? preset?.filters.minExperience;
    const educationRequirements = [
      ...(jd.suggestedFilters?.education ?? []),
      ...(preset?.filters.education ?? []),
    ];

    const industryKeywords = ensureKeywords([
      ...keywords,
      compactText(jd.title || ""),
      compactText(jd.content || ""),
    ]);

    const industryMap = getIndustryMap(this.skillsService);
    const industryTags = this.inferIndustryTags(industryKeywords, industryMap);
    const brandKeywords = this.inferBrandKeywords(keywords);

    return {
      jobDescriptionId,
      title: jd.title || jd.name,
      keywords,
      targetLocations,
      minExperience,
      educationRequirements,
      industryKeywords,
      industryTags,
      brandKeywords,
      requiredRoles,
    };
  }

  buildContextFromKeywords(
    keywords: string[],
    location?: string,
  ): RuleScoringContext {
    const cleanKeywords = ensureKeywords(keywords);
    const normalizedLocation = location?.trim();
    const targetLocations = normalizedLocation ? [normalizedLocation] : [];
    const industryMap = getIndustryMap(this.skillsService);
    const industryTags = this.inferIndustryTags(cleanKeywords, industryMap);
    const brandKeywords = this.inferBrandKeywords(cleanKeywords);

    return {
      jobDescriptionId: "keyword-search",
      title: cleanKeywords.join(", "),
      keywords: cleanKeywords,
      targetLocations,
      minExperience: undefined,
      educationRequirements: [],
      industryKeywords: cleanKeywords,
      industryTags,
      brandKeywords,
      requiredRoles: this.inferRequiredRolesFromKeywords(cleanKeywords),
    };
  }

  inferRequiredRolesFromKeywords(keywords: string[]): RequiredRoleRequirement[] {
    const cleanKeywords = ensureKeywords(keywords);
    if (cleanKeywords.length === 0) {
      return [];
    }

    const normalizedTokens = new Set<string>();
    for (const keyword of cleanKeywords) {
      const variants = this.skillsService.expandQueryWithSynonyms([keyword]);
      const candidates = variants.length > 0 ? variants : [keyword];
      for (const candidate of candidates) {
        const normalized = compactText(candidate);
        if (!normalized) {
          continue;
        }
        normalizedTokens.add(normalized);
        normalizedTokens.add(normalized.replace(/\s+/g, ""));
      }
    }
    const normalizedTokenValues = Array.from(normalizedTokens);

    const matchedFamilies = Object.entries(KEYWORD_ROLE_SIGNAL_LIBRARY)
      .filter(([, signals]) => {
        return signals.some((signal) => {
          const normalizedSignal = compactText(signal);
          if (!normalizedSignal) {
            return false;
          }
          const compactSignal = normalizedSignal.replace(/\s+/g, "");
          return normalizedTokenValues.some((token) =>
            token.includes(normalizedSignal)
            || normalizedSignal.includes(token)
            || token.includes(compactSignal)
            || compactSignal.includes(token)
          );
        });
      });

    if (matchedFamilies.length !== 1) {
      return [];
    }

    const [type, signals] = matchedFamilies[0];
    return [{
      type,
      signals: ensureKeywords(signals),
      verifyIn: "workHistory",
    }];
  }

  private inferIndustryTags(tokens: string[], industryMap: Array<{ tag: string; keywords: string[] }>): string[] {
    return inferIndustryTagsForMap(tokens, industryMap);
  }

  private inferBrandKeywords(tokens: string[]): string[] {
    if (tokens.length === 0) {
      return [];
    }

    const normalizedTokens = tokens.map((token) => token.toLowerCase());
    const matches = new Set<string>();

    try {
      const patterns = this.skillsService.getCompanyPatterns();
      for (const pattern of patterns) {
        const aliases = pattern.allNames.map((name) => name.toLowerCase());
        const hasMatch = normalizedTokens.some((token) =>
          aliases.some((alias) => token.includes(alias) || alias.includes(token))
        );
        if (hasMatch) {
          matches.add(pattern.name.toLowerCase());
        }
      }
    } catch (error) {
      logger.error("[RuleScoring] Failed to infer brand keywords", error, { service: "rule-scoring" });
    }

    return Array.from(matches);
  }

  private resolveRoleSignal(
    index: ResumeIndex,
    role: RequiredRoleRequirement,
    roleSignals: RoleSignalSummary[]
  ): { signalCount: number; years: number; industryVerifiedYears: number } {
    const normalizedType = role.type.toLowerCase();
    const matched = roleSignals.find((signal) =>
      signal.type.toLowerCase() === normalizedType
      && signal.verifyIn === role.verifyIn
    );

    if (matched) {
      return {
        signalCount: matched.signalCount,
        years: matched.roleRelevantYears ?? matched.years,
        industryVerifiedYears:
          matched.industryVerifiedRelevantYears
          ?? matched.industryVerifiedYears
          ?? matched.roleRelevantYears
          ?? matched.years,
      };
    }

    const sourceText = role.verifyIn === "workHistory"
      ? (index.evidenceText || "")
      : index.searchText;
    if (!sourceText.trim()) {
      return { signalCount: 0, years: 0, industryVerifiedYears: 0 };
    }

    const normalizedText = sourceText.toLowerCase();
    const signalHits = role.signals.filter((signal) => normalizedText.includes(signal.toLowerCase()));
    return {
      signalCount: signalHits.length,
      years: 0,
      industryVerifiedYears: 0,
    };
  }

  private scoreRoleMatch(
    index: ResumeIndex,
    context: RuleScoringContext,
    roleSignals: RoleSignalSummary[],
  ): number {
    const weight = this.weights.categoryWeights.roleMatch;
    if (weight <= 0) {
      return 0;
    }
    if (!context.requiredRoles.length) {
      return weight;
    }

    const roleScores = context.requiredRoles.map((requiredRole) => {
      const roleSignal = this.resolveRoleSignal(index, requiredRole, roleSignals);
      if (roleSignal.signalCount <= 0) {
        return 0;
      }

      // Use industry-verified years for roles that require CNC industry experience
      const needsIndustryVerification = requiresIndustryVerification(requiredRole.type);
      const effectiveYears = needsIndustryVerification
        ? roleSignal.industryVerifiedYears
        : roleSignal.years;

      // Penalize if signals found but no industry-verified years for roles requiring verification
      if (needsIndustryVerification && roleSignal.industryVerifiedYears === 0) {
        // Role signals found but not in CNC industry - cap at low score
        return Math.round((2 / 10) * weight);
      }

      const baseline = roleSignal.signalCount >= 2 ? 10 : 5;
      const baselineScore = Math.round((baseline / 10) * weight);
      if (!requiredRole.minYears || requiredRole.minYears <= 0) {
        return baselineScore;
      }
      if (effectiveYears >= requiredRole.minYears) {
        return baselineScore;
      }

      const yearsRatio = Math.max(0, effectiveYears) / requiredRole.minYears;
      return Math.round(baselineScore * Math.max(0.2, Math.min(1, yearsRatio)));
    });

    if (roleScores.length === 0) {
      return 0;
    }

    const aggregate = roleScores.reduce((sum, value) => sum + value, 0) / roleScores.length;
    return Math.round(Math.max(0, Math.min(weight, aggregate)));
  }

  private computeRelevantRoleYears(
    requiredRoles: RequiredRoleRequirement[],
    roleSignals: RoleSignalSummary[]
  ): number {
    const matchedYears = requiredRoles
      .map((required) => {
        const matched = roleSignals.find(
          (signal) => signal.type.toLowerCase() === required.type.toLowerCase()
            && signal.verifyIn === required.verifyIn
        );
        if (!matched) return 0;
        return requiresIndustryVerification(required.type)
          ? (
              matched.industryVerifiedRelevantYears
              ?? matched.industryVerifiedYears
              ?? matched.roleRelevantYears
              ?? matched.years
            )
          : (matched.roleRelevantYears ?? matched.years);
      })
      .filter((years) => years > 0);

    return matchedYears.length > 0 ? Math.max(...matchedYears) : 0;
  }

  private applyRoleContext(
    rawRoleMatch: number,
    index: ResumeIndex,
    context: RuleScoringContext,
    skillMatch: number,
    experienceMatch: number,
  ): number {
    const roleWeight = this.weights.categoryWeights.roleMatch;
    const roleContext = this.weights.roleContext;
    if (!roleContext.enabled || roleWeight <= 0 || context.requiredRoles.length === 0) {
      return rawRoleMatch;
    }

    const capScore = Math.round(roleWeight * roleContext.capRatio);
    const roleMatch = Math.min(rawRoleMatch, Math.max(0, capScore));
    if (roleMatch > 0) {
      return roleMatch;
    }

    const floorScore = Math.round(roleWeight * roleContext.softGateFloorRatio);
    if (floorScore <= 0) {
      return roleMatch;
    }

    const hasSkillEvidence = skillMatch > 0;
    const hasExperienceEvidence =
      (typeof index.experienceYears === "number" && index.experienceYears > 0)
      || experienceMatch > 0;
    if (!hasSkillEvidence && !hasExperienceEvidence) {
      return roleMatch;
    }

    return Math.min(roleWeight, Math.max(roleMatch, floorScore));
  }

  scoreResume(
    index: ResumeIndex,
    context: RuleScoringContext,
    brandHits: BrandHit[] = [],
    roleSignals: RoleSignalSummary[] = [],
    market: KeywordMarket = "CN",
  ): RuleScoringResult {
    const categoryWeights = this.weights.categoryWeights;
    const keywordVariantMap = new Map<string, string[]>(
      context.keywords.map((keyword) => {
        const variants = this.skillsService.expandQueryWithSynonyms([keyword]);
        return [
          keyword,
          variants.length > 0 ? variants : [keyword],
        ];
      })
    );

    const industryKeywordVariantMap = new Map<string, string[]>(
      context.industryKeywords.map((keyword) => {
        const variants = this.skillsService.expandQueryWithSynonyms([keyword]);
        return [
          keyword,
          variants.length > 0 ? variants : [keyword],
        ];
      })
    );

    const scoringText = (index.evidenceText || "").toLowerCase();
    const scoringTokens = compactText(scoringText)
      .split(/\s+/)
      .filter((token) => token.length > 0);

    const matchedSkills = context.keywords.filter((keyword) => {
      const variants = keywordVariantMap.get(keyword) ?? [keyword];
      return variants.some((variant) =>
        scoringText.includes(variant) || index.skills.some((skill) => skill.includes(variant))
      );
    });

    const skillMatch = context.keywords.length > 0
      ? Math.round((matchedSkills.length / context.keywords.length) * categoryWeights.skillMatch)
      : 0;
    const rawRoleMatch = this.scoreRoleMatch(index, context, roleSignals);
    const hasRequiredRoles = context.requiredRoles.length > 0;

    let experienceMatch = 0;
    if (hasRequiredRoles) {
      const relevantRoleYears = this.computeRelevantRoleYears(context.requiredRoles, roleSignals);
      const effectiveMinExperience = context.minExperience ?? context.requiredRoles[0]?.minYears;

      if (effectiveMinExperience === undefined || effectiveMinExperience <= 0) {
        experienceMatch = relevantRoleYears > 0 ? categoryWeights.experienceMatch : 0;
      } else if (relevantRoleYears >= effectiveMinExperience) {
        experienceMatch = categoryWeights.experienceMatch;
      } else if (relevantRoleYears > 0) {
        const ratio = relevantRoleYears / Math.max(1, effectiveMinExperience);
        experienceMatch = Math.round(categoryWeights.experienceMatch * Math.min(1, ratio));
      } else {
        experienceMatch = 0;
      }
    } else if (context.minExperience === undefined) {
      experienceMatch = index.experienceYears === null
        ? Math.round((categoryWeights.experienceMatch * 8) / DEFAULT_WEIGHTS.categoryWeights.experienceMatch)
        : categoryWeights.experienceMatch;
    } else if (index.experienceYears !== null) {
      if (index.experienceYears >= context.minExperience) {
        experienceMatch = categoryWeights.experienceMatch;
      } else {
        const gap = context.minExperience - index.experienceYears;
        const perYearPenalty = Math.round((categoryWeights.experienceMatch * 5) / DEFAULT_WEIGHTS.categoryWeights.experienceMatch);
        experienceMatch = Math.max(0, categoryWeights.experienceMatch - Math.round(gap * perYearPenalty));
      }
    }
    const roleMatch = this.applyRoleContext(rawRoleMatch, index, context, skillMatch, experienceMatch);

    let educationMatch = 0;
    const resumeEducation = normalizeEducationLevel(index.educationLevel);
    const minEducationRank = getMinEducationRank(context.educationRequirements);
    if (!minEducationRank) {
      educationMatch = resumeEducation
        ? Math.round((categoryWeights.educationMatch * 10) / DEFAULT_WEIGHTS.categoryWeights.educationMatch)
        : 0;
    } else if (resumeEducation) {
      const rank = EDUCATION_RANK[resumeEducation] ?? 0;
      if (rank >= minEducationRank) {
        educationMatch = categoryWeights.educationMatch;
      } else {
        const perRankPenalty = Math.round((categoryWeights.educationMatch * 6) / DEFAULT_WEIGHTS.categoryWeights.educationMatch);
        educationMatch = Math.max(0, categoryWeights.educationMatch - (minEducationRank - rank) * perRankPenalty);
      }
    }

    const location = index.locationCity || "";
    const locationMatch = getLocationProximityScore(location, context.targetLocations, categoryWeights.locationMatch);

    const matchedCompanies = index.companies.filter((company) =>
      context.industryKeywords.some((keyword) => {
        const variants = industryKeywordVariantMap.get(keyword) ?? [keyword];
        return variants.some((variant) => company.toLowerCase().includes(variant));
      })
    );

    const matchedIndustryKeywords = context.industryKeywords.filter((keyword) => {
      const variants = industryKeywordVariantMap.get(keyword) ?? [keyword];
      return variants.some((variant) => scoringText.includes(variant));
    });
    const keywordRatioBase = Math.max(1, Math.min(context.industryKeywords.length, 10));
    const keywordRatio = matchedIndustryKeywords.length / keywordRatioBase;
    const localIndustryTags = inferIndustryTags(scoringTokens);
    const tagRatio = context.industryTags.length > 0
      ? localIndustryTags.filter((tag) => context.industryTags.includes(tag)).length / context.industryTags.length
      : 0;
    const industryRatio = Math.max(keywordRatio, tagRatio);
    const industryMatch = Math.round(Math.min(1, industryRatio) * categoryWeights.industryMatch);

    const normalizedBrandKeywords = (context.brandKeywords ?? [])
      .map((brand) => brand.toLowerCase())
      .filter((brand) => brand.length > 0);
    const scoringBrandHits = hasRequiredRoles
      ? brandHits.filter((hit) => hit.source === "workHistory")
      : brandHits;
    const hasBrandKeywordTargets = normalizedBrandKeywords.length > 0;
    const matchedBrandHits = hasBrandKeywordTargets
      ? scoringBrandHits.filter((hit) => normalizedBrandKeywords.includes(hit.brand.toLowerCase()))
      : scoringBrandHits;

    const contextWeights = hasBrandKeywordTargets
      ? this.weights.brandContextWithTarget
      : this.weights.brandContextNoTarget;

    // MY market: brandRelevance is 0 because industry DB data is CN-only
    const brandRelevance = market === "MY"
      ? 0
      : Math.min(
          categoryWeights.brandRelevance,
          matchedBrandHits.reduce((maxScore, hit) => {
            const baseWeight = contextWeights[hit.context] ?? 0;
            const roleMultiplier = this.weights.brandRoleMultipliers[hit.role] ?? 1;
            return Math.max(maxScore, Math.round(baseWeight * roleMultiplier));
          }, 0)
        );

    const rawScore = skillMatch + roleMatch + experienceMatch + educationMatch + locationMatch + industryMatch + brandRelevance;
    const score = Math.max(0, Math.min(100, rawScore));

    return {
      score,
      recommendation: this.recommendationFromScore(score),
      breakdown: {
        skillMatch,
        roleMatch,
        experienceMatch,
        educationMatch,
        locationMatch,
        industryMatch,
        brandRelevance,
      },
      brandContext: matchedBrandHits,
      matchedSkills,
      matchedCompanies,
    };
  }

  scoreBatch(indexes: ResumeIndex[], context: RuleScoringContext): Array<{ resumeId: string; result: RuleScoringResult }> {
    return indexes.map((index) => ({
      resumeId: index.resumeId,
      result: this.scoreResume(index, context),
    }));
  }

  toMatchingResult(result: RuleScoringResult): MatchingResult {
    const highlights: string[] = [];
    const concerns: string[] = [];
    const formatBrands = (brands: Set<string>): string =>
      Array.from(brands).slice(0, 3).map((brand) => brand.toUpperCase()).join("、");

    if (result.matchedSkills.length > 0) {
      highlights.push(`命中关键词: ${result.matchedSkills.slice(0, 6).join("、")}`);
    }
    if (result.breakdown.roleMatch >= 8) {
      highlights.push("岗位职能经历匹配");
    } else if (result.breakdown.roleMatch === 0) {
      concerns.push("缺少目标岗位职能经历");
    }
    if (result.breakdown.experienceMatch >= 20) {
      highlights.push("经验与职位要求匹配");
    } else {
      concerns.push("经验与职位要求存在差距");
    }
    if (result.breakdown.educationMatch >= 12) {
      highlights.push("学历满足岗位门槛");
    } else {
      concerns.push("学历匹配度偏低");
    }
    if (result.breakdown.locationMatch === 0) {
      concerns.push("工作地点可能不匹配");
    }
    if (result.matchedCompanies.length > 0) {
      highlights.push(`相关公司经历: ${result.matchedCompanies.slice(0, 3).join("、")}`);
    }
    if (Array.isArray(result.brandContext) && result.brandContext.length > 0) {
      const employerBrands = new Set(
        result.brandContext
          .filter((item) => item.context === "employer")
          .map((item) => item.brand)
      );
      const salesBrands = new Set(
        result.brandContext
          .filter((item) => item.context === "sales")
          .map((item) => item.brand)
      );
      const equipmentBrands = new Set(
        result.brandContext
          .filter((item) => item.context === "equipment")
          .map((item) => item.brand)
      );

      if (employerBrands.size > 0) {
        highlights.push(`品牌雇主经历: ${formatBrands(employerBrands)}`);
      }
      if (salesBrands.size > 0) {
        highlights.push(`品牌销售经验: ${formatBrands(salesBrands)}`);
      }
      if (equipmentBrands.size > 0) {
        highlights.push(`品牌设备经验: ${formatBrands(equipmentBrands)}`);
      }
    }

    return {
      score: result.score,
      recommendation: result.recommendation,
      highlights,
      concerns,
      summary: `规则评分 ${result.score} 分，技能匹配 ${result.breakdown.skillMatch}/${this.weights.categoryWeights.skillMatch}，岗位匹配 ${result.breakdown.roleMatch}/${this.weights.categoryWeights.roleMatch}，经验 ${result.breakdown.experienceMatch}/${this.weights.categoryWeights.experienceMatch}，品牌相关 ${result.breakdown.brandRelevance}/${this.weights.categoryWeights.brandRelevance}。`,
      breakdown: result.breakdown,
      matchedSkills: result.matchedSkills,
      matchedCompanies: result.matchedCompanies,
      scoreSource: "rule",
    };
  }
}

export const ruleScoringService = new RuleScoringService();
