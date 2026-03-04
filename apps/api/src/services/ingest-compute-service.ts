import { SkillsKnowledgeService } from "./skills-knowledge.js";
import { JobDescriptionService } from "./job-description-service.js";
import { RuleScoringService, type RoleSignalSummary } from "./rule-scoring.js";
import { resolveResumeId } from "./resume-id.js";
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
}

export interface IngestResult {
  resumeId: string;
  industryTags: string[];
  synonymHits: string[];
  brandHits: BrandHit[];
  companyHits: string[];
  roleSignals: RoleSignalSummary[];
  tagEnvelope: TagEnvelopeEntry[];
  taggingEnvelope: TaggingEnvelope;
  companyAliasTokens: string;
  ruleScores: Record<string, number>;  // jdId → score (0-100)
  primaryRuleScore: number;
  experienceLevel: string;
  computedAt: number;
  skillsVersion: number;
}

export type TagEnvelopeSource = "rule" | "ai";

export interface TagEnvelopeEntry {
  tag: string;
  source: TagEnvelopeSource;
  confidence: number;
  evidence: string[];
  version: number;
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
  source: TagEnvelopeSource;
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
    .map((item) => {
      if (!isRecord(item)) return null;
      const raw = toStringValue(item.raw).trim();
      if (!raw) return null;
      return { raw };
    })
    .filter((item): item is ResumeWorkHistoryItem => item !== null);
}

function toResumeItem(value: unknown): ResumeItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const perUserId = value.perUserId;
  const normalizedPerUserId =
    typeof perUserId === "string"
      ? perUserId
      : typeof perUserId === "number" && Number.isFinite(perUserId)
        ? String(perUserId)
        : undefined;

  return {
    name: toStringValue(value.name),
    profileUrl: toStringValue(value.profileUrl),
    activityStatus: toStringValue(value.activityStatus),
    age: toStringValue(value.age),
    experience: toStringValue(value.experience),
    education: toStringValue(value.education),
    location: toStringValue(value.location),
    selfIntro: toStringValue(value.selfIntro),
    jobIntention: toStringValue(value.jobIntention),
    expectedSalary: toStringValue(value.expectedSalary),
    workHistory: toWorkHistory(value.workHistory),
    extractedAt: toStringValue(value.extractedAt),
    resumeId: toStringValue(value.resumeId) || undefined,
    perUserId: normalizedPerUserId,
  };
}

