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
      // Match: - NAME (aliases: a1, a2, a3)
      const match = line.match(/^-\s*([^(]+)\s*\(aliases:\s*([^)]+)\)$/);
      if (match) {
        const name = match[1].trim().toLowerCase();
        const aliases = match[2]
          .split(",")
          .map((a) => a.trim().toLowerCase())
          .filter((a) => a.length > 0);

        const allNames = [name, ...aliases];
        patterns.push({ name, aliases, allNames });
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

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache = null;
  }
}

// Singleton
export const skillsKnowledgeService = new SkillsKnowledgeService();
