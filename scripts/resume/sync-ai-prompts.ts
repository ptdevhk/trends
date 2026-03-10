#!/usr/bin/env -S npx tsx

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_RESUME_AI_PROMPT_LOCALE,
  ResumeAiPromptService,
} from "../../apps/api/src/services/resume-ai-prompt-service.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const outputPath = path.join(repoRoot, "packages", "shared", "src", "generated", "resume-ai-prompts.ts");

const LOCALE_TO_NATURAL_LANGUAGE = {
  "zh-Hans": "Simplified Chinese",
  "zh-Hant": "Traditional Chinese",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
} as const;

function renderGeneratedFile(): string {
  const service = new ResumeAiPromptService(repoRoot);
  const sources = service.listAvailablePromptSources();
  const documents = Object.fromEntries(
    sources.map((source) => {
      const document = service.loadPromptVariant(source.locale);
      return [
        source.locale,
        {
          sourceFileRelativePath: document.sourceFileRelativePath,
          metadata: document.metadata,
          sections: document.sections,
        },
      ];
    }),
  );

  return `/* eslint-disable */
// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.
// Source: config/resume/ai-prompts*.md
// Run: make sync-resume-ai-prompts

export const DEFAULT_RESUME_AI_PROMPT_LOCALE = ${JSON.stringify(DEFAULT_RESUME_AI_PROMPT_LOCALE)} as const;

export const RESUME_AI_PROMPT_LOCALE_TO_NATURAL_LANGUAGE = ${JSON.stringify(LOCALE_TO_NATURAL_LANGUAGE, null, 2)} as const;

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

export interface ResumeAiPromptSource {
  sourceFileRelativePath: string;
  metadata: ResumeAiPromptMetadata;
  sections: ResumeAiPromptSections;
}

export interface ResumeAiPromptResolution {
  requestedLocale: string;
  resolvedSourceLocale: string;
  sourceFileRelativePath: string;
  fallbackToZhHans: boolean;
  naturalLanguage: string;
}

export interface ResumeAiPromptDefinition {
  metadata: ResumeAiPromptMetadata;
  sections: ResumeAiPromptSections;
  normalized: {
    version: number;
    locale: string;
    sourceLocale: string;
    systemPrompt: string;
    userPromptTemplate: string;
    outputContract: string;
    promptVariables: string;
    notes: string;
  };
  resolution: ResumeAiPromptResolution;
}

export const RESUME_AI_PROMPT_SOURCES = ${JSON.stringify(documents, null, 2)} as const satisfies Record<string, ResumeAiPromptSource>;

export type ResumeAiPromptSourceLocale = keyof typeof RESUME_AI_PROMPT_SOURCES;

export const RESUME_AI_PROMPT_LOCALES = Object.keys(RESUME_AI_PROMPT_SOURCES).sort() as ResumeAiPromptSourceLocale[];

function normalizeRequestedLocale(requestedLocale?: string): string {
  const trimmed = requestedLocale?.trim();
  if (!trimmed) {
    return DEFAULT_RESUME_AI_PROMPT_LOCALE;
  }
  if (trimmed === DEFAULT_RESUME_AI_PROMPT_LOCALE) {
    return trimmed;
  }
  if (trimmed in RESUME_AI_PROMPT_LOCALE_TO_NATURAL_LANGUAGE || trimmed in RESUME_AI_PROMPT_SOURCES) {
    return trimmed;
  }
  return DEFAULT_RESUME_AI_PROMPT_LOCALE;
}

export function resolveResumeAiPromptLocale(requestedLocale?: string): ResumeAiPromptResolution {
  const normalizedRequestedLocale = normalizeRequestedLocale(requestedLocale);
  const hasRequestedSource = normalizedRequestedLocale in RESUME_AI_PROMPT_SOURCES;
  const resolvedSourceLocale = (hasRequestedSource ? normalizedRequestedLocale : DEFAULT_RESUME_AI_PROMPT_LOCALE) as ResumeAiPromptSourceLocale;
  const source = RESUME_AI_PROMPT_SOURCES[resolvedSourceLocale];

  return {
    requestedLocale: normalizedRequestedLocale,
    resolvedSourceLocale,
    sourceFileRelativePath: source.sourceFileRelativePath,
    fallbackToZhHans: normalizedRequestedLocale !== DEFAULT_RESUME_AI_PROMPT_LOCALE && !hasRequestedSource,
    naturalLanguage: RESUME_AI_PROMPT_LOCALE_TO_NATURAL_LANGUAGE[normalizedRequestedLocale as keyof typeof RESUME_AI_PROMPT_LOCALE_TO_NATURAL_LANGUAGE]
      ?? normalizedRequestedLocale,
  };
}

export function getResumeAiPromptDefinition(requestedLocale?: string): ResumeAiPromptDefinition {
  const resolution = resolveResumeAiPromptLocale(requestedLocale);
  const source = RESUME_AI_PROMPT_SOURCES[resolution.resolvedSourceLocale as ResumeAiPromptSourceLocale];
  const sections = source.sections;
  return {
    metadata: source.metadata,
    sections,
    normalized: {
      version: source.metadata.version,
      locale: resolution.requestedLocale,
      sourceLocale: resolution.resolvedSourceLocale,
      systemPrompt: sections.systemPrompt,
      userPromptTemplate: [sections.userPromptTemplate, sections.outputContract].join(${JSON.stringify("\n\n")}).trim(),
      outputContract: sections.outputContract,
      promptVariables: sections.promptVariables,
      notes: sections.notes,
    },
    resolution,
  };
}

export function buildResumeAiSystemPrompt(requestedLocale?: string): string {
  const definition = getResumeAiPromptDefinition(requestedLocale);
  return [definition.sections.systemPrompt, \
\`Please respond entirely in \${definition.resolution.naturalLanguage}.\`].join(${JSON.stringify("\n")});
}

export function getResumeAiUserPromptTemplate(requestedLocale?: string): string {
  return getResumeAiPromptDefinition(requestedLocale).normalized.userPromptTemplate;
}
`;
}

async function run(): Promise<void> {
  const checkMode = process.argv.includes("--check");
  const expected = renderGeneratedFile();

  if (checkMode) {
    const current = await readFile(outputPath, "utf8");
    if (current !== expected) {
      console.error("Resume AI prompt artifact drift detected.");
      console.error("Run: make sync-resume-ai-prompts");
      process.exit(1);
    }
    console.log("Resume AI prompt artifact is up to date");
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, expected, "utf8");
  console.log(`Generated ${outputPath}`);
}

run().catch((error: unknown) => {
  console.error("Failed to sync resume AI prompts:", error);
  process.exit(1);
});
