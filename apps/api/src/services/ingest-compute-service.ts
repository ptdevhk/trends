import {
  buildLatestWorkHistoryEvidence,
  buildWorkHistoryEntryText,
  computeVerifiedRoleYears,
  formatLocationHierarchySearchText,
  normalizeResumeLocationHierarchy,
  normalizeWorkHistoryEntry,
  selectLatestWorkHistory,
} from "@trends/shared";

import { IndustryDataService } from "./industry-data-service.js";
import { normalizeCompanyPatternIdentifier, SkillsKnowledgeService } from "./skills-knowledge.js";
import { JobDescriptionService } from "./job-description-service.js";
import { RuleScoringService, type MatchedWorkEntry, type RoleSignalSummary } from "./rule-scoring.js";
import { resolveResumeId } from "./resume-id.js";
import { computeEntryRoleYears, computeWorkHistoryYears, extractCompanyFromWorkHistory } from "./work-history.js";
import type { ResumeItem, ResumeWorkHistoryItem } from "../types/resume.js";
import type { ResumeIndex } from "./resume-index.js";

export interface IngestInput {
  resumeId: string;
  content: unknown;  // raw crawler JSON
}

export type BrandContext = "employer" | "equipment" | "sales" | "technical" | "general";

export interface BrandHit {
  brand: string;
  role: "employer" | "equipment" | "both";
  source: "workHistory" | "selfIntro" | "jobIntention";
  context: BrandContext;
  companyId?: number;
}

export interface IndustryDbV2RawComponents {
  companyScore: number;
  brandScore: number;
  weightedBrandUnits: number;
  uniqueCompanies: number;
  brandUnitCount: number;
}

export interface IngestResult {
  resumeId: string;
  evidenceText: string;
  industryTags: string[];
  synonymHits: string[];
  brandHits: BrandHit[];
  companyHits: string[];
  industryDbV2Raw: number;
  industryDbV2RawComponents: IndustryDbV2RawComponents;
  roleSignals: RoleSignalSummary[];
  verifiedRoleYears: Record<string, number>;
  taggingEnvelope: TaggingEnvelope;
  companyPatternAliasTokens: string;
  ruleScores: Record<string, number>;  // jdId → score (0-100)
  primaryRuleScore: number;
  experienceLevel: string;
  computedAt: number;
  skillsVersion: number;
}

export type TaggingProvenanceStage =
  | "industry_taxonomy"
  | "synonym_expansion"
  | "company_pattern_match"
  | "role_signal_aggregation"
  | "experience_signal_detection"
  | "derived";

export interface TaggingEnvelopeEntry {
  tag: string;
  source: "rule" | "ai";
  confidence: number;
  version: number;
  provenance: {
    stage: TaggingProvenanceStage;
    generatedBy: "ingest-compute-service";
    evidence: string[];
  };
}

export interface TaggingEnvelope {
  schemaVersion: number;
  generatedAt: number;
  entries: TaggingEnvelopeEntry[];
}

interface VerifiedEmployerMatch {
  key: string;
  companyId: number;
  companyNameCn: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toWorkHistory(value: unknown): ResumeWorkHistoryItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeWorkHistoryEntry(item))
    .filter((item): item is ResumeWorkHistoryItem => item !== null);
}

function toOptionalId(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function toResumeItem(value: unknown): ResumeItem | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    name: toStringValue(value.name),
    profileUrl: toStringValue(value.profileUrl),
    source: toStringValue(value.source) || undefined,
    activityStatus: toStringValue(value.activityStatus),
    age: toStringValue(value.age),
    experience: toStringValue(value.experience),
    education: toStringValue(value.education),
    location: toStringValue(value.location),
    locationHierarchy: normalizeResumeLocationHierarchy(value),
    selfIntro: toStringValue(value.selfIntro),
    jobIntention: toStringValue(value.jobIntention),
    expectedSalary: toStringValue(value.expectedSalary),
    workHistory: toWorkHistory(value.workHistory),
    projectExperience: toWorkHistory(value.projectExperience),
    extractedAt: toStringValue(value.extractedAt),
    resumeId: toStringValue(value.resumeId) || undefined,
    perUserId: toOptionalId(value.perUserId),
    profileId: toOptionalId(value.profileId),
    profileType: toStringValue(value.profileType) || undefined,
    externalId: toStringValue(value.externalId) || undefined,
  };
}

function hasResumeSignal(item: ResumeItem): boolean {
  return Boolean(
    item.name
    || item.jobIntention
    || item.selfIntro
    || item.profileUrl
    || item.source
    || item.resumeId
    || item.perUserId
    || item.profileId
    || item.externalId
    || item.workHistory.length > 0
    || item.projectExperience?.length
  );
}

function extractResumeItem(content: unknown): ResumeItem {
  if (isRecord(content) && Array.isArray(content.data) && content.data.length > 0) {
    const item = toResumeItem(content.data[0]);
    if (item && hasResumeSignal(item)) {
      return item;
    }
  }

  const directItem = toResumeItem(content);
  if (directItem && hasResumeSignal(directItem)) {
    return directItem;
  }

  throw new Error("Invalid resume content: expected ResumeItem or { data: ResumeItem[] }");
}

function normalizeText(value: string | undefined): string {
  return (value || "")
    .replace(/[\u3000\s]+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeEducationLevel(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (/博士|phd/i.test(normalized)) return "phd";
  if (/硕士|研究生|master/i.test(normalized)) return "master";
  if (/本科|bachelor/i.test(normalized)) return "bachelor";
  if (/大专|专科|associate/i.test(normalized)) return "associate";
  if (/高中|中专|中技|high school/i.test(normalized)) return "high_school";
  return null;
}

function parseSalaryRange(value: string): { min?: number; max?: number } | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, "").toLowerCase();
  if (!normalized || /面议/.test(normalized)) return null;

  const match = normalized.match(/(\d+(?:\.\d+)?)(?:[-~到至](\d+(?:\.\d+)?))?/);
  if (!match) return null;

  let min = Number(match[1]);
  let max = match[2] ? Number(match[2]) : undefined;
  if (Number.isNaN(min)) return null;

  if (/[k千]/.test(normalized)) {
    min *= 1000;
    if (max !== undefined) max *= 1000;
  }
  if (/万/.test(normalized)) {
    min *= 10000;
    if (max !== undefined) max *= 10000;
  }

  return { min, max };
}

