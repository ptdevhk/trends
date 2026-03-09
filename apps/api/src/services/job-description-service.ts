/**
 * Enhanced Job Description Service
 * 
 * Parses JD files with auto_match frontmatter for minimal-input matching
 */

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { findProjectRoot } from "./db.js";
import { DataNotFoundError } from "./errors.js";

// Types
export interface AutoMatchConfig {
  keywords: string[];
}

export interface SuggestedFiltersConfig {
  minExperience?: number;
  maxExperience?: number;
  minAge?: number;
  maxAge?: number;
  education?: string[];
}

export interface RequiredRoleConfig {
  type: string;
  min_years?: number;
  signals: string[];
  verify_in?: string;
}

export interface JobDescriptionFile {
  id: string;
  name: string;
  filename: string;
  updatedAt: string;
  size: number;
  title?: string;
  titleEn?: string;
  status?: string;
  location?: string;
  autoMatch?: AutoMatchConfig;
  filterPreset?: string;
  suggestedFilters?: SuggestedFiltersConfig;
  requiredRoles?: RequiredRoleConfig[];
}

export interface JobDescriptionFull extends JobDescriptionFile {
  content: string;
  department?: string;
  source?: string;
  extractedAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseSuggestedFilters(frontmatter: Record<string, unknown>): SuggestedFiltersConfig | undefined {
  const autoMatch = isRecord(frontmatter.auto_match) ? frontmatter.auto_match : null;
  const legacySuggestedFilters = autoMatch && isRecord(autoMatch.suggested_filters)
    ? autoMatch.suggested_filters
    : null;

  const minExperience = toOptionalNumber(
    frontmatter.min_experience
    ?? frontmatter.minExperience
    ?? legacySuggestedFilters?.minExperience
    ?? legacySuggestedFilters?.min_experience,
  );
  const maxExperience = toOptionalNumber(
    frontmatter.max_experience
    ?? frontmatter.maxExperience
    ?? legacySuggestedFilters?.maxExperience
    ?? legacySuggestedFilters?.max_experience,
  );
  const minAge = toOptionalNumber(
    frontmatter.min_age
    ?? frontmatter.minAge
    ?? legacySuggestedFilters?.minAge
    ?? legacySuggestedFilters?.min_age,
  );
  const maxAge = toOptionalNumber(
    frontmatter.max_age
    ?? frontmatter.maxAge
    ?? legacySuggestedFilters?.maxAge
    ?? legacySuggestedFilters?.max_age,
  );
  const education = toStringArray(
    frontmatter.education_requirements
    ?? frontmatter.educationRequirements
    ?? legacySuggestedFilters?.education,
  );

  if (
    minExperience === undefined
    && maxExperience === undefined
    && minAge === undefined
    && maxAge === undefined
    && education.length === 0
  ) {
    return undefined;
  }

  return {
    minExperience,
    maxExperience,
    minAge,
    maxAge,
    ...(education.length > 0 ? { education } : {}),
  };
}

function parseFilterPreset(frontmatter: Record<string, unknown>): string | undefined {
  const autoMatch = isRecord(frontmatter.auto_match) ? frontmatter.auto_match : null;
  return readOptionalString(frontmatter.filter_preset)
    ?? readOptionalString(frontmatter.filterPreset)
    ?? readOptionalString(autoMatch?.filter_preset);
}

function parseAutoMatchConfig(value: unknown): AutoMatchConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const keywords = toStringArray(value.keywords);
  if (keywords.length === 0) {
    return undefined;
  }

  return { keywords };
}

function parseRequiredRoles(value: unknown): RequiredRoleConfig[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsed = value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const type = typeof item.type === "string" ? item.type.trim() : "";
      if (!type) {
        return null;
      }

      const signals = toStringArray(item.signals);
      if (signals.length === 0) {
        return null;
      }

      const minYears = toOptionalNumber(item.min_years);
      const verifyIn = typeof item.verify_in === "string" && item.verify_in.trim()
        ? item.verify_in.trim()
        : undefined;

      const role: RequiredRoleConfig = {
        type,
        signals,
      };
      if (typeof minYears === "number") {
        role.min_years = minYears;
      }
      if (verifyIn) {
        role.verify_in = verifyIn;
      }
      return role;
    })
    .filter((item): item is RequiredRoleConfig => item !== null);

  return parsed.length > 0 ? parsed : undefined;
}

export interface JDMatchResult {
  matched?: JobDescriptionFile;
  confidence: number;
  matchedKeywords: string[];
  filterPreset?: string;
  suggestedFilters?: SuggestedFiltersConfig;
}

