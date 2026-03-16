import fs from "node:fs";
import path from "node:path";

import {
  buildWorkHistoryEntryText,
  buildWorkHistoryEvidence,
  FALLBACK_INDUSTRY_KEYWORDS,
  findLocation,
  normalizeIndustryTags,
  normalizeLocationName,
  type CanonicalIndustryTag,
} from "@trends/shared";

import { findProjectRoot } from "./db.js";
import { JobDescriptionService } from "./job-description-service.js";
import { SkillsKnowledgeService } from "./skills-knowledge.js";
import { resolveResumeId } from "./resume-id.js";
import { computeWorkHistoryYears, extractCompanyFromWorkHistory } from "./work-history.js";

import type { ResumeItem, ResumeWorkHistoryItem } from "../types/resume.js";

export interface ResumeIndex {
  resumeId: string;
  experienceYears: number | null;
  educationLevel: string | null;
  locationCity: string | null;
  evidenceText?: string;
  skills: string[];
  companies: string[];
  industryTags: string[];
  salaryRange: { min?: number; max?: number } | null;
  searchText: string;
}

const INDUSTRY_KEYWORDS: Record<CanonicalIndustryTag, string[]> = FALLBACK_INDUSTRY_KEYWORDS;

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

  const companies = workHistory
    .map((item) => extractCompanyFromWorkHistory(item))
    .filter((company) => company.length > 0);

  return Array.from(new Set(companies)).slice(0, 20);
}

function createSearchText(item: ResumeItem): string {
  const parts = [
    item.name,
    item.education,
    item.location,
    item.expectedSalary,
    ...(item.workHistory?.map((entry) => buildWorkHistoryEntryText(entry)) ?? []),
  ];

  return normalizeText(parts.join(" "));
}

function scoreIndustryTagsLegacy(haystack: string): string[] {
  const tags: string[] = [];

  for (const [tag, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      tags.push(tag);
    }
  }

  return normalizeIndustryTags(tags);
}

export class ResumeIndexService {
  readonly projectRoot: string;

  private readonly indexCache = new Map<string, Map<string, ResumeIndex>>();
  private readonly jobService: JobDescriptionService;
  private readonly skillsService: SkillsKnowledgeService;

  private vocabularyLoaded = false;
  private readonly skillVocabulary = new Set<string>();
  private readonly jdKeywordVocabulary = new Set<string>();
  private locationVocabulary: string[] = [];

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    this.jobService = new JobDescriptionService(this.projectRoot);
    this.skillsService = new SkillsKnowledgeService(this.projectRoot);
  }

  private loadSkillVocabulary(): void {
    // Try skills.md first (M3), fallback to skills_words.txt
    try {
      const vocab = this.skillsService.getSkillVocabulary();
      for (const keyword of vocab) {
        this.skillVocabulary.add(keyword);
      }
      if (this.skillVocabulary.size > 0) {
        return;
      }
    } catch {
      // Fall through to legacy file
    }

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
      if (!autoMatch && !jd.location) continue;

      for (const keyword of autoMatch?.keywords ?? []) {
        const normalized = keyword.toLowerCase().trim();
        if (normalized.length >= 2) {
          this.jdKeywordVocabulary.add(normalized);
        }
      }

      for (const location of jd.location ? [jd.location] : []) {
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

    const seededLocation = findLocation(location);
    if (seededLocation) {
      if (seededLocation.level === "city") {
        return seededLocation.name;
      }
      if (seededLocation.level === "district" && seededLocation.parentName) {
        return seededLocation.parentName;
      }
      return seededLocation.name;
    }

    const normalized = normalizeLocationName(location.trim());
    if (/[a-z]/i.test(normalized)) {
      return normalized || null;
    }

    const direct = location.trim().match(/^([\u4e00-\u9fa5]{2,6}?)(?:市|县|区|镇)/);
    if (direct?.[1]) return direct[1];

    const fallback = location.trim().match(/[\u4e00-\u9fa5]{2,4}/);
    return fallback?.[0] ?? null;
  }

  private extractSkills(searchText: string): string[] {
    const skills = new Set<string>();

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
      const skills = this.extractSkills(searchText);
      const tagHaystack = [searchText, ...skills, ...companies].join(" ").toLowerCase();

      const evidenceText = buildWorkHistoryEvidence(item.workHistory).text;

      nextMap.set(resumeId, {
        resumeId,
        experienceYears: computeWorkHistoryYears(item.workHistory ?? []),
        educationLevel: normalizeEducationLevel(item.education),
        locationCity: this.extractLocationCity(item.location || ""),
        evidenceText,
        skills,
        companies,
        industryTags: this.scoreIndustryTags(tagHaystack),
        salaryRange: parseSalaryRange(item.expectedSalary),
        searchText,
      });
    }

    this.indexCache.set(sampleKey, nextMap);
    return nextMap;
  }

  private scoreIndustryTags(haystack: string): string[] {
    // Try skills.md first (M3), fallback to hardcoded INDUSTRY_KEYWORDS
    try {
      const taxonomy = this.skillsService.getIndustryTaxonomy();
      const tags: string[] = [];

      for (const domain of taxonomy) {
        if (domain.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
          tags.push(domain.tag);
        }
      }

      const normalizedTags = normalizeIndustryTags(tags);
      if (normalizedTags.length > 0) {
        return normalizedTags;
      }
    } catch {
      // Fall through to legacy
    }

    return scoreIndustryTagsLegacy(haystack);
  }

  getIndex(sampleKey: string): Map<string, ResumeIndex> | undefined {
    return this.indexCache.get(sampleKey);
  }

  clearCache(): void {
    this.indexCache.clear();
  }
}

export const resumeIndexService = new ResumeIndexService();
