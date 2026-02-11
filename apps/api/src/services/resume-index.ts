import fs from "node:fs";
import path from "node:path";

import { findProjectRoot } from "./db.js";
import { normalizeEducationLevel, parseExperienceYears, parseSalaryRange } from "./resume-parsing.js";
import { extractCompanies, extractSkills, resolveResumeId } from "./resume-utils.js";

import type { ResumeItem, ResumeSampleFile } from "../types/resume.js";

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

type Vocabulary = Map<string, string[]>;

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function safeParseVocabularyLine(line: string): string[] {
  const tokens = line
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !token.startsWith("!"));
  return tokens.length ? tokens : [];
}

function parseSkillsVocabulary(content: string): Vocabulary {
  const map: Vocabulary = new Map();
  let currentTag: string | null = null;

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      const tag = trimmed.replace(/^#+/, "").trim();
      currentTag = tag ? normalizeToken(tag) : null;
      continue;
    }
    if (!currentTag) continue;
    if (trimmed.startsWith("!")) continue;

    const tokens = safeParseVocabularyLine(trimmed);
    if (!tokens.length) continue;

    const existing = map.get(currentTag) ?? [];
    map.set(currentTag, [...existing, ...tokens]);
  }

  for (const [tag, keywords] of map.entries()) {
    map.set(tag, uniq(keywords.map((k) => normalizeToken(k))).filter(Boolean));
  }

  return map;
}

function matchVocabulary(searchText: string, keyword: string): boolean {
  const normalized = normalizeToken(keyword);
  if (!normalized) return false;
  if (normalized.includes("|")) {
    try {
      const pattern = new RegExp(normalized, "i");
      return pattern.test(searchText);
    } catch (error) {
      console.error("[ResumeIndex] Invalid vocabulary regex:", normalized, error);
      return false;
    }
  }
  return searchText.includes(normalized);
}

function normalizeLocationCity(location: string): string | null {
  const normalized = location.trim();
  if (!normalized) return null;

  const parts = normalized.split(/[\s\-—–/，,、·]+/g).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  // Heuristic: prefer the last token when the first looks like a province (ends with 省)
  if (parts.length > 1 && /省$/.test(parts[0])) {
    return parts[parts.length - 1];
  }

  return parts[0];
}

function buildSearchText(resume: ResumeItem, skills: string[], companies: string[]): string {
  const parts: string[] = [
    resume.name,
    resume.jobIntention,
    resume.selfIntro,
    resume.education,
    resume.location,
    resume.expectedSalary,
    ...skills,
    ...companies,
    ...(resume.workHistory?.map((item) => item.raw) ?? []),
  ].filter(Boolean);

  return parts.join(" ").toLowerCase();
}

export class ResumeIndexService {
  readonly projectRoot: string;
  private cachedKey: string | null = null;
  private indexByResumeId: Map<string, ResumeIndex> = new Map();
  private vocabulary: Vocabulary | null = null;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
  }

  private getVocabulary(): Vocabulary {
    if (this.vocabulary) return this.vocabulary;

    const vocabPath = path.join(this.projectRoot, "config", "resume", "skills_words.txt");
    if (!fs.existsSync(vocabPath)) {
      this.vocabulary = new Map();
      return this.vocabulary;
    }

    const content = fs.readFileSync(vocabPath, "utf8");
    this.vocabulary = parseSkillsVocabulary(content);
    return this.vocabulary;
  }

  private inferIndustryTags(searchText: string): string[] {
    const vocab = this.getVocabulary();
    if (vocab.size === 0) return [];

    const tags: string[] = [];
    for (const [tag, keywords] of vocab.entries()) {
      if (!keywords.length) continue;
      if (keywords.some((keyword) => matchVocabulary(searchText, keyword))) {
        tags.push(tag);
      }
    }
    return tags;
  }

  inferIndustryTagsFromText(text: string): string[] {
    const normalized = text.trim();
    if (!normalized) return [];
    return this.inferIndustryTags(normalized.toLowerCase());
  }

  /**
   * Build and cache indexes for a sample.
   * The cache key should change when the underlying sample changes (e.g. filename + mtime).
   */
  indexSample(params: { items: ResumeItem[]; sample: ResumeSampleFile }): Map<string, ResumeIndex> {
    const cacheKey = `${params.sample.filename}:${params.sample.updatedAt}:${params.items.length}`;
    if (this.cachedKey === cacheKey && this.indexByResumeId.size > 0) {
      return this.indexByResumeId;
    }

    this.cachedKey = cacheKey;
    this.indexByResumeId = new Map();

    params.items.forEach((resume, index) => {
      const resumeId = resolveResumeId(resume, index);
      const skills = extractSkills(resume.jobIntention) ?? [];
      const companies = extractCompanies(resume.workHistory) ?? [];
      const searchText = buildSearchText(resume, skills, companies);
      const industryTags = this.inferIndustryTagsFromText(searchText);
      const salary = parseSalaryRange(resume.expectedSalary);

      const entry: ResumeIndex = {
        resumeId,
        experienceYears: parseExperienceYears(resume.experience),
        educationLevel: normalizeEducationLevel(resume.education),
        locationCity: normalizeLocationCity(resume.location),
        skills: uniq(skills),
        companies: uniq(companies),
        industryTags: uniq(industryTags),
        salaryRange: salary ? { min: salary.min, max: salary.max } : null,
        searchText,
      };

      this.indexByResumeId.set(resumeId, entry);
    });

    return this.indexByResumeId;
  }

  get(resumeId: string): ResumeIndex | undefined {
    return this.indexByResumeId.get(resumeId);
  }

  getMany(resumeIds: string[]): ResumeIndex[] {
    const results: ResumeIndex[] = [];
    for (const resumeId of resumeIds) {
      const index = this.indexByResumeId.get(resumeId);
      if (index) {
        results.push(index);
      }
    }
    return results;
  }

  clear(): void {
    this.cachedKey = null;
    this.indexByResumeId.clear();
  }
}
