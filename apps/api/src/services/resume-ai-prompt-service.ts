import fs from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import { findProjectRoot } from "./db.js";
import { FileParseError } from "./errors.js";

export const DEFAULT_RESUME_AI_PROMPT_LOCALE = "zh-Hans";

export const LOCALE_TO_NATURAL_LANGUAGE: Record<string, string> = {
  "zh-Hans": "Simplified Chinese",
  "zh-Hant": "Traditional Chinese",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
};

const SECTION_HEADING_TO_KEY = {
  "System Prompt": "systemPrompt",
  "User Prompt Template": "userPromptTemplate",
  "Output Contract": "outputContract",
  "Prompt Variables": "promptVariables",
  Notes: "notes",
} as const;

const REQUIRED_SECTION_KEYS = [
  "systemPrompt",
  "userPromptTemplate",
  "outputContract",
  "promptVariables",
  "notes",
] as const;

type ResumeAiPromptSectionKey = (typeof REQUIRED_SECTION_KEYS)[number];

type Frontmatter = {
  version: number;
  updated_at: string;
  description: string;
};

type ParsedSection = {
  heading: string;
  content: string;
};

export interface ResumeAiPromptMetadata {
  version: number;
  updatedAt: string;
  description: string;
}

export interface ResumeAiPromptSections {
  systemPrompt: string;
  userPromptTemplate: string;
  outputContract: string;
  promptVariables: string;
  notes: string;
}

export interface ResumeAiPromptLocaleResolution {
  requestedLocale: string;
  resolvedSourceLocale: string;
  resolvedFilePath: string;
  fallbackToZhHans: boolean;
  naturalLanguage: string;
}

export interface ResumeAiPromptNormalized {
  version: number;
  locale: string;
  sourceLocale: string;
  systemPrompt: string;
  userPromptTemplate: string;
  outputContract: string;
  promptVariables: string;
  notes: string;
}

export type ResumeAiPromptTemplateValues = Record<string, string>;

export interface ResumeAiPromptDocument {
  metadata: ResumeAiPromptMetadata;
  sections: ResumeAiPromptSections;
  normalized: ResumeAiPromptNormalized;
  rawMarkdown: string;
  sourceFilePath: string;
  sourceFileRelativePath: string;
  resolution: ResumeAiPromptLocaleResolution;
}

export interface ResumeAiPromptSourceSummary {
  locale: string;
  filePath: string;
  fileRelativePath: string;
  metadata: ResumeAiPromptMetadata;
}

type CachedPromptDocument = {
  mtimeMs: number;
  metadata: ResumeAiPromptMetadata;
  sections: ResumeAiPromptSections;
  rawMarkdown: string;
  sourceFilePath: string;
  sourceFileRelativePath: string;
};