export class JobDescriptionService {
  readonly projectRoot: string;
  private cache: Map<string, JobDescriptionFull> = new Map();

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
  }

  private getDescriptionsDir(): string {
    return path.join(this.projectRoot, "config", "job-descriptions");
  }

  /**
   * Parse YAML frontmatter from markdown content
   */
  private parseFrontmatter(content: string): Record<string, unknown> {
    const lines = content.split("\n");
    if (lines[0]?.trim() !== "---") return {};

    let frontmatterEnd = -1;
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === "---") {
        frontmatterEnd = i;
        break;
      }
    }

    if (frontmatterEnd === -1) return {};

    const frontmatterYaml = lines.slice(1, frontmatterEnd).join("\n");
    try {
      return parseYaml(frontmatterYaml) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /**
   * Extract title from content (frontmatter or first heading)
   */
  private extractTitle(content: string): string | undefined {
    const fm = this.parseFrontmatter(content);
    if (fm.title) return String(fm.title);

    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("# ")) {
        return trimmed.replace(/^#\s+/, "").trim();
      }
    }
    return undefined;
  }

  /**
   * List all JD files with metadata
   */
  listFiles(includeReadme = false): JobDescriptionFile[] {
    const dir = this.getDescriptionsDir();
    if (!fs.existsSync(dir)) return [];

    const entries = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .filter((f) => includeReadme || f.toLowerCase() !== "readme.md")
      .map((filename) => {
        const filePath = path.join(dir, filename);
        const stat = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, "utf8");
        const fm = this.parseFrontmatter(content);

        return {
          id: (fm.id as string) || filename.replace(/\.md$/i, ""),
          name: filename.replace(/\.md$/i, ""),
          filename,
          updatedAt: stat.mtime.toISOString(),
          size: stat.size,
          title: fm.title as string | undefined,
          titleEn: fm.title_en as string | undefined,
          status: (fm.status as string) || "active",
          location: fm.location as string | undefined,
          autoMatch: parseAutoMatchConfig(fm.auto_match),
          filterPreset: parseFilterPreset(fm),
          suggestedFilters: parseSuggestedFilters(fm),
          requiredRoles: parseRequiredRoles(fm.required_roles),
        } satisfies JobDescriptionFile;
      });

    return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Load a single JD file with full content
   */
  loadFile(name: string): JobDescriptionFull {
    // Check cache
    const cacheKey = name.replace(/\.md$/i, "");
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const dir = this.getDescriptionsDir();
    const normalizedName = name.replace(/\.md$/i, "");
    const filename = `${normalizedName}.md`;
    const filePath = path.join(dir, filename);

    if (!fs.existsSync(filePath)) {
      const available = this.listFiles(true).map((item) => item.name).join(", ");
      throw new DataNotFoundError(`Job description not found: ${name}`, {
        suggestion: available ? `Available: ${available}` : "No job descriptions available",
      });
    }

    const content = fs.readFileSync(filePath, "utf8");
    const stat = fs.statSync(filePath);
    const fm = this.parseFrontmatter(content);

    const jd: JobDescriptionFull = {
      id: (fm.id as string) || normalizedName,
      name: normalizedName,
      filename,
      updatedAt: stat.mtime.toISOString(),
      size: stat.size,
      title: fm.title as string | undefined,
      titleEn: fm.title_en as string | undefined,
      status: (fm.status as string) || "active",
      location: fm.location as string | undefined,
      autoMatch: parseAutoMatchConfig(fm.auto_match),
      filterPreset: parseFilterPreset(fm),
      suggestedFilters: parseSuggestedFilters(fm),
      requiredRoles: parseRequiredRoles(fm.required_roles),
      content,
      department: fm.department as string | undefined,
      source: fm.source as string | undefined,
      extractedAt: fm.extracted_at as string | undefined,
    };

    this.cache.set(cacheKey, jd);
    return jd;
  }

  /**
   * Auto-match JD based on keywords only
   */
  findMatch(keywords: string[]): JDMatchResult {
    const inputKeywords = Array.from(
      new Set(
        keywords
          .map((k) => k.trim().toLowerCase())
          .filter((k) => k.length > 0),
      ),
    );
    if (inputKeywords.length === 0) {
      return {
        confidence: 0,
        matchedKeywords: [],
      };
    }

    const jds = this.listFiles()
      .filter((jd) => jd.status === "active" && jd.autoMatch);

    let bestMatch: { jd: JobDescriptionFile; score: number; matchedKeywords: string[] } | null = null;

    for (const jd of jds) {
      const autoMatch = jd.autoMatch!;
      const jdKeywords = autoMatch.keywords.map((k) => k.toLowerCase());

      // Calculate keyword match
      const matchedKeywords: string[] = [];
      for (const inputKw of inputKeywords) {
        for (const jdKw of jdKeywords) {
          if (jdKw.includes(inputKw) || inputKw.includes(jdKw)) {
            matchedKeywords.push(inputKw);
            break;
          }
        }
      }

      let score = matchedKeywords.length > 0
        ? matchedKeywords.length / inputKeywords.length
        : 0;

      if ((!bestMatch || score > bestMatch.score) && score > 0) {
        bestMatch = { jd, score, matchedKeywords: [...new Set(matchedKeywords)] };
      }
    }

    if (bestMatch && bestMatch.score >= 0.3) {
      return {
        matched: bestMatch.jd,
        confidence: Math.min(bestMatch.score, 1),
        matchedKeywords: bestMatch.matchedKeywords,
        filterPreset: bestMatch.jd.filterPreset,
        suggestedFilters: bestMatch.jd.suggestedFilters,
      };
    }

    return {
      confidence: 0,
      matchedKeywords: [],
    };
  }

  /**
   * Get stats
   */
  getStats(): { total: number; active: number; withAutoMatch: number } {
    const jds = this.listFiles();
    return {
      total: jds.length,
      active: jds.filter((jd) => jd.status === "active").length,
      withAutoMatch: jds.filter((jd) => jd.autoMatch).length,
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Singleton
export const jobDescriptionService = new JobDescriptionService();
