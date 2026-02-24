import fs from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import { FileParseError } from "./errors";
import { findProjectRoot } from "./db";

/**
 * Domain entry from skills taxonomy
 */
export interface DomainEntry {
  tag: string;
  displayName: string;
  keywords: string[];
}

/**
 * Synonym mapping entry
 */
export interface SynonymEntry {
  canonical: string;
  variants: string[];
  allTerms: string[];
}

/**
 * Experience level signals
 */
export interface ExperienceLevelSignals {
  level: string;
  displayName: string;
  keywords: string[];
}

/**
 * Company pattern with aliases
 */
export interface CompanyPattern {
  name: string;
  aliases: string[];
  allNames: string[];
  role: "employer" | "equipment" | "both";
}

/**
 * Industry context section
 */
export interface IndustryContextSection {
  heading: string;
  content: string;
}

/**
 * Learning log entry
 */
export interface LearningLogEntry {
  date: string;
  observation: string;
}

export type ActionableLearningPattern =
  | {
      type: "synonym_suggestion";
      date: string;
      raw: string;
      variant: string;
      canonical: string;
    }
  | {
      type: "shortlist_pattern";
      date: string;
      raw: string;
      keywords: string[];
      priority: string;
    }
  | {
      type: "reject_pattern";
      date: string;
      raw: string;
      keyword: string;
      negativeSignal: string;
    }
  | {
      type: "domain_expansion";
      date: string;
      raw: string;
      tag: string;
      newKeyword: string;
    };

export interface SynonymSuggestion {
  query: string;
  variant: string;
  canonical: string;
  confidence: number;
  reason: string;
}

/**
 * Parsed skills knowledge
 */
export interface SkillsKnowledge {
  version: number;
  updatedAt: string;
  domains: DomainEntry[];
  synonyms: SynonymEntry[];
  experienceLevels: ExperienceLevelSignals[];
  companyPatterns: CompanyPattern[];
  industryContext: IndustryContextSection[];
  exclusionTokens: string[];
  learningLog: LearningLogEntry[];
}

const SEARCH_TOKEN_SPLIT_RE = /[\s,，、;；|/]+/;

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function tokenizeQuery(value: string): string[] {
  return value
    .split(SEARCH_TOKEN_SPLIT_RE)
    .map((token) => normalizeToken(token))
    .filter((token) => token.length >= 2);
}

function overlapConfidence(left: string, right: string): number {
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.8;

  let common = 0;
  for (const char of left) {
    if (right.includes(char)) {
      common += 1;
    }
  }

  const ratio = common / Math.max(left.length, right.length);
  if (ratio >= 0.6) return 0.65;
  return 0;
}

/**
 * Service for loading and parsing skills.md knowledge file
 */