function hasResumeSignal(item: ResumeItem): boolean {
  return Boolean(
    item.name
    || item.jobIntention
    || item.selfIntro
    || item.profileUrl
    || item.resumeId
    || item.perUserId
    || item.workHistory.length > 0
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

function parseExperienceYears(value: string): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (/应届|无经验/.test(normalized)) return 0;
  const match = normalized.match(/(\d+)(?:\s*[-~到至]\s*(\d+))?/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : min;
  if (Number.isNaN(max)) return null;
  return max;
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

function normalizeCompanyName(raw: string): string {
  return raw
    .replace(/^[\d\-~至今年月日()（）.\s]+/, "")
    .replace(/[\s,，。;；]+/g, " ")
    .trim();
}

function extractCompanies(workHistory: ResumeWorkHistoryItem[]): string[] {
  if (!workHistory.length) return [];

  const companies: string[] = [];
  for (const item of workHistory) {
    const cleaned = normalizeCompanyName(item.raw);
    if (!cleaned) continue;

    const companyMatch = cleaned.match(/([\u4e00-\u9fa5A-Za-z0-9()（）·.&\-]{2,40}(?:公司|集团|科技|机械|设备|自动化|股份|有限|厂))/);
    if (companyMatch) {
      companies.push(companyMatch[1]);
      continue;
    }

    const firstToken = cleaned.split(/\s+/g).find((token) => token.length >= 2);
    if (firstToken) {
      companies.push(firstToken);
    }
  }

  return Array.from(new Set(companies)).slice(0, 20);
}

function createSearchText(item: ResumeItem): string {
  const parts = [
    item.name,
    item.jobIntention,
    item.selfIntro,
    item.education,
    item.location,
    item.expectedSalary,
    ...(item.workHistory?.map((entry) => entry.raw) ?? []),
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
  if (tag.startsWith("company:")) {
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

const BRAND_CONTEXT_WINDOW = 30;
const EQUIPMENT_SIGNALS = ["操作", "使用", "熟练", "熟悉", "机台", "机型", "设备", "机床"];
const SALES_SIGNALS = ["销售", "代理", "渠道", "推广", "业务", "客户"];
const TECHNICAL_SIGNALS = ["维修", "调试", "编程", "安装", "保养", "维护"];
const DEFAULT_ROLE_SIGNAL_LIBRARY: Record<string, string[]> = {
  sales: ["销售", "业务开发", "客户", "大客户", "渠道", "销售经理", "销售工程师", "sales", "account"],
  engineer: ["工程师", "设计", "研发", "开发", "编程", "调试", "维修", "技术", "engineer", "developer", "design"],
};

/**
 * Build a single ResumeIndex from a ResumeItem
 * (extracted helper from ResumeIndexService.buildIndex)
 */
export function buildResumeIndex(item: ResumeItem, index: number): ResumeIndex {
  const resumeId = resolveResumeId(item, index);
  const searchText = createSearchText(item);
  const companies = extractCompanies(item.workHistory ?? []);

  // For ingest compute, we don't need full skill extraction
  // We just need the basic fields for rule scoring
  return {
    resumeId,
    experienceYears: parseExperienceYears(item.experience),
    educationLevel: normalizeEducationLevel(item.education),
    locationCity: item.location || null,
    workHistoryText: (item.workHistory ?? []).map((entry) => entry.raw).join(" "),
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
  private readonly projectRoot?: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot;
    this.ruleScoringService = new RuleScoringService(projectRoot);
    this.skillsKnowledgeService = new SkillsKnowledgeService(projectRoot);
    this.jobDescriptionService = new JobDescriptionService(projectRoot);
  }

  /**
   * Compute ingest data for a single resume
   */
  computeOne(resumeId: string, content: unknown): IngestResult {
    const item = extractResumeItem(content);
    const index = buildResumeIndex(item, 0);
    const searchText = index.searchText.toLowerCase();
    const computedAt = Date.now();

    // 1. Compute industryTags
    const industryTags = this.computeIndustryTags(searchText);

    // 2. Compute synonymHits
    const synonymHits = this.computeSynonymHits(searchText);

    // 3. Compute field-aware brandHits, then derive companyHits for backward compatibility
    const brandHits = this.computeBrandHits(item, index.companies, searchText);
    const companyHits = Array.from(new Set(brandHits.map((hit) => hit.brand)));
    const roleSignals = this.computeRoleSignals(item.workHistory ?? []);
    const companyAliasTokens = this.buildCompanyAliasTokens(companyHits);

    // 4. Compute ruleScores for all active JDs
    const ruleScores = this.computeRuleScores(index, brandHits, roleSignals);
    const scoreValues = Object.values(ruleScores);
    const primaryRuleScore = scoreValues.length > 0 ? Math.max(...scoreValues) : 0;

    // 5. Compute experienceLevel
    const experienceLevel = this.computeExperienceLevel(searchText);

    // 6. Get skills version
    const skillsVersion = this.skillsKnowledgeService.getVersion();
    const tagEnvelope = this.buildTagEnvelope(
      industryTags,
      synonymHits,
      companyHits,
      brandHits,
      roleSignals,
      experienceLevel,
      skillsVersion,
    );
    const taggingEnvelope = this.buildTaggingEnvelope(tagEnvelope, computedAt);

    return {
      resumeId,
      industryTags,
      synonymHits,
      brandHits,
      companyHits,
      roleSignals,
      tagEnvelope,
      taggingEnvelope,
      companyAliasTokens,
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
        tags.push(domain.tag);
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

  private parseRoleYears(raw: string): number {
    const text = raw.trim();
    if (!text) {
      return 0;
    }

    const explicitDuration = text.match(/\((\d+)\s*年(?:(\d+)\s*月)?\)/u);
    if (explicitDuration) {
      const years = Number(explicitDuration[1] || 0);
      const months = Number(explicitDuration[2] || 0);
      if (Number.isFinite(years) && Number.isFinite(months)) {
        return years + (months / 12);
      }
    }

    const range = text.match(/(\d{4})[-./年](\d{1,2})?.*?[~至到-]\s*(\d{4})(?:[-./年](\d{1,2}))?/u);
    if (range) {
      const startYear = Number(range[1]);
      const startMonth = Number(range[2] || 1);
      const endYear = Number(range[3]);
      const endMonth = Number(range[4] || 1);

      if ([startYear, startMonth, endYear, endMonth].every((value) => Number.isFinite(value))) {
        const monthDiff = (endYear - startYear) * 12 + (endMonth - startMonth);
        if (monthDiff > 0) {
          return monthDiff / 12;
        }
      }
    }

    return 0;
  }

  private computeRoleSignals(workHistory: ResumeWorkHistoryItem[]): RoleSignalSummary[] {
    if (!Array.isArray(workHistory) || workHistory.length === 0) {
      return [];
    }

    const roleSignalAccumulators = new Map<string, {
      signals: Set<string>;
      occurrences: number;
      years: number;
    }>();

    for (const entry of workHistory) {
      const raw = entry.raw?.trim() || "";
      if (!raw) {
        continue;
      }

      const normalized = raw.toLowerCase();
      const years = this.parseRoleYears(raw);

      for (const [roleType, signals] of Object.entries(DEFAULT_ROLE_SIGNAL_LIBRARY)) {
        const matchedSignals = signals.filter((signal) => normalized.includes(signal.toLowerCase()));
        if (matchedSignals.length === 0) {
          continue;
        }

        const existing = roleSignalAccumulators.get(roleType) ?? {
          signals: new Set<string>(),
          occurrences: 0,
          years: 0,
        };

        matchedSignals.forEach((signal) => existing.signals.add(signal.toLowerCase()));
        existing.occurrences += 1;
        existing.years += years;

        roleSignalAccumulators.set(roleType, existing);
      }
    }

    return Array.from(roleSignalAccumulators.entries()).map(([type, value]) => ({
      type,
      matchedSignals: Array.from(value.signals),
      signalCount: value.signals.size,
      occurrences: value.occurrences,
      years: Number(value.years.toFixed(2)),
      verifyIn: "workHistory",
    }));
  }

  private upsertTagEnvelopeEntry(
    entryMap: Map<string, TagEnvelopeEntry>,
    tag: string,
    confidence: number,
    evidence: string[],
    version: number,
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
        evidence: normalizedEvidence,
        version,
      });
      return;
    }

    if (boundedConfidence > existing.confidence) {
      existing.confidence = boundedConfidence;
    }

    existing.version = Math.max(existing.version, version);
    existing.source = "rule";
    for (const hint of normalizedEvidence) {
      if (!existing.evidence.includes(hint)) {
        existing.evidence.push(hint);
      }
    }
  }

  private buildTagEnvelope(
    industryTags: string[],
    synonymHits: string[],
    companyHits: string[],
    brandHits: BrandHit[],
    roleSignals: RoleSignalSummary[],
    experienceLevel: string,
    skillsVersion: number,
  ): TagEnvelopeEntry[] {
    const envelope = new Map<string, TagEnvelopeEntry>();

    for (const tag of industryTags) {
      this.upsertTagEnvelopeEntry(
        envelope,
        `industry:${tag}`,
        85,
        [`industryTag:${tag}`],
        skillsVersion,
      );
    }

    for (const hit of synonymHits) {
      this.upsertTagEnvelopeEntry(
        envelope,
        `synonym:${hit}`,
        70,
        [`synonymHit:${hit}`],
        skillsVersion,
      );
    }

    for (const company of companyHits) {
      const evidence = brandHits
        .filter((hit) => hit.brand === company)
        .slice(0, 6)
        .flatMap((hit) => [`brandSource:${hit.source}`, `brandContext:${hit.context}`]);

      this.upsertTagEnvelopeEntry(
        envelope,
        `company:${company}`,
        80,
        evidence.length > 0 ? evidence : [`companyHit:${company}`],
        skillsVersion,
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

      this.upsertTagEnvelopeEntry(
        envelope,
        `role:${signal.type}`,
        confidence,
        evidence,
        skillsVersion,
      );
    }

    if (experienceLevel && experienceLevel !== "unknown") {
      this.upsertTagEnvelopeEntry(
        envelope,
        `experience:${experienceLevel}`,
        75,
        [`experienceLevel:${experienceLevel}`],
        skillsVersion,
      );
    }

    return Array.from(envelope.values())
      .sort((left, right) => {
        if (right.confidence !== left.confidence) {
          return right.confidence - left.confidence;
        }
        return left.tag.localeCompare(right.tag);
      })
      .slice(0, 120);
  }

  private buildTaggingEnvelope(
    tagEnvelope: TagEnvelopeEntry[],
    generatedAt: number,
  ): TaggingEnvelope {
    const entries = tagEnvelope.map((entry) => {
      const evidence = Array.from(new Set(entry.evidence.map((item) => item.trim()).filter((item) => item.length > 0)));
      return {
        tag: entry.tag,
        source: entry.source,
        confidence: entry.confidence,
        version: entry.version,
        provenance: {
          stage: inferTaggingStage(entry.tag),
          generatedBy: "ingest-compute-service" as const,
          evidence: evidence.length > 0 ? evidence : [`tag:${entry.tag}`],
        },
      };
    });

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
  private computeBrandHits(item: ResumeItem, companies: string[], searchText: string): BrandHit[] {
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
          const context = this.classifyBrandContext(
            source,
            normalizedText,
            mentionIndex,
            normalizedAlias,
            candidateCompanies
          );
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
          offset = mentionIndex + normalizedAlias.length;
        }
      }
    };

    for (const pattern of patterns) {
      const aliases = pattern.allNames
        .map((candidate) => candidate.trim().toLowerCase())
        .filter((candidate) => candidate.length > 0);

      if (!aliases.some((alias) => normalizedSearchText.includes(alias))) {
        continue;
      }

      collectFromSource(
        "selfIntro",
        item.selfIntro || "",
        normalizedCompanies,
        pattern.name.toLowerCase(),
        pattern.role,
        aliases
      );
      collectFromSource(
        "jobIntention",
        item.jobIntention || "",
        normalizedCompanies,
        pattern.name.toLowerCase(),
        pattern.role,
        aliases
      );

      for (const entry of item.workHistory || []) {
        const entryCompanies = extractCompanies([entry])
          .map((company) => company.trim().toLowerCase())
          .filter((company) => company.length > 0);
        const candidateCompanies = Array.from(new Set([...normalizedCompanies, ...entryCompanies]));
        collectFromSource(
          "workHistory",
          entry.raw || "",
          candidateCompanies,
          pattern.name.toLowerCase(),
          pattern.role,
          aliases
        );
      }
    }

    return hits;
  }

  private classifyBrandContext(
    source: BrandHit["source"],
    text: string,
    mentionIndex: number,
    mention: string,
    companies: string[]
  ): BrandContext {
    if (source === "workHistory") {
      const employerMatch = companies.some((company) =>
        company.includes(mention) || mention.includes(company)
      );
      if (employerMatch) {
        return "employer";
      }
    }

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
    return "employer";
  }

  /**
   * Build alias tokens for matched companies so Convex searchText can match cross-language aliases.
   */
  private buildCompanyAliasTokens(companyHits: string[]): string {
    if (companyHits.length === 0) {
      return "";
    }

    const patterns = this.skillsKnowledgeService.getCompanyPatterns();
    const patternByName = new Map(
      patterns.map((pattern) => [pattern.name.toLowerCase(), pattern])
    );

    const aliasTokens = new Set<string>();
    for (const companyHit of companyHits) {
      const pattern = patternByName.get(companyHit.toLowerCase());
      if (!pattern) {
        continue;
      }

      for (const candidate of pattern.allNames) {
        const normalizedCandidate = candidate.toLowerCase().trim();
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