function extractCompanies(workHistory: ResumeWorkHistoryItem[]): string[] {
  if (!workHistory.length) return [];

  const companies: string[] = [];
  for (const item of workHistory) {
    const company = extractCompanyFromWorkHistory(item);
    if (company) {
      companies.push(company);
    }
  }

  return Array.from(new Set(companies)).slice(0, 20);
}

function getLatestWorkHistory(workHistory: ResumeWorkHistoryItem[] | undefined): ResumeWorkHistoryItem[] {
  return selectLatestWorkHistory(workHistory ?? []);
}

function createSearchText(item: ResumeItem): string {
  const locationText = formatLocationHierarchySearchText(item.locationHierarchy) || item.location || "";
  const latestWorkHistory = getLatestWorkHistory(item.workHistory);
  const latestProjectExperience = getLatestWorkHistory(item.projectExperience ?? []);
  const parts = [
    item.name,
    item.education,
    locationText,
    item.expectedSalary,
    ...latestWorkHistory.map((entry) => buildWorkHistoryEntryText(entry)),
    ...latestProjectExperience.map((entry) => buildWorkHistoryEntryText(entry)),
  ];

  return normalizeText(parts.join(" "));
}

function inferTaggingStage(tag: string): TaggingProvenanceStage {
  if (tag.startsWith("industry:")) {
    return "industry_taxonomy";
  }
  if (tag.startsWith("synonym:")) {
    return "synonym_expansion";
  }
  if (tag.startsWith("company:") || tag.startsWith("brand:")) {
    return "company_pattern_match";
  }
  if (tag.startsWith("role:")) {
    return "role_signal_aggregation";
  }
  if (tag.startsWith("experience:")) {
    return "experience_signal_detection";
  }
  return "derived";
}

function computeIndustryDbV2Raw(
  companyHits: string[],
  brandHits: BrandHit[]
): { raw: number; components: IndustryDbV2RawComponents } {
  const uniqueCompanies = Array.from(
    new Set(
      companyHits
        .map((company) => company.trim().toLowerCase())
        .filter((company) => company.length > 0)
    )
  );

  const companyScore = Math.min(
    INDUSTRY_DB_V2_COMPANY_SCORE_CAP,
    uniqueCompanies.length * INDUSTRY_DB_V2_COMPANY_SCORE_PER_HIT
  );

  const dedupedBrandKeys = new Set<string>();
  let weightedBrandUnits = 0;
  let brandUnitCount = 0;

  for (const hit of brandHits) {
    if (hit.context === "employer") {
      continue;
    }

    const brand = hit.brand.trim().toLowerCase();
    if (!brand) {
      continue;
    }

    const dedupeKey = `${brand}|${hit.context}`;
    if (dedupedBrandKeys.has(dedupeKey)) {
      continue;
    }
    dedupedBrandKeys.add(dedupeKey);

    const weight = INDUSTRY_DB_V2_CONTEXT_WEIGHTS[hit.context];
    if (typeof weight !== "number") {
      continue;
    }

    weightedBrandUnits += weight;
    brandUnitCount += 1;
  }

  const roundedWeightedBrandUnits = Number(weightedBrandUnits.toFixed(2));
  const brandScore = Math.min(
    INDUSTRY_DB_V2_BRAND_SCORE_CAP,
    Number((roundedWeightedBrandUnits * INDUSTRY_DB_V2_BRAND_SCORE_PER_UNIT).toFixed(2))
  );
  const raw = Math.min(
    INDUSTRY_DB_V2_TOTAL_CAP,
    Number((companyScore + brandScore).toFixed(2))
  );

  return {
    raw,
    components: {
      companyScore,
      brandScore,
      weightedBrandUnits: roundedWeightedBrandUnits,
      uniqueCompanies: uniqueCompanies.length,
      brandUnitCount,
    },
  };
}