export class SkillsKnowledgeService {
  readonly projectRoot: string;
  private cache: SkillsKnowledge | null = null;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
  }

  private getSkillsPath(): string {
    return path.join(this.projectRoot, "config", "resume", "skills.md");
  }

  /**
   * Parse skills.md file
   */
  private parseSkillsFile(): SkillsKnowledge {
    if (this.cache) return this.cache;

    const skillsPath = this.getSkillsPath();

    if (!fs.existsSync(skillsPath)) {
      throw new FileParseError(skillsPath, "skills.md not found");
    }

    const content = fs.readFileSync(skillsPath, "utf8");

    // Parse frontmatter
    const lines = content.split("\n");
    let frontmatterEnd = -1;

    if (lines[0]?.trim() === "---") {
      for (let i = 1; i < lines.length; i += 1) {
        if (lines[i].trim() === "---") {
          frontmatterEnd = i;
          break;
        }
      }
    }

    if (frontmatterEnd === -1) {
      throw new FileParseError(skillsPath, "Invalid frontmatter: no closing ---");
    }

    const frontmatterYaml = lines.slice(1, frontmatterEnd).join("\n");
    const frontmatter = parseYaml(frontmatterYaml) as { version: number; updated_at: string };

    const body = lines.slice(frontmatterEnd + 1).join("\n");

    // Split by top-level sections (## heading)
    const sections = body.split(/\n## /);

    const knowledge: SkillsKnowledge = {
      version: frontmatter.version,
      updatedAt: frontmatter.updated_at,
      domains: [],
      synonyms: [],
      experienceLevels: [],
      companyPatterns: [],
      industryContext: [],
      exclusionTokens: [],
      learningLog: [],
    };

    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed) continue;

      // Identify section by heading
      if (trimmed.startsWith("Domain Taxonomy")) {
        knowledge.domains = this.parseDomainTaxonomy(trimmed);
      } else if (trimmed.startsWith("Synonym Table")) {
        knowledge.synonyms = this.parseSynonymTable(trimmed);
      } else if (trimmed.startsWith("Experience Signals")) {
        knowledge.experienceLevels = this.parseExperienceSignals(trimmed);
      } else if (trimmed.startsWith("Company Patterns")) {
        knowledge.companyPatterns = this.parseCompanyPatterns(trimmed);
      } else if (trimmed.startsWith("Industry Context")) {
        knowledge.industryContext = this.parseIndustryContext(trimmed);
      } else if (trimmed.startsWith("Exclusion Patterns")) {
        knowledge.exclusionTokens = this.parseExclusionPatterns(trimmed);
      } else if (trimmed.startsWith("Learning Log")) {
        knowledge.learningLog = this.parseLearningLog(trimmed);
      }
    }

    this.cache = knowledge;
    return knowledge;
  }

  /**
   * Parse Domain Taxonomy section
   */
  private parseDomainTaxonomy(section: string): DomainEntry[] {
    const entries: DomainEntry[] = [];
    const subsections = section.split(/\n### /);

    for (const sub of subsections) {
      const trimmed = sub.trim();
      if (!trimmed || trimmed.startsWith("Domain Taxonomy")) continue;

      const lines = trimmed.split("\n");
      const tag = lines[0].trim();

      let displayName = tag;
      let keywords: string[] = [];

      for (const line of lines.slice(1)) {
        const displayMatch = line.match(/^-\s*displayName:\s*(.+)$/);
        if (displayMatch) {
          displayName = displayMatch[1].trim();
        }

        const keywordsMatch = line.match(/^-\s*keywords:\s*(.+)$/);
        if (keywordsMatch) {
          keywords = keywordsMatch[1]
            .split(",")
            .map((k) => k.trim().toLowerCase())
            .filter((k) => k.length > 0);
        }
      }

      if (keywords.length > 0) {
        entries.push({ tag, displayName, keywords });
      }
    }

    return entries;
  }

  /**
   * Parse Synonym Table section
   */
  private parseSynonymTable(section: string): SynonymEntry[] {
    const entries: SynonymEntry[] = [];
    const lines = section.split("\n");

    for (const line of lines) {
      const match = line.match(/^-\s*([^:]+):\s*(.+)$/);
      if (match) {
        const canonical = match[1].trim().toLowerCase();
        const variants = match[2]
          .split(",")
          .map((v) => v.trim().toLowerCase())
          .filter((v) => v.length > 0);

        const allTerms = [canonical, ...variants];
        entries.push({ canonical, variants, allTerms });
      }
    }

    return entries;
  }

  /**
   * Parse Experience Signals section
   */
  private parseExperienceSignals(section: string): ExperienceLevelSignals[] {
    const signals: ExperienceLevelSignals[] = [];
    const subsections = section.split(/\n### /);

    for (const sub of subsections) {
      const trimmed = sub.trim();
      if (!trimmed || trimmed.startsWith("Experience Signals")) continue;

      const lines = trimmed.split("\n");
      const level = lines[0].trim();

      let displayName = level;
      let keywords: string[] = [];

      for (const line of lines.slice(1)) {
        const displayMatch = line.match(/^-\s*displayName:\s*(.+)$/);
        if (displayMatch) {
          displayName = displayMatch[1].trim();
        }

        const keywordsMatch = line.match(/^-\s*keywords:\s*(.+)$/);
        if (keywordsMatch) {
          keywords = keywordsMatch[1]
            .split(",")
            .map((k) => k.trim().toLowerCase())
            .filter((k) => k.length > 0);
        }
      }

      if (keywords.length > 0) {
        signals.push({ level, displayName, keywords });
      }
    }

    return signals;
  }

  /**
   * Parse Company Patterns section
   */
  private parseCompanyPatterns(section: string): CompanyPattern[] {
    const patterns: CompanyPattern[] = [];
    const lines = section.split("\n");

    for (const line of lines) {
      // Match: - NAME [role: both] (aliases: a1, a2, a3)
      const match = line.match(
        /^-\s*([^([]+?)\s*(?:\[role:\s*(employer|equipment|both)\])?\s*\(aliases:\s*([^)]+)\)$/i
      );
      if (match) {
        const name = match[1].trim().toLowerCase();
        const rawRole = match[2]?.trim().toLowerCase();
        const role: CompanyPattern["role"] = rawRole === "employer" || rawRole === "equipment" || rawRole === "both"
          ? rawRole
          : "both";
        const aliases = match[3]
          .split(",")
          .map((a) => a.trim().toLowerCase())
          .filter((a) => a.length > 0);

        const allNames = [name, ...aliases];
        patterns.push({ name, aliases, allNames, role });
      }
    }

    return patterns;
  }

  /**
   * Parse Industry Context section
   */
  private parseIndustryContext(section: string): IndustryContextSection[] {
    const contexts: IndustryContextSection[] = [];
    const subsections = section.split(/\n### /);

    for (const sub of subsections) {
      const trimmed = sub.trim();
      if (!trimmed || trimmed.startsWith("Industry Context")) continue;

      const lines = trimmed.split("\n");
      const heading = lines[0].trim();
      const content = lines.slice(1).join("\n").trim();

      if (content) {
        contexts.push({ heading, content });
      }
    }

    return contexts;
  }

  /**
   * Parse Exclusion Patterns section
   */
  private parseExclusionPatterns(section: string): string[] {
    const lines = section.split("\n");

    for (const line of lines) {
      const match = line.match(/^-\s*exclude:\s*(.+)$/);
      if (match) {
        return match[1]
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 0);
      }
    }

    return [];
  }

  /**
   * Parse Learning Log section
   */
  private parseLearningLog(section: string): LearningLogEntry[] {
    const entries: LearningLogEntry[] = [];
    const lines = section.split("\n");

    for (const line of lines) {
      // Match: - YYYY-MM-DD: observation
      const match = line.match(/^-\s*(\d{4}-\d{2}-\d{2}):\s*(.+)$/);
      if (match) {
        entries.push({
          date: match[1],
          observation: match[2].trim(),
        });
      }
    }

    return entries;
  }

  /**
   * Get industry taxonomy (replaces INDUSTRY_MAP and INDUSTRY_KEYWORDS)
   */
  getIndustryTaxonomy(): DomainEntry[] {
    return this.parseSkillsFile().domains;
  }

  /**
   * Get synonym lookup map (variant → canonical)
   */
  getSynonymTable(): Map<string, string> {
    const map = new Map<string, string>();
    const synonyms = this.parseSkillsFile().synonyms;

    for (const entry of synonyms) {
      for (const variant of entry.variants) {
        map.set(variant, entry.canonical);
      }
      // Also map canonical to itself for consistency
      map.set(entry.canonical, entry.canonical);
    }

    const maxIterations = Math.max(1, map.size);
    let changed = true;
    let iterations = 0;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations += 1;

      for (const [variant, canonical] of map.entries()) {
        const parent = map.get(canonical);
        if (!parent || parent === canonical) {
          continue;
        }
        if (parent !== variant) {
          map.set(variant, parent);
          changed = true;
          continue;
        }

        map.set(variant, canonical);
      }
    }

    // Final pass prevents unresolved cycles if the map contains circular pairs.
    for (const [variant, canonical] of map.entries()) {
      const parent = map.get(canonical);
      if (parent === variant && variant !== canonical) {
        map.set(variant, canonical);
      }
    }

    return map;
  }

  /**
   * Get full skill vocabulary (all domain keywords + synonym variants)
   */
  getSkillVocabulary(): Set<string> {
    const vocab = new Set<string>();
    const knowledge = this.parseSkillsFile();

    // Add domain keywords
    for (const domain of knowledge.domains) {
      for (const keyword of domain.keywords) {
        vocab.add(keyword);
      }
    }

    // Add synonym terms
    for (const entry of knowledge.synonyms) {
      for (const term of entry.allTerms) {
        vocab.add(term);
      }
    }

    return vocab;
  }

  /**
   * Get experience level signals
   */
  getExperienceSignals(): ExperienceLevelSignals[] {
    return this.parseSkillsFile().experienceLevels;
  }

  /**
   * Get company patterns
   */
  getCompanyPatterns(): CompanyPattern[] {
    return this.parseSkillsFile().companyPatterns;
  }

  /**
   * Get company lookup set (all company names lowercased)
   */
  getCompanyLookupSet(): Set<string> {
    const lookup = new Set<string>();
    const patterns = this.parseSkillsFile().companyPatterns;

    for (const pattern of patterns) {
      for (const name of pattern.allNames) {
        lookup.add(name);
      }
    }

    return lookup;
  }

  /**
   * Get industry context formatted for AI prompts
   */
  getIndustryContext(): string {
    const sections = this.parseSkillsFile().industryContext;
    return sections.map((s) => `### ${s.heading}\n${s.content}`).join("\n\n");
  }

  /**
   * Get exclusion tokens
   */
  getExclusionTokens(): string[] {
    return this.parseSkillsFile().exclusionTokens;
  }

  /**
   * Get learning log entries
   */
  getLearningLog(): LearningLogEntry[] {
    return this.parseSkillsFile().learningLog;
  }

  extractActionablePatterns(entries?: LearningLogEntry[]): ActionableLearningPattern[] {
    const sourceEntries = entries ?? this.getLearningLog();
    const patterns: ActionableLearningPattern[] = [];

    for (const entry of sourceEntries) {
      const raw = entry.observation.trim();
      if (!raw) {
        continue;
      }

      const synonymMatch = raw.match(/^synonym_suggestion:\s*(.+?)\s*->\s*(.+)$/i);
      if (synonymMatch) {
        const variant = normalizeToken(synonymMatch[1]);
        const canonical = normalizeToken(synonymMatch[2]);
        if (variant && canonical) {
          patterns.push({
            type: "synonym_suggestion",
            date: entry.date,
            raw,
            variant,
            canonical,
          });
        }
        continue;
      }

      const shortlistMatch = raw.match(/^shortlist_pattern:\s*(.+?)\s*->\s*(.+)$/i);
      if (shortlistMatch) {
        const keywords = shortlistMatch[1]
          .split("+")
          .map((keyword) => normalizeToken(keyword))
          .filter((keyword) => keyword.length > 0);
        const priority = shortlistMatch[2].trim();
        if (keywords.length > 0 && priority) {
          patterns.push({
            type: "shortlist_pattern",
            date: entry.date,
            raw,
            keywords,
            priority,
          });
        }
        continue;
      }

      const rejectMatch = raw.match(/^reject_pattern:\s*(.+?)\s*->\s*(.+)$/i);
      if (rejectMatch) {
        const keyword = normalizeToken(rejectMatch[1]);
        const negativeSignal = rejectMatch[2].trim();
        if (keyword && negativeSignal) {
          patterns.push({
            type: "reject_pattern",
            date: entry.date,
            raw,
            keyword,
            negativeSignal,
          });
        }
        continue;
      }

      const expansionMatch = raw.match(/^domain_expansion:\s*(.+?)\s*->\s*(.+)$/i);
      if (expansionMatch) {
        const tag = normalizeToken(expansionMatch[1]);
        const newKeyword = normalizeToken(expansionMatch[2]);
        if (tag && newKeyword) {
          patterns.push({
            type: "domain_expansion",
            date: entry.date,
            raw,
            tag,
            newKeyword,
          });
        }
      }
    }

    return patterns;
  }

  generateSynonymSuggestions(zeroResultQueries: string[]): SynonymSuggestion[] {
    const synonymTable = this.getSynonymTable();
    const vocabulary = this.getSkillVocabulary();
    const canonicalTerms = Array.from(new Set(synonymTable.values()));
    const suggestions: SynonymSuggestion[] = [];
    const seen = new Set<string>();

    for (const rawQuery of zeroResultQueries) {
      const query = normalizeQuery(rawQuery);
      if (!query) {
        continue;
      }

      for (const token of tokenizeQuery(query)) {
        if (synonymTable.has(token) || vocabulary.has(token)) {
          continue;
        }

        let bestCanonical: string | null = null;
        let bestConfidence = 0;

        for (const canonical of canonicalTerms) {
          if (canonical === token) {
            continue;
          }
          const confidence = overlapConfidence(token, canonical);
          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestCanonical = canonical;
          }
        }

        if (!bestCanonical || bestConfidence < 0.6) {
          for (const [variant, canonical] of synonymTable.entries()) {
            if (variant === canonical || canonical === token) {
              continue;
            }
            const confidence = overlapConfidence(token, variant) * 0.9;
            if (confidence > bestConfidence) {
              bestConfidence = confidence;
              bestCanonical = canonical;
            }
          }
        }

        if (!bestCanonical || bestConfidence < 0.6) {
          continue;
        }

        const dedupeKey = `${query}|${token}|${bestCanonical}`;
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);

        suggestions.push({
          query,
          variant: token,
          canonical: bestCanonical,
          confidence: Number(bestConfidence.toFixed(2)),
          reason: "zero_result_overlap",
        });
      }
    }

    return suggestions.sort((left, right) => {
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }
      return left.query.localeCompare(right.query);
    });
  }

  /**
   * Get version number
   */
  getVersion(): number {
    return this.parseSkillsFile().version;
  }

  bumpVersion(): number {
    const skillsPath = this.getSkillsPath();
    if (!fs.existsSync(skillsPath)) {
      throw new FileParseError(skillsPath, "skills.md not found");
    }

    const content = fs.readFileSync(skillsPath, "utf8");
    const lines = content.split("\n");
    if (lines[0]?.trim() !== "---") {
      throw new FileParseError(skillsPath, "Invalid frontmatter: expected opening ---");
    }

    let frontmatterEnd = -1;
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index].trim() === "---") {
        frontmatterEnd = index;
        break;
      }
    }

    if (frontmatterEnd === -1) {
      throw new FileParseError(skillsPath, "Invalid frontmatter: no closing ---");
    }

    const frontmatterLines = lines.slice(1, frontmatterEnd);
    const frontmatter = parseYaml(frontmatterLines.join("\n")) as unknown;
    const currentVersion = (
      isRecord(frontmatter)
      && typeof frontmatter.version === "number"
      && Number.isFinite(frontmatter.version)
    )
      ? Math.floor(frontmatter.version)
      : 0;

    const nextVersion = currentVersion + 1;
    const updatedAt = new Date().toISOString().slice(0, 10);

    let hasVersion = false;
    let hasUpdatedAt = false;

    const updatedFrontmatterLines = frontmatterLines.map((line) => {
      if (/^version\s*:/.test(line)) {
        hasVersion = true;
        return `version: ${nextVersion}`;
      }
      if (/^updated_at\s*:/.test(line)) {
        hasUpdatedAt = true;
        return `updated_at: '${updatedAt}'`;
      }
      return line;
    });

    if (!hasVersion) {
      updatedFrontmatterLines.push(`version: ${nextVersion}`);
    }
    if (!hasUpdatedAt) {
      updatedFrontmatterLines.push(`updated_at: '${updatedAt}'`);
    }

    const nextLines = [
      lines[0],
      ...updatedFrontmatterLines,
      ...lines.slice(frontmatterEnd),
    ];

    fs.writeFileSync(skillsPath, nextLines.join("\n"), "utf8");
    this.clearCache();
    return nextVersion;
  }

  appendLearningEntry(observation: string): string {
    const normalizedObservation = observation.trim();
    if (!normalizedObservation) {
      throw new Error("Observation cannot be empty");
    }

    const skillsPath = this.getSkillsPath();
    if (!fs.existsSync(skillsPath)) {
      throw new FileParseError(skillsPath, "skills.md not found");
    }

    const content = fs.readFileSync(skillsPath, "utf8");
    const lines = content.split("\n");
    const learningLogIndex = lines.findIndex((line) =>
      /^##\s+Learning Log(?:\s*\([^)]*\))?\s*$/i.test(line.trim())
    );

    if (learningLogIndex === -1) {
      throw new FileParseError(skillsPath, "Learning Log section not found");
    }

    let sectionEndIndex = lines.length;
    for (let index = learningLogIndex + 1; index < lines.length; index += 1) {
      if (/^##\s+/.test(lines[index].trim())) {
        sectionEndIndex = index;
        break;
      }
    }

    while (sectionEndIndex > learningLogIndex + 1 && lines[sectionEndIndex - 1].trim() === "") {
      sectionEndIndex -= 1;
    }

    const date = new Date().toISOString().slice(0, 10);
    const entry = `- ${date}: ${normalizedObservation}`;

    const insertLines: string[] = [];
    if (sectionEndIndex === learningLogIndex + 1) {
      insertLines.push("");
    }
    insertLines.push(entry);

    const updatedLines = [
      ...lines.slice(0, sectionEndIndex),
      ...insertLines,
      ...lines.slice(sectionEndIndex),
    ];

    fs.writeFileSync(skillsPath, updatedLines.join("\n"), "utf8");
    this.clearCache();

    return entry;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache = null;
  }
}

// Singleton
export const skillsKnowledgeService = new SkillsKnowledgeService();
