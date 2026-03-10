import fs from "node:fs";
import path from "node:path";

import JSON5 from "json5";
import { parse as parseYaml } from "yaml";

import { findProjectRoot } from "./db.js";
import {
  DEFAULT_RESUME_AI_PROMPT_LOCALE,
  ResumeAiPromptService,
  type ResumeAiPromptDocument,
  type ResumeAiPromptSourceSummary,
} from "./resume-ai-prompt-service.js";

export type ConfigSourceType = "markdown" | "json5" | "text";

export interface ConfigSourceMetadata {
  version?: number;
  updatedAt?: string;
  description?: string;
  locale?: string;
  requestedLocale?: string;
  resolvedSourceLocale?: string;
  fallbackToZhHans?: boolean;
}

export interface ConfigSourceSummary {
  key: string;
  label: string;
  relativePath: string;
  type: ConfigSourceType;
  readOnly: true;
  metadata?: ConfigSourceMetadata;
  parseError?: string;
}

export interface ConfigSourceDetail extends ConfigSourceSummary {
  rawSource: string;
  parsedPreview: unknown;
}

type StaticSourceDefinition = {
  key: string;
  label: string;
  relativePath: string;
  type: ConfigSourceType;
};

type MarkdownSectionPreview = {
  heading: string;
  lineCount: number;
  subsectionHeadings: string[];
};

type MarkdownPreview = {
  frontmatter?: Record<string, unknown>;
  sections: MarkdownSectionPreview[];
};

