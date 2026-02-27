import fs from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import { FileParseError } from "./errors.js";
import { findProjectRoot } from "./db.js";

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
  displayName: string;
  aliases: string[];
  displayAliases: string[];
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
        const displayName = match[1].trim();
        const name = displayName.toLowerCase();
        const rawRole = match[2]?.trim().toLowerCase();
        const role: CompanyPattern["role"] = rawRole === "employer" || rawRole === "equipment" || rawRole === "both"
          ? rawRole
          : "both";
        const displayAliases = match[3]
          .split(",")
          .map((a) => a.trim())
          .filter((a) => a.length > 0);
        const aliases = displayAliases.map((a) => a.toLowerCase());

        const allNames = [name, ...aliases];
        patterns.push({ name, displayName, aliases, displayAliases, allNames, role });
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
   * Expand query keywords with synonym variants (bidirectional).
   */
  expandQueryWithSynonyms(keywords: string[]): string[] {
    const synonymTable = this.getSynonymTable();
    const synonymEntries = this.parseSkillsFile().synonyms;
    const normalizedKeywords = keywords
      .map((keyword) => normalizeToken(keyword))
      .filter((keyword) => keyword.length >= 2);

    if (normalizedKeywords.length === 0) {
      return [];
    }

    const canonicalGroups = new Map<string, Set<string>>();
    const getCanonical = (term: string): string => synonymTable.get(term) ?? term;

    const addToGroup = (canonical: string, term: string): void => {
      if (term.length < 2) {
        return;
      }
      const group = canonicalGroups.get(canonical);
      if (group) {
        group.add(term);
        return;
      }
      canonicalGroups.set(canonical, new Set([term]));
    };

    for (const entry of synonymEntries) {
      const terms = entry.allTerms
        .map((term) => normalizeToken(term))
        .filter((term) => term.length >= 2);
      const canonical = getCanonical(normalizeToken(entry.canonical));
      addToGroup(canonical, canonical);
      for (const term of terms) {
        const resolved = getCanonical(term);
        addToGroup(canonical, term);
        addToGroup(canonical, resolved);
        addToGroup(resolved, term);
        addToGroup(resolved, resolved);
      }
    }

    for (const [variant, canonical] of synonymTable.entries()) {
      addToGroup(canonical, canonical);
      addToGroup(canonical, variant);
    }

    const expanded: string[] = [];
    const seen = new Set<string>();
    const pushTerm = (term: string): void => {
      if (term.length < 2 || seen.has(term)) {
        return;
      }
      seen.add(term);
      expanded.push(term);
    };

    for (const keyword of normalizedKeywords) {
      const canonical = getCanonical(keyword);
      pushTerm(keyword);
      pushTerm(canonical);

      const group = canonicalGroups.get(canonical);
      if (group) {
        for (const term of group) {
          pushTerm(term);
        }
      }
    }

    return expanded;
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

  applySynonymSuggestions(
    suggestions: Array<{ variant: string; canonical: string }>
  ): number {
    if (suggestions.length === 0) {
      return 0;
    }

    const skillsPath = this.getSkillsPath();
    if (!fs.existsSync(skillsPath)) {
      throw new FileParseError(skillsPath, "skills.md not found");
    }

    const content = fs.readFileSync(skillsPath, "utf8");
    const lines = content.split("\n");
    const synonymHeadingIndex = lines.findIndex((line) => /^##\s+Synonym Table\s*$/i.test(line.trim()));
    if (synonymHeadingIndex === -1) {
      throw new FileParseError(skillsPath, "Synonym Table section not found");
    }

    let sectionEndIndex = lines.length;
    for (let index = synonymHeadingIndex + 1; index < lines.length; index += 1) {
      if (/^##\s+/.test(lines[index].trim())) {
        sectionEndIndex = index;
        break;
      }
    }

    const existing = new Map<string, { canonical: string; variants: Set<string> }>();
    for (const line of lines.slice(synonymHeadingIndex + 1, sectionEndIndex)) {
      const match = line.match(/^\s*-\s*([^:]+):\s*(.+)$/);
      if (!match) {
        continue;
      }

      const canonicalRaw = match[1].trim();
      const canonical = normalizeToken(canonicalRaw);
      if (!canonical) {
        continue;
      }

      const variants = match[2]
        .split(",")
        .map((value) => normalizeToken(value))
        .filter((value) => value.length > 0 && value !== canonical);
      existing.set(canonical, {
        canonical: canonicalRaw,
        variants: new Set(variants),
      });
    }

    let addedCount = 0;
    for (const suggestion of suggestions) {
      const variant = normalizeToken(suggestion.variant);
      const canonical = normalizeToken(suggestion.canonical);
      if (!variant || !canonical || variant === canonical) {
        continue;
      }

      const entry = existing.get(canonical) ?? {
        canonical,
        variants: new Set<string>(),
      };
      if (!entry.variants.has(variant)) {
        entry.variants.add(variant);
        addedCount += 1;
      }
      existing.set(canonical, entry);
    }

    if (addedCount === 0) {
      return 0;
    }

    const synonymLines = Array.from(existing.entries())
      .map(([canonical, entry]) => ({
        canonical,
        variants: Array.from(entry.variants).sort((left, right) => left.localeCompare(right)),
      }))
      .filter((entry) => entry.variants.length > 0)
      .sort((left, right) => left.canonical.localeCompare(right.canonical))
      .map((entry) => `- ${entry.canonical}: ${entry.variants.join(", ")}`);

    const updatedLines = [
      ...lines.slice(0, synonymHeadingIndex + 1),
      "",
      ...synonymLines,
      "",
      ...lines.slice(sectionEndIndex),
    ];

    fs.writeFileSync(skillsPath, updatedLines.join("\n"), "utf8");
    this.clearCache();
    return addedCount;
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
