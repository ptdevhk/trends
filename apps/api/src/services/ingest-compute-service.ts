import { SkillsKnowledgeService } from "./skills-knowledge.js";
import { JobDescriptionService } from "./job-description-service.js";
import { RuleScoringService } from "./rule-scoring.js";
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
  companyAliasTokens: string;
  ruleScores: Record<string, number>;  // jdId → score (0-100)
  primaryRuleScore: number;
  experienceLevel: string;
  computedAt: number;
  skillsVersion: number;
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

const BRAND_CONTEXT_WINDOW = 30;
const EQUIPMENT_SIGNALS = ["操作", "使用", "熟练", "熟悉", "机台", "机型", "设备", "机床"];
const SALES_SIGNALS = ["销售", "代理", "渠道", "推广", "业务", "客户"];
const TECHNICAL_SIGNALS = ["维修", "调试", "编程", "安装", "保养", "维护"];

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

    // 1. Compute industryTags
    const industryTags = this.computeIndustryTags(searchText);

    // 2. Compute synonymHits
    const synonymHits = this.computeSynonymHits(searchText);

    // 3. Compute field-aware brandHits, then derive companyHits for backward compatibility
    const brandHits = this.computeBrandHits(item, index.companies, searchText);
    const companyHits = Array.from(new Set(brandHits.map((hit) => hit.brand)));
    const companyAliasTokens = this.buildCompanyAliasTokens(companyHits);

    // 4. Compute ruleScores for all active JDs
    const ruleScores = this.computeRuleScores(index, brandHits);
    const scoreValues = Object.values(ruleScores);
    const primaryRuleScore = scoreValues.length > 0 ? Math.max(...scoreValues) : 0;

    // 5. Compute experienceLevel
    const experienceLevel = this.computeExperienceLevel(searchText);

    // 6. Get skills version
    const skillsVersion = this.skillsKnowledgeService.getVersion();

    return {
      resumeId,
      industryTags,
      synonymHits,
      brandHits,
      companyHits,
      companyAliasTokens,
      ruleScores,
      primaryRuleScore,
      experienceLevel,
      computedAt: Date.now(),
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
    const hits = new Set<string>();

    for (const [variant, canonical] of synonymTable.entries()) {
      if (searchText.includes(variant.toLowerCase())) {
        hits.add(canonical);
      }
    }

    return Array.from(hits);
  }

  /**
   * Compute rule scores for all active JDs
   */
  private computeRuleScores(index: ResumeIndex, brandHits: BrandHit[]): Record<string, number> {
    const jds = this.jobDescriptionService.listFiles().filter((jd) => jd.status === "active");
    const scores: Record<string, number> = {};

    for (const jd of jds) {
      try {
        const context = this.ruleScoringService.buildContext(jd.name);
        const result = this.ruleScoringService.scoreResume(index, context, brandHits);
        scores[jd.id] = result.score;
      } catch (error) {
        // Log error but don't fail the whole batch
        console.error(`Failed to score resume against JD ${jd.name}:`, error);
        scores[jd.id] = 0;
      }
    }

    return scores;
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