export class UnknownConfigSourceError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Unknown config source: ${key}`);
    this.name = "UnknownConfigSourceError";
    this.key = key;
  }
}

const STATIC_SOURCES: StaticSourceDefinition[] = [
  {
    key: "resume-agents",
    label: "Resume agent pipeline",
    relativePath: "config/resume/agents.json5",
    type: "json5",
  },
  {
    key: "resume-skills",
    label: "Resume skills taxonomy",
    relativePath: "config/resume/skills.md",
    type: "markdown",
  },
  {
    key: "resume-skills-words",
    label: "Resume legacy skill words",
    relativePath: "config/resume/skills_words.txt",
    type: "text",
  },
  {
    key: "resume-rule-weights",
    label: "Resume rule weights",
    relativePath: "config/resume/rule-weights.json5",
    type: "json5",
  },
  {
    key: "resume-filter-presets",
    label: "Resume filter presets",
    relativePath: "config/resume/filter-presets.json5",
    type: "json5",
  },
  {
    key: "resume-custom-keywords",
    label: "Resume custom keywords",
    relativePath: "config/resume/custom-keywords.json5",
    type: "json5",
  },
  {
    key: "resume-session",
    label: "Resume session config",
    relativePath: "config/resume/session.json5",
    type: "json5",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function splitFrontmatter(rawSource: string): { frontmatter?: Record<string, unknown>; body: string } {
  const lines = rawSource.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { body: rawSource };
  }

  let frontmatterEnd = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      frontmatterEnd = index;
      break;
    }
  }

  if (frontmatterEnd === -1) {
    return { body: rawSource };
  }

  const parsed = parseYaml(lines.slice(1, frontmatterEnd).join("\n")) as unknown;
  return {
    frontmatter: isRecord(parsed) ? parsed : undefined,
    body: lines.slice(frontmatterEnd + 1).join("\n"),
  };
}

function parseMarkdownPreview(rawSource: string): MarkdownPreview {
  const { frontmatter, body } = splitFrontmatter(rawSource);
  const lines = body.split("\n");
  const sections: MarkdownSectionPreview[] = [];
  let inFence = false;
  let currentHeading: string | null = null;
  let currentLines: string[] = [];
  let currentSubsections: string[] = [];

  const flush = (): void => {
    if (!currentHeading) {
      currentLines = [];
      currentSubsections = [];
      return;
    }
    sections.push({
      heading: currentHeading,
      lineCount: currentLines.length,
      subsectionHeadings: [...currentSubsections],
    });
    currentLines = [];
    currentSubsections = [];
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

    if (!inFence && currentHeading && line.startsWith("### ")) {
      currentSubsections.push(line.slice(4).trim());
    }

    if (currentHeading) {
      currentLines.push(line);
    }
  }

  flush();
  return {
    frontmatter,
    sections,
  };
}

function toMetadata(frontmatter: Record<string, unknown> | undefined): ConfigSourceMetadata | undefined {
  if (!frontmatter) {
    return undefined;
  }

  const metadata: ConfigSourceMetadata = {};
  const version = readNumber(frontmatter.version);
  const updatedAt = readString(frontmatter.updated_at) ?? readString(frontmatter.updatedAt);
  const description = readString(frontmatter.description);

  if (version !== undefined) {
    metadata.version = version;
  }
  if (updatedAt) {
    metadata.updatedAt = updatedAt;
  }
  if (description) {
    metadata.description = description;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function buildPromptSummary(key: string, label: string, document: ResumeAiPromptDocument): ConfigSourceSummary {
  return {
    key,
    label,
    relativePath: document.sourceFileRelativePath,
    type: "markdown",
    readOnly: true,
    metadata: {
      version: document.metadata.version,
      updatedAt: document.metadata.updatedAt,
      description: document.metadata.description,
      locale: document.resolution.requestedLocale,
      resolvedSourceLocale: document.resolution.resolvedSourceLocale,
      fallbackToZhHans: document.resolution.fallbackToZhHans,
    },
  };
}

function buildPromptDetail(key: string, label: string, document: ResumeAiPromptDocument): ConfigSourceDetail {
  return {
    ...buildPromptSummary(key, label, document),
    rawSource: document.rawMarkdown,
    parsedPreview: {
      metadata: document.metadata,
      resolution: document.resolution,
      sections: document.sections,
      normalized: document.normalized,
    },
  };
}

export class ConfigSourceInspector {
  readonly projectRoot: string;
  private readonly promptService: ResumeAiPromptService;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    this.promptService = new ResumeAiPromptService(this.projectRoot);
  }

  private buildStaticBase(definition: StaticSourceDefinition): ConfigSourceSummary {
    return {
      key: definition.key,
      label: definition.label,
      relativePath: definition.relativePath,
      type: definition.type,
      readOnly: true,
    };
  }

  private readStaticSource(definition: StaticSourceDefinition): ConfigSourceDetail {
    const absolutePath = path.join(this.projectRoot, definition.relativePath);
    const rawSource = fs.readFileSync(absolutePath, "utf8");
    const base = this.buildStaticBase(definition);

    if (definition.type === "markdown") {
      const preview = parseMarkdownPreview(rawSource);
      return {
        ...base,
        metadata: toMetadata(preview.frontmatter),
        rawSource,
        parsedPreview: preview,
      };
    }

    if (definition.type === "json5") {
      return {
        ...base,
        rawSource,
        parsedPreview: JSON5.parse(rawSource),
      };
    }

    return {
      ...base,
      rawSource,
      parsedPreview: rawSource.split(/\r?\n/),
    };
  }

  private buildStaticSummary(definition: StaticSourceDefinition): ConfigSourceSummary | null {
    const absolutePath = path.join(this.projectRoot, definition.relativePath);

    try {
      const rawSource = fs.readFileSync(absolutePath, "utf8");
      const base = this.buildStaticBase(definition);
      if (definition.type !== "markdown") {
        return base;
      }

      return {
        ...base,
        metadata: toMetadata(splitFrontmatter(rawSource).frontmatter),
      };
    } catch (error) {
      if (readErrorCode(error) === "ENOENT") {
        return null;
      }
      return {
        key: definition.key,
        label: definition.label,
        relativePath: definition.relativePath,
        type: definition.type,
        readOnly: true,
        parseError: error instanceof Error ? error.message : "Failed to parse config source",
      };
    }
  }

  private buildPromptVariantKey(locale: string): string {
    return `resume-ai-prompts-${locale}`;
  }

  private buildPromptVariantSummary(source: ResumeAiPromptSourceSummary): ConfigSourceSummary {
    return {
      key: this.buildPromptVariantKey(source.locale),
      label: `Resume AI prompts (${source.locale})`,
      relativePath: source.fileRelativePath,
      type: "markdown",
      readOnly: true,
      metadata: {
        version: source.metadata.version,
        updatedAt: source.metadata.updatedAt,
        description: source.metadata.description,
        locale: source.locale,
      },
    };
  }

  listSources(requestedLocale = process.env.AI_OUTPUT_LOCALE): ConfigSourceSummary[] {
    const promptService = this.promptService;
    const activePrompt = promptService.loadPrompt(requestedLocale);
    const summaries: ConfigSourceSummary[] = [
      buildPromptSummary("resume-ai-prompts-active", "Resume AI prompts (active locale)", activePrompt),
      ...promptService.listAvailablePromptSources().map((source) => this.buildPromptVariantSummary(source)),
    ];

    for (const definition of STATIC_SOURCES) {
      const summary = this.buildStaticSummary(definition);
      if (summary) {
        summaries.push(summary);
      }
    }

    return summaries;
  }

  getSource(key: string, requestedLocale = process.env.AI_OUTPUT_LOCALE): ConfigSourceDetail {
    const promptService = this.promptService;

    if (key === "resume-ai-prompts-active") {
      return buildPromptDetail(key, "Resume AI prompts (active locale)", promptService.loadPrompt(requestedLocale));
    }

    if (key === this.buildPromptVariantKey(DEFAULT_RESUME_AI_PROMPT_LOCALE)) {
      return buildPromptDetail(
        key,
        `Resume AI prompts (${DEFAULT_RESUME_AI_PROMPT_LOCALE})`,
        promptService.loadPromptVariant(DEFAULT_RESUME_AI_PROMPT_LOCALE),
      );
    }

    if (key.startsWith("resume-ai-prompts-")) {
      const locale = key.slice("resume-ai-prompts-".length);
      return buildPromptDetail(key, `Resume AI prompts (${locale})`, promptService.loadPromptVariant(locale));
    }

    const definition = STATIC_SOURCES.find((item) => item.key === key);
    if (!definition) {
      throw new UnknownConfigSourceError(key);
    }

    return this.readStaticSource(definition);
  }
}

export const configSourceInspector = new ConfigSourceInspector();
