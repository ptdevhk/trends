import fs from "node:fs";
import path from "node:path";

import { findProjectRoot } from "./db.js";
import { JobDescriptionService } from "./job-description-service.js";
import { resolveResumeId } from "./resume-id.js";

import type { ResumeItem, ResumeWorkHistoryItem } from "../types/resume.js";

export interface ResumeIndex {
  resumeId: string;
  experienceYears: number | null;
  educationLevel: string | null;
  locationCity: string | null;
  skills: string[];
  companies: string[];
  industryTags: string[];
  salaryRange: { min?: number; max?: number } | null;
  searchText: string;
}

type IndustryTag = "machinery" | "cnc" | "sales" | "automation" | "metrology" | "software";

const INDUSTRY_KEYWORDS: Record<IndustryTag, string[]> = {
  machinery: [
    "机床",
    "车床",
    "加工中心",
    "机械",
    "设备",
    "五轴",
    "夹具",
    "治具",
    "lathe",
    "machining",
    "milling",
  ],
  cnc: ["cnc", "数控", "fanuc", "siemens", "star", "brother", "mitsubishi"],
  sales: ["销售", "业务", "客户", "大客户", "渠道", "sales", "account", "bd", "market"],
  automation: ["自动化", "机器人", "plc", "伺服", "automation"],
  metrology: ["测量", "三维扫描", "3d", "cmm", "metrology", "scan"],
  software: ["c++", "c#", "mfc", "qt", "软件", "开发", "algorithm", "python"],
};

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

function extractTokenCandidates(text: string): string[] {
  if (!text.trim()) return [];
  const segments = text.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9+#.-]{2,}/gi) ?? [];
  return segments
    .map((item) => item.toLowerCase())
    .filter((item) => item.length >= 2)
    .filter((item) => item.length <= 24);
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

function scoreIndustryTags(haystack: string): string[] {
  const tags: string[] = [];

  for (const [tag, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      tags.push(tag);
    }
  }

  return tags;
}

export class ResumeIndexService {
  readonly projectRoot: string;

  private readonly indexCache = new Map<string, Map<string, ResumeIndex>>();
  private readonly jobService: JobDescriptionService;

  private vocabularyLoaded = false;
  private readonly skillVocabulary = new Set<string>();
  private readonly jdKeywordVocabulary = new Set<string>();
  private locationVocabulary: string[] = [];

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    this.jobService = new JobDescriptionService(this.projectRoot);
  }

  private loadSkillVocabulary(): void {
    const filePath = path.join(this.projectRoot, "config", "resume", "skills_words.txt");
    if (!fs.existsSync(filePath)) return;

    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      for (const token of trimmed.split(/\s+/g)) {
        if (!token) continue;
        if (token.startsWith("!")) continue;
        if (token.startsWith("+")) continue;
        if (token.startsWith("@")) continue;
        if (token.includes("=>")) continue;
        if (token.startsWith("[")) continue;
        if (token.startsWith("/")) continue;
        if (token.includes("|")) continue;

        const normalized = token.toLowerCase();
        if (normalized.length >= 2) {
          this.skillVocabulary.add(normalized);
        }
      }
    }
  }

  private loadJobDescriptionVocabulary(): void {
    const jds = this.jobService.listFiles();
    const locations = new Set<string>();

    for (const jd of jds) {
      const autoMatch = jd.autoMatch;
      if (!autoMatch) continue;

      for (const keyword of autoMatch.keywords ?? []) {
        const normalized = keyword.toLowerCase().trim();
        if (normalized.length >= 2) {
          this.jdKeywordVocabulary.add(normalized);
        }
      }

      for (const location of autoMatch.locations ?? []) {
        const normalized = location.trim();
        if (normalized) {
          locations.add(normalized);
        }
      }
    }

    this.locationVocabulary = Array.from(locations).sort((a, b) => b.length - a.length);
  }

  private ensureVocabularyLoaded(): void {
    if (this.vocabularyLoaded) return;

    this.loadSkillVocabulary();
    this.loadJobDescriptionVocabulary();
    this.vocabularyLoaded = true;
  }

  private extractLocationCity(location: string): string | null {
    if (!location.trim()) return null;

    for (const knownLocation of this.locationVocabulary) {
      if (location.includes(knownLocation)) return knownLocation;
    }

    const normalized = location.trim();
    const direct = normalized.match(/^([\u4e00-\u9fa5]{2,6}?)(?:市|县|区|镇)/);
    if (direct?.[1]) return direct[1];

    const fallback = normalized.match(/[\u4e00-\u9fa5]{2,4}/);
    return fallback?.[0] ?? null;
  }

  private extractSkills(item: ResumeItem, searchText: string): string[] {
    const skills = new Set<string>();

    const intentionTokens = extractTokenCandidates(item.jobIntention || "");
    const summaryTokens = extractTokenCandidates(item.selfIntro || "");
    for (const token of intentionTokens.slice(0, 30)) {
      skills.add(token);
    }
    for (const token of summaryTokens.slice(0, 30)) {
      skills.add(token);
    }

    for (const keyword of this.skillVocabulary) {
      if (searchText.includes(keyword)) {
        skills.add(keyword);
      }
    }
    for (const keyword of this.jdKeywordVocabulary) {
      if (searchText.includes(keyword)) {
        skills.add(keyword);
      }
    }

    return Array.from(skills).slice(0, 40);
  }

  buildIndex(sampleKey: string, items: ResumeItem[]): Map<string, ResumeIndex> {
    const cached = this.indexCache.get(sampleKey);
    if (cached) return cached;

    this.ensureVocabularyLoaded();

    const nextMap = new Map<string, ResumeIndex>();
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const resumeId = resolveResumeId(item, i);
      const searchText = createSearchText(item);
      const companies = extractCompanies(item.workHistory ?? []);
      const skills = this.extractSkills(item, searchText);
      const tagHaystack = [searchText, ...skills, ...companies].join(" ").toLowerCase();

      nextMap.set(resumeId, {
        resumeId,
        experienceYears: parseExperienceYears(item.experience),
        educationLevel: normalizeEducationLevel(item.education),
        locationCity: this.extractLocationCity(item.location || ""),
        skills,
        companies,
        industryTags: scoreIndustryTags(tagHaystack),
        salaryRange: parseSalaryRange(item.expectedSalary),
        searchText,
      });
    }

    this.indexCache.set(sampleKey, nextMap);
    return nextMap;
  }

  getIndex(sampleKey: string): Map<string, ResumeIndex> | undefined {
    return this.indexCache.get(sampleKey);
  }

  clearCache(): void {
    this.indexCache.clear();
  }
}

export const resumeIndexService = new ResumeIndexService();