const BRAND_CONTEXT_WINDOW = 30;
const EQUIPMENT_SIGNALS = ["操作", "使用", "熟练", "熟悉", "机台", "机型", "设备", "机床"];
const SALES_SIGNALS = ["销售", "代理", "渠道", "推广", "业务"];
const TECHNICAL_SIGNALS = ["维修", "调试", "编程", "安装", "保养", "维护"];
const INDUSTRY_DB_V2_COMPANY_SCORE_PER_HIT = 10;
const INDUSTRY_DB_V2_COMPANY_SCORE_CAP = 20;
const INDUSTRY_DB_V2_BRAND_SCORE_PER_UNIT = 10;
const INDUSTRY_DB_V2_BRAND_SCORE_CAP = 30;
const INDUSTRY_DB_V2_TOTAL_CAP = 50;
const INDUSTRY_DB_V2_CONTEXT_WEIGHTS: Record<Exclude<BrandContext, "employer">, number> = {
  sales: 1,
  equipment: 0.8,
  technical: 0.6,
  general: 0.3,
};
const DEFAULT_SALES_DIRECT_TITLE_SIGNALS = [
  "销售工程师",
  "销售经理",
  "销售主管",
  "业务拓展",
  "业务开发",
  "sales engineer",
  "sales manager",
  "account manager",
  "key account manager",
  "business development manager",
  "channel manager",
  "channel sales",
];
const DEFAULT_SALES_CONTEXT_SIGNALS = [
  "销售",
  "业务开发",
  "大客户",
  "渠道",
  "sales",
  "account",
  "business development",
  "bd",
];
const DEFAULT_ROLE_SIGNAL_LIBRARY: Record<string, string[]> = {
  sales: Array.from(new Set([...DEFAULT_SALES_DIRECT_TITLE_SIGNALS, ...DEFAULT_SALES_CONTEXT_SIGNALS])),
  engineer: ["工程师", "设计", "研发", "开发", "编程", "调试", "维修", "技术", "engineer", "developer", "design"],
};
const ROLE_SIGNAL_MATCH_WEIGHTS = {
  jobTitle: 2,
  description: 1,
  raw: 1,
} as const;
const AUXILIARY_CONTEXT_PREFIXES = ["配合", "协助", "辅助", "支持", "协同"];
const AUXILIARY_CONTEXT_WINDOW = 10;
const COMPANY_BOILERPLATE_PATTERNS = [
  /公司(致力于|主要|主营|专注于|是一家|集[^。；，]*于一体)/,
  /(研发|设计|开发).{0,12}(生产|制造).{0,12}销售/,
  /(生产|制造).{0,12}销售.{0,12}(服务|研发|设计|开发)/,
];
const DIRECT_SALES_DUTY_CUES = [
  "客户",
  "渠道",
  "订单",
  "回款",
  "报价",
  "开拓",
  "拓展",
  "拜访",
  "维护",
  "成交",
  "合同",
  "经销",
  "代理商",
  "经销商",
  "大客户",
];

type RoleSignalMatchSource = "jobTitle" | "description" | "raw";

interface RoleSignalMatch {
  key: string;
  label: string;
  weight: number;
  source: RoleSignalMatchSource;
}

function resolveRoleYearsAnchor(item: ResumeItem): Date {
  const extractedAt = item.extractedAt ? Date.parse(item.extractedAt) : Number.NaN;
  if (Number.isFinite(extractedAt)) {
    return new Date(extractedAt);
  }
  return new Date();
}

/**
 * Build a single ResumeIndex from a ResumeItem
 * (extracted helper from ResumeIndexService.buildIndex)
 */
export function buildResumeIndex(item: ResumeItem, index: number): ResumeIndex {
  const resumeId = resolveResumeId(item, index);
  const latestWorkHistory = getLatestWorkHistory(item.workHistory);
  const searchText = createSearchText(item);
  const companies = extractCompanies(latestWorkHistory);
  const evidenceText = buildLatestWorkHistoryEvidence(latestWorkHistory).text;
  const roleYearsAnchor = resolveRoleYearsAnchor(item);

  // For ingest compute, we don't need full skill extraction
  // We just need the basic fields for rule scoring
  return {
    resumeId,
    experienceYears: computeWorkHistoryYears(latestWorkHistory, roleYearsAnchor),
    educationLevel: normalizeEducationLevel(item.education),
    locationCity: item.locationHierarchy?.city
      || item.locationHierarchy?.province
      || item.locationHierarchy?.country
      || item.location
      || null,
    evidenceText,
    skills: [],  // Not needed for ingest - skills are in searchText
    companies,
    industryTags: [],  // Will be computed separately
    salaryRange: parseSalaryRange(item.expectedSalary),
    searchText,
  };
}