type CachedVariantLocales = {
  mtimeMs: number;
  locales: Set<string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function toPosixRelative(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

function stripOuterCodeFence(content: string): string {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:[\w-]+)?\n([\s\S]*?)\n```$/);
  return match?.[1]?.trim() ?? trimmed;
}

function splitFrontmatter(rawMarkdown: string, filePath: string): { frontmatter: Frontmatter; body: string } {
  const lines = rawMarkdown.split("\n");
  if (lines[0]?.trim() !== "---") {
    throw new FileParseError(filePath, "Invalid frontmatter: missing opening ---");
  }

  let frontmatterEnd = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      frontmatterEnd = index;
      break;
    }
  }

  if (frontmatterEnd === -1) {
    throw new FileParseError(filePath, "Invalid frontmatter: missing closing ---");
  }

  const parsed = parseYaml(lines.slice(1, frontmatterEnd).join("\n")) as unknown;
  if (!isRecord(parsed)) {
    throw new FileParseError(filePath, "Invalid frontmatter: expected object");
  }

  const version = readNumber(parsed.version);
  const updatedAt = readString(parsed.updated_at);
  const description = readString(parsed.description);
  if (version === null || !updatedAt || !description) {
    throw new FileParseError(filePath, "Invalid frontmatter: version, updated_at, and description are required");
  }

  return {
    frontmatter: {
      version,
      updated_at: updatedAt,
      description,
    },
    body: lines.slice(frontmatterEnd + 1).join("\n"),
  };
}

function parseTopLevelSections(body: string, filePath: string): Map<string, ParsedSection> {
  const lines = body.split("\n");
  const sections = new Map<string, ParsedSection>();
  let inFence = false;
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  const flush = (): void => {
    if (!currentHeading) {
      currentLines = [];
      return;
    }
    sections.set(currentHeading, {
      heading: currentHeading,
      content: currentLines.join("\n").trim(),
    });
    currentLines = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
    }

    if (!inFence && line.startsWith("## ")) {
      flush();
      currentHeading = line.slice(3).trim();
      continue;
    }

    if (currentHeading) {
      currentLines.push(line);
    }
  }

  flush();

  for (const sectionKey of Object.keys(SECTION_HEADING_TO_KEY)) {
    if (!sections.has(sectionKey)) {
      throw new FileParseError(filePath, `Missing required section: ${sectionKey}`);
    }
  }

  return sections;
}

function toSections(sectionMap: Map<string, ParsedSection>): ResumeAiPromptSections {
  const parsed = {} as ResumeAiPromptSections;
  for (const [heading, key] of Object.entries(SECTION_HEADING_TO_KEY)) {
    const section = sectionMap.get(heading);
    if (!section) {
      throw new Error(`Missing parsed section for ${heading}`);
    }
    parsed[key] = key === "promptVariables" || key === "notes"
      ? section.content.trim()
      : stripOuterCodeFence(section.content);
  }
  return parsed;
}

function buildNormalizedPrompt(
  metadata: ResumeAiPromptMetadata,
  sections: ResumeAiPromptSections,
  resolution: ResumeAiPromptLocaleResolution,
): ResumeAiPromptNormalized {
  return {
    version: metadata.version,
    locale: resolution.requestedLocale,
    sourceLocale: resolution.resolvedSourceLocale,
    systemPrompt: sections.systemPrompt.trim(),
    userPromptTemplate: [sections.userPromptTemplate.trim(), sections.outputContract.trim()].join("\n\n").trim(),
    outputContract: sections.outputContract.trim(),
    promptVariables: sections.promptVariables.trim(),
    notes: sections.notes.trim(),
  };
}

function getMissingTemplateVariables(template: string, values: ResumeAiPromptTemplateValues): string[] {
  return Object.keys(values).filter((key) => !template.includes(`{${key}}`));
}

function renderPromptTemplate(template: string, values: ResumeAiPromptTemplateValues): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template,
  );
}

export class ResumeAiPromptService {
  readonly projectRoot: string;
  private readonly cache = new Map<string, CachedPromptDocument>();
  private cachedVariantLocales?: CachedVariantLocales;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
  }

  private getConfigDir(): string {
    return path.join(this.projectRoot, "config", "resume");
  }

  private getMasterPromptPath(): string {
    return path.join(this.getConfigDir(), "ai-prompts.md");
  }

  private getLocaleVariantPath(locale: string): string {
    return path.join(this.getConfigDir(), `ai-prompts.${locale}.md`);
  }

  private listVariantLocales(): Set<string> {
    const configDir = this.getConfigDir();
    const configDirStat = fs.statSync(configDir);
    const cached = this.cachedVariantLocales;
    if (cached && cached.mtimeMs === configDirStat.mtimeMs) {
      return cached.locales;
    }

    const locales = new Set(
      fs.readdirSync(configDir)
        .filter((fileName) => /^ai-prompts\.[^.]+\.md$/.test(fileName))
        .map((fileName) => fileName.slice("ai-prompts.".length, -".md".length)),
    );

    this.cachedVariantLocales = {
      mtimeMs: configDirStat.mtimeMs,
      locales,
    };

    return locales;
  }

  private hasLocaleVariant(locale: string): boolean {
    if (!locale || locale === DEFAULT_RESUME_AI_PROMPT_LOCALE) {
      return false;
    }
    try {
      return this.listVariantLocales().has(locale);
    } catch (error) {
      if (readErrorCode(error) === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  private normalizeRequestedLocale(requestedLocale?: string): string {
    const trimmed = requestedLocale?.trim();
    if (!trimmed) {
      return DEFAULT_RESUME_AI_PROMPT_LOCALE;
    }
    if (trimmed === DEFAULT_RESUME_AI_PROMPT_LOCALE) {
      return trimmed;
    }
    if (LOCALE_TO_NATURAL_LANGUAGE[trimmed] || this.hasLocaleVariant(trimmed)) {
      return trimmed;
    }
    return DEFAULT_RESUME_AI_PROMPT_LOCALE;
  }

  resolveLocale(requestedLocale?: string): ResumeAiPromptLocaleResolution {
    const normalizedRequestedLocale = this.normalizeRequestedLocale(requestedLocale);
    const hasRequestedVariant = this.hasLocaleVariant(normalizedRequestedLocale);
    const resolvedSourceLocale = hasRequestedVariant
      ? normalizedRequestedLocale
      : DEFAULT_RESUME_AI_PROMPT_LOCALE;
    const resolvedFilePath = resolvedSourceLocale === DEFAULT_RESUME_AI_PROMPT_LOCALE
      ? this.getMasterPromptPath()
      : this.getLocaleVariantPath(resolvedSourceLocale);

    return {
      requestedLocale: normalizedRequestedLocale,
      resolvedSourceLocale,
      resolvedFilePath: toPosixRelative(this.projectRoot, resolvedFilePath),
      fallbackToZhHans: normalizedRequestedLocale !== DEFAULT_RESUME_AI_PROMPT_LOCALE
        && resolvedSourceLocale === DEFAULT_RESUME_AI_PROMPT_LOCALE,
      naturalLanguage: LOCALE_TO_NATURAL_LANGUAGE[normalizedRequestedLocale] ?? normalizedRequestedLocale,
    };
  }

  private readPromptFile(filePath: string): CachedPromptDocument {
    const stat = fs.statSync(filePath);
    const cached = this.cache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached;
    }

    const rawMarkdown = fs.readFileSync(filePath, "utf8");
    const { frontmatter, body } = splitFrontmatter(rawMarkdown, filePath);
    const sectionMap = parseTopLevelSections(body, filePath);
    const sections = toSections(sectionMap);

    for (const key of REQUIRED_SECTION_KEYS) {
      if (!sections[key].trim()) {
        throw new FileParseError(filePath, `Empty required section: ${key}`);
      }
    }

    const nextCached: CachedPromptDocument = {
      mtimeMs: stat.mtimeMs,
      metadata: {
        version: frontmatter.version,
        updatedAt: frontmatter.updated_at,
        description: frontmatter.description,
      },
      sections,
      rawMarkdown,
      sourceFilePath: filePath,
      sourceFileRelativePath: toPosixRelative(this.projectRoot, filePath),
    };

    this.cache.set(filePath, nextCached);
    return nextCached;
  }

  loadPrompt(requestedLocale?: string): ResumeAiPromptDocument {
    const resolution = this.resolveLocale(requestedLocale);
    const absoluteFilePath = path.join(this.projectRoot, resolution.resolvedFilePath);

    const cached = this.readPromptFile(absoluteFilePath);
    return {
      metadata: cached.metadata,
      sections: cached.sections,
      normalized: buildNormalizedPrompt(cached.metadata, cached.sections, resolution),
      rawMarkdown: cached.rawMarkdown,
      sourceFilePath: absoluteFilePath,
      sourceFileRelativePath: cached.sourceFileRelativePath,
      resolution,
    };
  }

  loadPromptFromEnv(): ResumeAiPromptDocument {
    return this.loadPrompt(process.env.AI_OUTPUT_LOCALE);
  }

  loadPromptVariant(locale: string): ResumeAiPromptDocument {
    const trimmedLocale = locale.trim();
    const filePath = trimmedLocale === DEFAULT_RESUME_AI_PROMPT_LOCALE
      ? this.getMasterPromptPath()
      : this.getLocaleVariantPath(trimmedLocale);

    if (!fs.existsSync(filePath)) {
      throw new FileParseError(filePath, `ai-prompts locale variant not found: ${trimmedLocale}`);
    }

    const cached = this.readPromptFile(filePath);
    const resolution: ResumeAiPromptLocaleResolution = {
      requestedLocale: trimmedLocale,
      resolvedSourceLocale: trimmedLocale,
      resolvedFilePath: cached.sourceFileRelativePath,
      fallbackToZhHans: false,
      naturalLanguage: LOCALE_TO_NATURAL_LANGUAGE[trimmedLocale] ?? trimmedLocale,
    };

    return {
      metadata: cached.metadata,
      sections: cached.sections,
      normalized: buildNormalizedPrompt(cached.metadata, cached.sections, resolution),
      rawMarkdown: cached.rawMarkdown,
      sourceFilePath: cached.sourceFilePath,
      sourceFileRelativePath: cached.sourceFileRelativePath,
      resolution,
    };
  }

  listAvailablePromptSources(): ResumeAiPromptSourceSummary[] {
    const sources: ResumeAiPromptSourceSummary[] = [];
    const master = this.readPromptFile(this.getMasterPromptPath());
    sources.push({
      locale: DEFAULT_RESUME_AI_PROMPT_LOCALE,
      filePath: master.sourceFilePath,
      fileRelativePath: master.sourceFileRelativePath,
      metadata: master.metadata,
    });

    let locales: string[] = [];
    try {
      locales = [...this.listVariantLocales()].sort();
    } catch (error) {
      if (readErrorCode(error) !== "ENOENT") {
        throw error;
      }
    }

    for (const locale of locales) {
      const filePath = this.getLocaleVariantPath(locale);
      const parsed = this.readPromptFile(filePath);
      sources.push({
        locale,
        filePath,
        fileRelativePath: parsed.sourceFileRelativePath,
        metadata: parsed.metadata,
      });
    }

    return sources;
  }

  renderUserPromptTemplate(template: string, values: ResumeAiPromptTemplateValues): string {
    const missing = getMissingTemplateVariables(template, values);
    if (missing.length > 0) {
      throw new FileParseError(template, `Prompt template missing variables: ${missing.join(", ")}`);
    }
    return renderPromptTemplate(template, values);
  }

  clearCache(): void {
    this.cache.clear();
    this.cachedVariantLocales = undefined;
  }
}

export const resumeAiPromptService = new ResumeAiPromptService();