export class IngestComputeService {
  private readonly ruleScoringService: RuleScoringService;
  private readonly skillsKnowledgeService: SkillsKnowledgeService;
  private readonly jobDescriptionService: JobDescriptionService;
  private readonly industryDataService: IndustryDataService;
  private readonly projectRoot?: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot;
    this.ruleScoringService = new RuleScoringService(projectRoot);
    this.skillsKnowledgeService = new SkillsKnowledgeService(projectRoot);
    this.jobDescriptionService = new JobDescriptionService(projectRoot);
    this.industryDataService = new IndustryDataService(projectRoot);
  }

  /**
   * Compute ingest data for a single resume
   */
  computeOne(resumeId: string, content: unknown): IngestResult {
    const item = extractResumeItem(content);
    const index = buildResumeIndex(item, 0);
    const searchText = index.searchText.toLowerCase();
    // Strict-mode contract: industryTags / synonymHits / experienceLevel must
    // only be derived from workHistory evidence, not from name/education/
    // location/expectedSalary/jobIntention/selfIntro/projectExperience. Keep
    // `searchText` for field-aware brandHits matching which still needs the
    // broader context.
    const evidenceText = (index.evidenceText || "").toLowerCase();
    const computedAt = Date.now();

    // 1. Compute industryTags
    const industryTags = this.computeIndustryTags(evidenceText);

    // 2. Compute synonymHits
    const synonymHits = this.computeSynonymHits(evidenceText);

    // 3. Compute field-aware brandHits, then derive companyHits for backward compatibility
    const latestWorkHistory = getLatestWorkHistory(item.workHistory);
    const verifiedEmployers = this.collectVerifiedEmployerMatches(latestWorkHistory);
    const brandHits = this.computeBrandHits(latestWorkHistory, index.companies, searchText, verifiedEmployers);
    const companyHits = verifiedEmployers.map((m) => m.key);
    const { raw: industryDbV2Raw, components: industryDbV2RawComponents } = computeIndustryDbV2Raw(
      companyHits,
      brandHits
    );
    const roleYearsAnchor = resolveRoleYearsAnchor(item);
    const roleSignals = this.computeRoleSignals(latestWorkHistory, roleYearsAnchor);
    const companyPatternAliasTokens = this.buildCompanyAliasTokens(companyHits, brandHits);

    // 4. Compute ruleScores for all active JDs
    const ruleScores = this.computeRuleScores(index, brandHits, roleSignals);
    const scoreValues = Object.values(ruleScores);
    const primaryRuleScore = scoreValues.length > 0 ? Math.max(...scoreValues) : 0;

    // 5. Compute experienceLevel
    const experienceLevel = this.computeExperienceLevel(evidenceText);

    // 6. Get skills version
    const skillsVersion = this.skillsKnowledgeService.getVersion();
    const taggingEnvelope = this.buildTaggingEnvelope(
      industryTags,
      synonymHits,
      companyHits,
      brandHits,
      roleSignals,
      experienceLevel,
      skillsVersion,
      computedAt,
    );

    return {
      resumeId,
      evidenceText: index.evidenceText || "",
      industryTags,
      synonymHits,
      brandHits,
      companyHits,
      industryDbV2Raw,
      industryDbV2RawComponents,
      roleSignals,
      verifiedRoleYears: computeVerifiedRoleYears(roleSignals),
      taggingEnvelope,
      companyPatternAliasTokens,
      ruleScores,
      primaryRuleScore,
      experienceLevel,
      computedAt,
      skillsVersion,
    };
  }

  /**
   * Compute ingest data for multiple resumes (batch)
   */
  computeBatch(inputs: IngestInput[]): IngestResult[] {
    this.skillsKnowledgeService.clearCache();
    return inputs.map((input) => this.computeOne(input.resumeId, input.content));
  }

  /**
   * Compute industry tags from searchText using skills.md taxonomy
   */
  private computeIndustryTags(searchText: string): string[] {
    const taxonomy = this.skillsKnowledgeService.getIndustryTaxonomy();
    const tags: string[] = [];

    for (const domain of taxonomy) {
      const hasKeyword = domain.keywords.some((keyword) =>
        searchText.includes(keyword.toLowerCase())
      );
      if (hasKeyword) {
        tags.push(domain.displayName);
      }
    }

    return tags;
  }

  /**
   * Compute synonym hits from searchText using skills.md synonym table
   */
  private computeSynonymHits(searchText: string): string[] {
    const synonymTable = this.skillsKnowledgeService.getSynonymTable();
    const matchedTerms: string[] = [];

    for (const [variant] of synonymTable.entries()) {
      if (searchText.includes(variant.toLowerCase())) {
        matchedTerms.push(variant);
      }
    }

    if (matchedTerms.length === 0) {
      return [];
    }

    return this.skillsKnowledgeService.expandQueryWithSynonyms(matchedTerms);
  }

  /**
   * Compute rule scores for all active JDs
   */
  private computeRuleScores(
    index: ResumeIndex,
    brandHits: BrandHit[],
    roleSignals: RoleSignalSummary[],
  ): Record<string, number> {
    const jds = this.jobDescriptionService.listFiles().filter((jd) => jd.status === "active");
    const scores: Record<string, number> = {};

    for (const jd of jds) {
      try {
        const context = this.ruleScoringService.buildContext(jd.name);
        const result = this.ruleScoringService.scoreResume(index, context, brandHits, roleSignals);
        scores[jd.id] = result.score;
      } catch (error) {
        // Log error but don't fail the whole batch
        console.error(`Failed to score resume against JD ${jd.name}:`, error);
        scores[jd.id] = 0;
      }
    }

    return scores;
  }


  private getRoleSignalLibrary(): Record<string, string[]> {
    const salesDirectTitleSignals = this.getSalesDirectTitleSignals();
    const salesPolicy = this.skillsKnowledgeService.getRoleSignalPolicy().sales;
    const salesSignals = Array.from(new Set([
      ...salesDirectTitleSignals,
      ...(salesPolicy?.contextSignals ?? DEFAULT_SALES_CONTEXT_SIGNALS),
    ]))
      .map((signal) => signal.trim().toLowerCase())
      .filter((signal) => signal.length > 0);

    return {
      ...DEFAULT_ROLE_SIGNAL_LIBRARY,
      sales: salesSignals.length > 0 ? salesSignals : DEFAULT_ROLE_SIGNAL_LIBRARY.sales,
    };
  }

  private getSalesDirectTitleSignals(): string[] {
    const salesPolicy = this.skillsKnowledgeService.getRoleSignalPolicy().sales;
    const configured = (salesPolicy?.directTitleSignals ?? DEFAULT_SALES_DIRECT_TITLE_SIGNALS)
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0);
    return configured.length > 0 ? configured : DEFAULT_SALES_DIRECT_TITLE_SIGNALS;
  }

  private getSalesAuxiliaryPrefixes(): string[] {
    const salesPolicy = this.skillsKnowledgeService.getRoleSignalPolicy().sales;
    const configured = (salesPolicy?.auxiliaryPrefixes ?? AUXILIARY_CONTEXT_PREFIXES)
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0);
    return configured.length > 0 ? configured : AUXILIARY_CONTEXT_PREFIXES;
  }

  private getSalesDirectDutyCues(): string[] {
    const salesPolicy = this.skillsKnowledgeService.getRoleSignalPolicy().sales;
    const configured = (salesPolicy?.directDutyCues ?? DIRECT_SALES_DUTY_CUES)
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0);
    return configured.length > 0 ? configured : DIRECT_SALES_DUTY_CUES;
  }

  private isJobTitleBoilerplate(jobTitle: string): boolean {
    const normalized = jobTitle.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return COMPANY_BOILERPLATE_PATTERNS.some((pattern) => pattern.test(normalized));
  }
  private hasDirectRoleEvidence(
    roleType: string,
    matchedSignals: RoleSignalMatch[],
    entry: ResumeWorkHistoryItem,
    workHistoryText: string,
    salesDirectTitleSignals: string[],
  ): boolean {
    if (roleType !== "sales") {
      return true;
    }

    const normalizedEntry = normalizeWorkHistoryEntry(entry);
    const normalizedJobTitle = normalizeText(normalizedEntry?.jobTitle);

    // When the jobTitle field is actually a company boilerplate description
    // (e.g. "公司致力于各类通信产品的研发、制造和销售"), signal matches
    // found in it should NOT be treated as direct job-title matches.
    const jobTitleIsBoilerplate = normalizedJobTitle
      ? this.isJobTitleBoilerplate(normalizedJobTitle)
      : false;

    if (
      matchedSignals.some((signal) => signal.source === "jobTitle")
      && !jobTitleIsBoilerplate
    ) {
      return true;
    }

    if (normalizedJobTitle && !jobTitleIsBoilerplate) {
      return false;
    }

    const rawText = normalizeText(normalizedEntry?.raw || workHistoryText);
    if (!rawText) {
      return false;
    }

    return salesDirectTitleSignals.some((signal) => rawText.includes(signal));
  }

  private computeRoleSignals(workHistory: ResumeWorkHistoryItem[], anchorDate: Date): RoleSignalSummary[] {
    if (!Array.isArray(workHistory) || workHistory.length === 0) {
      return [];
    }
    const roleSignalLibrary = this.getRoleSignalLibrary();
    const salesDirectTitleSignals = this.getSalesDirectTitleSignals();
    const salesAuxiliaryPrefixes = this.getSalesAuxiliaryPrefixes();
    const salesDirectDutyCues = this.getSalesDirectDutyCues();

    const roleSignalAccumulators = new Map<string, {
      signals: Map<string, { label: string; weight: number }>;
      occurrences: number;
      years: number;
      industryVerifiedYears: number;
      roleRelevantYears: number;
      industryVerifiedRelevantYears: number;
      matchedWorkEntries: MatchedWorkEntry[];
    }>();

    for (const entry of workHistory) {
      const workHistoryText = buildWorkHistoryEntryText(entry);
      if (!workHistoryText) {
        continue;
      }

      const normalizedEntry = normalizeWorkHistoryEntry(entry);
      const years = Number(computeEntryRoleYears(entry, anchorDate).toFixed(2));

      const companyName = normalizedEntry?.companyName || extractCompanyFromWorkHistory(entry) || undefined;
      const jobTitle = normalizedEntry?.jobTitle || undefined;
      const industryVerification = this.industryDataService.verifyCompanyIndustry(companyName || "");

      for (const [roleType, signals] of Object.entries(roleSignalLibrary)) {
        const matchedSignals = this.resolveRoleSignalMatches(entry, workHistoryText, signals);
        if (matchedSignals.length === 0) {
          continue;
        }

        const hasJobTitleMatch = matchedSignals.some((signal) => signal.source === "jobTitle");
        const normalizedEntry = normalizeWorkHistoryEntry(entry);
        const normalizedJobTitle = normalizeText(normalizedEntry?.jobTitle);
        const jobTitleIsBoilerplate = normalizedJobTitle
          ? this.isJobTitleBoilerplate(normalizedJobTitle)
          : false;
        // When the jobTitle is a company boilerplate description (e.g.
        // "公司致力于各类通信产品的研发、制造和销售"), signal matches from
        // it should NOT be treated as genuine job-title matches for the
        // auxiliary-context and boilerplate-skip gates.
        const hasGenuineJobTitleMatch = hasJobTitleMatch && !jobTitleIsBoilerplate;
        if (
          !hasGenuineJobTitleMatch
          && matchedSignals.length === 1
          && this.isAuxiliaryContextMatch(
            entry,
            workHistoryText,
            matchedSignals[0],
            roleType === "sales" ? salesAuxiliaryPrefixes : AUXILIARY_CONTEXT_PREFIXES,
          )
        ) {
          continue;
        }

        if (
          roleType === "sales"
          && !jobTitleIsBoilerplate
          && this.isGenericCompanyBoilerplateMatch(
            entry,
            workHistoryText,
            matchedSignals,
            salesDirectDutyCues,
          )
        ) {
          continue;
        }
        const directRoleMatch = this.hasDirectRoleEvidence(
          roleType,
          matchedSignals,
          entry,
          workHistoryText,
          salesDirectTitleSignals,
        );

        const existing = roleSignalAccumulators.get(roleType) ?? {
          signals: new Map<string, { label: string; weight: number }>(),
          occurrences: 0,
          years: 0,
          industryVerifiedYears: 0,
          roleRelevantYears: 0,
          industryVerifiedRelevantYears: 0,
          matchedWorkEntries: [],
        };

        matchedSignals.forEach((signal) => {
          const current = existing.signals.get(signal.key);
          if (!current || signal.weight > current.weight) {
            existing.signals.set(signal.key, { label: signal.label, weight: signal.weight });
          }
        });
        existing.occurrences += 1;
        existing.years += years;
        if (directRoleMatch) {
          existing.roleRelevantYears += years;
        }

        if (industryVerification.verified) {
          existing.industryVerifiedYears += years;
          if (directRoleMatch) {
            existing.industryVerifiedRelevantYears += years;
          }
        }

        existing.matchedWorkEntries.push({
          companyName,
          jobTitle,
          years,
          industryVerified: industryVerification.verified,
          matchedSignals: matchedSignals.map((signal) => signal.label),
          directRoleMatch,
        });

        roleSignalAccumulators.set(roleType, existing);
      }
    }

    return Array.from(roleSignalAccumulators.entries()).map(([type, value]) => ({
      type,
      matchedSignals: Array.from(value.signals.values()).map((signal) => signal.label),
      signalCount: Array.from(value.signals.values()).reduce((total, signal) => total + signal.weight, 0),
      occurrences: value.occurrences,
      years: Number(value.years.toFixed(2)),
      industryVerifiedYears: Number(value.industryVerifiedYears.toFixed(2)),
      roleRelevantYears: Number(value.roleRelevantYears.toFixed(2)),
      industryVerifiedRelevantYears: Number(value.industryVerifiedRelevantYears.toFixed(2)),
      matchedWorkEntries: value.matchedWorkEntries,
      verifyIn: "workHistory",
    }));
  }

  private resolveRoleSignalMatches(
    entry: ResumeWorkHistoryItem,
    workHistoryText: string,
    signals: string[],
  ): RoleSignalMatch[] {
    const normalizedEntry = normalizeWorkHistoryEntry(entry);
    const jobTitleText = normalizeText(normalizedEntry?.jobTitle);
    const descriptionText = normalizeText(normalizedEntry?.description);
    const rawText = normalizeText(normalizedEntry?.raw || workHistoryText);
    const matches = new Map<string, RoleSignalMatch>();

    for (const signal of signals) {
      const normalizedSignal = signal.toLowerCase();
      let weight = 0;
      let source: RoleSignalMatchSource | null = null;

      if (jobTitleText.includes(normalizedSignal)) {
        weight = ROLE_SIGNAL_MATCH_WEIGHTS.jobTitle;
        source = "jobTitle";
      } else if (descriptionText.includes(normalizedSignal)) {
        weight = ROLE_SIGNAL_MATCH_WEIGHTS.description;
        source = "description";
      } else if (rawText.includes(normalizedSignal)) {
        weight = ROLE_SIGNAL_MATCH_WEIGHTS.raw;
        source = "raw";
      }

      if (weight <= 0 || source === null) {
        continue;
      }

      matches.set(normalizedSignal, {
        key: normalizedSignal,
        label: signal,
        weight,
        source,
      });
    }

    return Array.from(matches.values()).sort((left, right) => right.weight - left.weight);
  }

  private isAuxiliaryContextMatch(
    entry: ResumeWorkHistoryItem,
    workHistoryText: string,
    signal: RoleSignalMatch,
    auxiliaryPrefixes: string[],
  ): boolean {
    if (signal.source === "jobTitle") {
      return false;
    }

    const normalizedEntry = normalizeWorkHistoryEntry(entry);
    const sourceText = signal.source === "description"
      ? normalizeText(normalizedEntry?.description)
      : normalizeText(normalizedEntry?.raw || workHistoryText);

    if (!sourceText) {
      return false;
    }

    let matchIndex = sourceText.indexOf(signal.key);
    let foundMatch = false;

    while (matchIndex !== -1) {
      foundMatch = true;
      const contextWindow = sourceText.slice(Math.max(0, matchIndex - AUXILIARY_CONTEXT_WINDOW), matchIndex);
      const hasAuxiliaryPrefix = auxiliaryPrefixes.some((prefix) => contextWindow.includes(prefix));
      if (!hasAuxiliaryPrefix) {
        return false;
      }

      matchIndex = sourceText.indexOf(signal.key, matchIndex + signal.key.length);
    }

    return foundMatch;
  }

  private isGenericCompanyBoilerplateMatch(
    entry: ResumeWorkHistoryItem,
    workHistoryText: string,
    matchedSignals: RoleSignalMatch[],
    directSalesDutyCues: string[],
  ): boolean {
    // When the jobTitle is a boilerplate description, treat signal matches
    // from it as if they came from raw text (not genuine job-title matches).
    const normalizedEntry = normalizeWorkHistoryEntry(entry);
    const normalizedJobTitle = normalizeText(normalizedEntry?.jobTitle);
    const jobTitleIsBoilerplate = normalizedJobTitle
      ? this.isJobTitleBoilerplate(normalizedJobTitle)
      : false;

    if (matchedSignals.some((signal) => signal.source === "jobTitle" && !jobTitleIsBoilerplate)) {
      return false;
    }

    if (matchedSignals.length !== 1) {
      return false;
    }

    const sourceTexts = Array.from(new Set(
      matchedSignals.map((signal) => {
        if (signal.source === "description") {
          return normalizeText(normalizedEntry?.description);
        }

        return normalizeText(normalizedEntry?.raw || workHistoryText);
      }).filter((value) => value.length > 0)
    ));

    if (sourceTexts.length === 0) {
      return false;
    }

    return sourceTexts.some((sourceText) => {
      const hasDirectSalesDutyCue = directSalesDutyCues.some((cue) => sourceText.includes(cue));
      if (hasDirectSalesDutyCue) {
        return false;
      }

      return COMPANY_BOILERPLATE_PATTERNS.some((pattern) => pattern.test(sourceText));
    });
  }

  private upsertTaggingEnvelopeEntry(
    entryMap: Map<string, TaggingEnvelopeEntry>,
    tag: string,
    confidence: number,
    evidence: string[],
    version: number,
    stage: TaggingProvenanceStage,
  ): void {
    const normalizedTag = tag.trim().toLowerCase();
    if (!normalizedTag) {
      return;
    }

    const boundedConfidence = Math.max(0, Math.min(100, Math.round(confidence)));
    const normalizedEvidence = Array.from(
      new Set(
        evidence
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      )
    );

    const existing = entryMap.get(normalizedTag);
    if (!existing) {
      entryMap.set(normalizedTag, {
        tag: normalizedTag,
        source: "rule",
        confidence: boundedConfidence,
        version,
        provenance: {
          stage,
          generatedBy: "ingest-compute-service",
          evidence: normalizedEvidence.length > 0 ? normalizedEvidence : [`tag:${normalizedTag}`],
        },
      });
      return;
    }

    if (boundedConfidence > existing.confidence) {
      existing.confidence = boundedConfidence;
    }

    existing.version = Math.max(existing.version, version);
    existing.source = "rule";
    for (const hint of normalizedEvidence) {
      if (!existing.provenance.evidence.includes(hint)) {
        existing.provenance.evidence.push(hint);
      }
    }
  }

  private buildTaggingEnvelope(
    industryTags: string[],
    synonymHits: string[],
    companyHits: string[],
    brandHits: BrandHit[],
    roleSignals: RoleSignalSummary[],
    experienceLevel: string,
    skillsVersion: number,
    generatedAt: number,
  ): TaggingEnvelope {
    const envelope = new Map<string, TaggingEnvelopeEntry>();

    for (const tag of industryTags) {
      this.upsertTaggingEnvelopeEntry(
        envelope,
        `industry:${tag}`,
        85,
        [`industryTag:${tag}`],
        skillsVersion,
        "industry_taxonomy",
      );
    }

    for (const hit of synonymHits) {
      this.upsertTaggingEnvelopeEntry(
        envelope,
        `synonym:${hit}`,
        70,
        [`synonymHit:${hit}`],
        skillsVersion,
        "synonym_expansion",
      );
    }

    for (const company of companyHits) {
      const evidence = brandHits
        .filter((hit) => hit.brand === company)
        .slice(0, 6)
        .flatMap((hit) => [`brandSource:${hit.source}`, `brandContext:${hit.context}`]);

      this.upsertTaggingEnvelopeEntry(
        envelope,
        `company:${company}`,
        80,
        evidence.length > 0 ? evidence : [`companyHit:${company}`],
        skillsVersion,
        "company_pattern_match",
      );
    }

    // Non-employer brand hits grouped by brand name
    const brandGroups = new Map<string, { contexts: Set<string>; count: number }>();
    for (const hit of brandHits) {
      if (hit.context === "employer") {
        continue;
      }
      const brandKey = hit.brand.trim().toLowerCase();
      if (!brandKey) {
        continue;
      }
      const existing = brandGroups.get(brandKey) ?? { contexts: new Set<string>(), count: 0 };
      existing.contexts.add(hit.context);
      existing.count += 1;
      brandGroups.set(brandKey, existing);
    }

    for (const [brand, { contexts, count }] of brandGroups) {
      const evidence = [
        `brandCount:${count}`,
        ...Array.from(contexts).map((ctx) => `brandContext:${ctx}`),
      ];

      this.upsertTaggingEnvelopeEntry(
        envelope,
        `brand:${brand}`,
        65,
        evidence,
        skillsVersion,
        "company_pattern_match",
      );
    }

    for (const signal of roleSignals) {
      const yearsBoost = Math.min(signal.years, 10) * 2.5;
      const signalBoost = Math.min(signal.signalCount, 5) * 4;
      const occurrenceBoost = Math.min(signal.occurrences, 6) * 2.5;
      const confidence = Math.min(95, 45 + yearsBoost + signalBoost + occurrenceBoost);
      const evidence = [
        `roleType:${signal.type}`,
        `verifyIn:${signal.verifyIn}`,
        ...signal.matchedSignals.slice(0, 6).map((matched) => `signal:${matched}`),
      ];

      this.upsertTaggingEnvelopeEntry(
        envelope,
        `role:${signal.type}`,
        confidence,
        evidence,
        skillsVersion,
        "role_signal_aggregation",
      );
    }

    if (experienceLevel && experienceLevel !== "unknown") {
      this.upsertTaggingEnvelopeEntry(
        envelope,
        `experience:${experienceLevel}`,
        75,
        [`experienceLevel:${experienceLevel}`],
        skillsVersion,
        "experience_signal_detection",
      );
    }

    const entries = Array.from(envelope.values())
      .sort((left, right) => {
        if (right.confidence !== left.confidence) {
          return right.confidence - left.confidence;
        }
        return left.tag.localeCompare(right.tag);
      })
      .slice(0, 120);

    return {
      schemaVersion: 1,
      generatedAt,
      entries,
    };
  }

  /**
   * Compute experience level using skills.md signals
   */
  private computeExperienceLevel(searchText: string): string {
    const signals = this.skillsKnowledgeService.getExperienceSignals();
    const levelCounts = new Map<string, number>();

    for (const signal of signals) {
      let count = 0;
      for (const keyword of signal.keywords) {
        if (searchText.includes(keyword.toLowerCase())) {
          count += 1;
        }
      }
      if (count > 0) {
        levelCounts.set(signal.level, count);
      }
    }

    if (levelCounts.size === 0) return "unknown";

    // Return level with most keyword hits
    let maxCount = 0;
    let maxLevel = "unknown";
    for (const [level, count] of levelCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        maxLevel = level;
      }
    }

    return maxLevel;
  }

  /**
   * Compute field-aware brand hits from resume text segments.
   */
  private computeBrandHits(workHistory: ResumeWorkHistoryItem[], companies: string[], searchText: string, verifiedEmployers: VerifiedEmployerMatch[]): BrandHit[] {
    const patterns = this.skillsKnowledgeService.getCompanyPatterns();
    const normalizedSearchText = searchText.toLowerCase();
    const normalizedCompanies = companies
      .map((company) => company.trim().toLowerCase())
      .filter((company) => company.length > 0);

    const hits: BrandHit[] = [];
    const dedupe = new Set<string>();

    const collectFromSource = (
      source: BrandHit["source"],
      text: string,
      candidateCompanies: string[],
      patternName: string,
      role: BrandHit["role"],
      aliases: string[]
    ): void => {
      const normalizedText = text.toLowerCase();
      if (!normalizedText) {
        return;
      }

      for (const alias of aliases) {
        const normalizedAlias = alias.trim().toLowerCase();
        if (!normalizedAlias || normalizedAlias.length < 2) {
          continue;
        }
        if (!normalizedText.includes(normalizedAlias)) {
          continue;
        }

        let offset = 0;
        while (offset <= normalizedText.length - normalizedAlias.length) {
          const mentionIndex = normalizedText.indexOf(normalizedAlias, offset);
          if (mentionIndex < 0) {
            break;
          }
          const mentionEnd = mentionIndex + normalizedAlias.length;
          const appearsInsideEmployerName =
            source === "workHistory" &&
            candidateCompanies.some((company) => {
              if (!company || !normalizedText.includes(company)) {
                return false;
              }

              let companyOffset = 0;
              while (companyOffset <= normalizedText.length - company.length) {
                const companyIndex = normalizedText.indexOf(company, companyOffset);
                if (companyIndex < 0) {
                  break;
                }

                const companyEnd = companyIndex + company.length;
                if (mentionIndex >= companyIndex && mentionEnd <= companyEnd) {
                  return true;
                }

                companyOffset = companyIndex + company.length;
              }

              return false;
            });
          if (appearsInsideEmployerName) {
            offset = mentionEnd;
            continue;
          }

          const context = this.classifyBrandContext(
            source,
            normalizedText,
            mentionIndex,
            normalizedAlias
          );
          // Employer verification is handled by the strict Industry DB pass below.
          if (context !== "employer") {
            const key = `${patternName}|${source}|${context}`;
            if (!dedupe.has(key)) {
              dedupe.add(key);
              hits.push({
                brand: patternName,
                role,
                source,
                context,
              });
            }
          }
          offset = mentionIndex + normalizedAlias.length;
        }
      }
    };

    // Pre-extract company names per work-history entry for the pattern-scan loop below.
    const extractedByEntry = workHistory.map((entry) => extractCompanies([entry]));

    for (const pattern of patterns) {
      const aliases = pattern.allNames
        .map((candidate) => candidate.trim().toLowerCase())
        .filter((candidate) => candidate.length > 0);

      if (!aliases.some((alias) => normalizedSearchText.includes(alias))) {
        continue;
      }

      for (let i = 0; i < workHistory.length; i++) {
        const entry = workHistory[i];
        const entryCompanies = extractedByEntry[i]
          .map((company) => company.trim().toLowerCase())
          .filter((company) => company.length > 0);
        const candidateCompanies = Array.from(new Set([...normalizedCompanies, ...entryCompanies]));
        collectFromSource(
          "workHistory",
          buildWorkHistoryEntryText(entry),
          candidateCompanies,
          pattern.name.toLowerCase(),
          pattern.role,
          aliases
        );
      }
    }

    // Strict employer matching against Industry DB companies (Tier 1 only).
    for (const employerMatch of verifiedEmployers) {
      if (this.industryDataService.matchBrands(employerMatch.companyNameCn).length === 0) {
        continue;
      }

      const key = `${employerMatch.key}|workHistory|employer`;
      if (dedupe.has(key)) {
        continue;
      }
      dedupe.add(key);
      hits.push({
        brand: employerMatch.key,
        source: "workHistory",
        context: "employer",
        role: "employer",
        companyId: employerMatch.companyId,
      });
    }

    return hits;
  }

  private collectVerifiedEmployerMatches(workHistory: ResumeWorkHistoryItem[]): VerifiedEmployerMatch[] {
    const matches = new Map<string, VerifiedEmployerMatch>();

    for (const entry of workHistory) {
      const employerNames = extractCompanies([entry]);
      for (const employerName of employerNames) {
        const verification = this.industryDataService.verifyCompanyIndustry(employerName);
        if (verification.matchType !== "known_company" || !verification.company) {
          continue;
        }

        const key = this.industryDataService.getCompanyKey(verification.company);
        if (!matches.has(key)) {
          matches.set(key, {
            key,
            companyId: verification.company.id,
            companyNameCn: verification.company.nameCn,
          });
        }
      }
    }

    return Array.from(matches.values());
  }

  private classifyBrandContext(
    source: BrandHit["source"],
    text: string,
    mentionIndex: number,
    mention: string
  ): BrandContext {
    const windowStart = Math.max(0, mentionIndex - BRAND_CONTEXT_WINDOW);
    const windowEnd = Math.min(text.length, mentionIndex + mention.length + BRAND_CONTEXT_WINDOW);
    const nearbyText = text.slice(windowStart, windowEnd);

    if (SALES_SIGNALS.some((signal) => nearbyText.includes(signal))) {
      return "sales";
    }
    if (TECHNICAL_SIGNALS.some((signal) => nearbyText.includes(signal))) {
      return "technical";
    }
    if (EQUIPMENT_SIGNALS.some((signal) => nearbyText.includes(signal))) {
      return "equipment";
    }

    if (source === "selfIntro") {
      return "equipment";
    }
    if (source === "jobIntention") {
      return "general";
    }
    if (source === "workHistory") {
      return "equipment";
    }
    return "general";
  }

  /**
   * Build alias tokens for matched brands so Convex searchText can match cross-language aliases.
   */
  private buildCompanyAliasTokens(companyHits: string[], brandHits: BrandHit[]): string {
    const matchedBrands = new Set<string>([
      ...companyHits,
      ...brandHits.map((hit) => hit.brand),
    ]);
    if (matchedBrands.size === 0) {
      return "";
    }

    const patterns = this.skillsKnowledgeService.getCompanyPatterns();
    const patternByName = new Map(
      patterns.map((pattern) => [normalizeCompanyPatternIdentifier(pattern.name), pattern])
    );

    const aliasTokens = new Set<string>();
    for (const matchedBrand of matchedBrands) {
      const pattern = patternByName.get(normalizeCompanyPatternIdentifier(matchedBrand));
      if (!pattern) {
        continue;
      }

      for (const candidate of pattern.allNames) {
        const normalizedCandidate = normalizeCompanyPatternIdentifier(candidate);
        if (normalizedCandidate) {
          aliasTokens.add(normalizedCandidate);
        }
      }
    }

    return Array.from(aliasTokens).join(" ");
  }
}

// Singleton
export const ingestComputeService = new IngestComputeService();
