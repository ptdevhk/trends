#!/usr/bin/env -S npx tsx

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

// --- Types (mirrors SharedSearchProfileTemplate in the generated output) ---

type ProfileSource = {
  type: string;
  enabled: boolean;
  priority?: number;
  jobUrl?: string;
  collectLimit?: number;
  maxPages?: number;
};

type ProfileFilters = {
  minExperience?: number;
  maxExperience?: number | null;
  minAge?: number;
  maxAge?: number;
  education?: string[];
  salaryRange?: {
    min?: number;
    max?: number;
    currency?: string;
    period?: string;
  };
  locations?: string[];
};

type ProfileSchedule = {
  enabled: boolean;
  cron?: string;
  timezone?: string;
  maxCandidates?: number;
  notifyOnlyOnNew?: boolean;
};

type ProfileQuickStart = {
  enabled: boolean;
  rank?: number;
  label?: string;
  description?: string;
};

type ProfileSession = {
  scope?: string;
  resetTriggers?: string[];
  retention?: {
    mode?: string;
    archiveAfterDays?: number;
  };
};

type Profile = {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  status: "active" | "paused" | "archived";
  location: string;
  keywords: string[];
  requiredKeywords?: string[];
  jobDescription?: string;
  filterPreset?: string;
  filters?: ProfileFilters;
  schedule?: ProfileSchedule;
  sources?: ProfileSource[];
  quickStart?: ProfileQuickStart;
  session?: ProfileSession;
};

type Template = {
  workspaceSlugs: string[];
  seedLastRunOffsetMs?: number;
  profile: Profile;
};

// --- Helpers ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readWorkspaceSlugs(value: unknown): string[] {
  // Array form: workspaceSlug: [dev, hr]
  const asArray = readStringArray(value);
  if (asArray && asArray.length > 0) return asArray;
  // Scalar form: workspaceSlug: dev
  const asString = readString(value);
  if (asString) return [asString];
  // Default
  return ["dev"];
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return result.length > 0 ? result : undefined;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseSource(raw: unknown): ProfileSource | null {
  if (!isRecord(raw)) return null;
  const type = readString(raw.type);
  if (!type) return null;
  return {
    type,
    enabled: readBoolean(raw.enabled, false),
    priority: readNumber(raw.priority),
    jobUrl: readString(raw.jobUrl),
    collectLimit: readNumber(raw.collectLimit),
    maxPages: readNumber(raw.maxPages),
  };
}

function parseFilters(raw: unknown): ProfileFilters | undefined {
  if (!isRecord(raw)) return undefined;
  const filters: ProfileFilters = {};
  const minExp = readNumber(raw.minExperience);
  if (minExp !== undefined) filters.minExperience = minExp;
  if (raw.maxExperience === null) filters.maxExperience = null;
  else {
    const maxExp = readNumber(raw.maxExperience);
    if (maxExp !== undefined) filters.maxExperience = maxExp;
  }
  const minAge = readNumber(raw.minAge);
  if (minAge !== undefined) filters.minAge = minAge;
  const maxAge = readNumber(raw.maxAge);
  if (maxAge !== undefined) filters.maxAge = maxAge;
  const locations = readStringArray(raw.locations);
  if (locations) filters.locations = locations;
  const education = readStringArray(raw.education);
  if (education) filters.education = education;
  if (isRecord(raw.salaryRange)) {
    const sr = raw.salaryRange;
    filters.salaryRange = {
      min: readNumber(sr.min),
      max: readNumber(sr.max),
      currency: readString(sr.currency),
      period: readString(sr.period),
    };
  }
  return Object.keys(filters).length > 0 ? filters : undefined;
}

function parseSchedule(raw: unknown): ProfileSchedule | undefined {
  if (!isRecord(raw)) return undefined;
  return {
    enabled: readBoolean(raw.enabled, true),
    cron: readString(raw.cron),
    timezone: readString(raw.timezone),
    maxCandidates: readNumber(raw.maxCandidates),
    notifyOnlyOnNew: typeof raw.notifyOnlyOnNew === "boolean" ? raw.notifyOnlyOnNew : undefined,
  };
}

function parseQuickStart(raw: unknown): ProfileQuickStart | undefined {
  if (!isRecord(raw)) return undefined;
  return {
    enabled: readBoolean(raw.enabled, false),
    rank: readNumber(raw.rank),
    label: readString(raw.label),
    description: readString(raw.description),
  };
}

function parseSession(raw: unknown): ProfileSession | undefined {
  if (!isRecord(raw)) return undefined;
  const session: ProfileSession = {};
  session.scope = readString(raw.scope);
  if (Array.isArray(raw.resetTriggers)) {
    session.resetTriggers = raw.resetTriggers.filter((v: unknown): v is string => typeof v === "string");
  }
  if (isRecord(raw.retention)) {
    session.retention = {
      mode: readString(raw.retention.mode),
      archiveAfterDays: readNumber(raw.retention.archiveAfterDays),
    };
  }
  return Object.keys(session).length > 0 ? session : undefined;
}

function parseTemplate(raw: unknown, fileName: string): Template | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id);
  const name = readString(raw.name);
  const status = readString(raw.status);
  const location = readString(raw.location);
  const keywords = readStringArray(raw.keywords);
  if (!id || !name || !status || !location || !keywords) {
    console.error(`Skipping ${fileName}: missing required fields (id, name, status, location, keywords)`);
    return null;
  }
  if (status !== "active" && status !== "paused" && status !== "archived") {
    console.error(`Skipping ${fileName}: invalid status "${status}"`);
    return null;
  }
  const sources = Array.isArray(raw.sources)
    ? raw.sources.map(parseSource).filter((s: ProfileSource | null): s is ProfileSource => s !== null)
    : undefined;
  return {
    workspaceSlugs: readWorkspaceSlugs(raw.workspaceSlug),
    seedLastRunOffsetMs: readNumber(raw.seedLastRunOffsetMs),
    profile: {
      id,
      name,
      description: readString(raw.description),
      createdAt: readString(raw.createdAt),
      updatedAt: readString(raw.updatedAt),
      status: status as "active" | "paused" | "archived",
      location,
      keywords,
      requiredKeywords: readStringArray(raw.requiredKeywords),
      jobDescription: readString(raw.jobDescription),
      filterPreset: readString(raw.filterPreset),
      filters: parseFilters(raw.filters),
      schedule: parseSchedule(raw.schedule),
      sources: sources && sources.length > 0 ? sources : undefined,
      quickStart: parseQuickStart(raw.quickStart),
      session: parseSession(raw.session),
    },
  };
}

type FlatTemplate = {
  workspaceSlug: string;
  seedLastRunOffsetMs?: number;
  profile: Profile;
};

// --- Rendering ---

const SOURCE_DIR_RELATIVE = "config/search-profiles";

function sortTemplates(templates: FlatTemplate[]): FlatTemplate[] {
  return [...templates].sort((a, b) => {
    const rankA = a.profile.quickStart?.enabled ? (a.profile.quickStart?.rank ?? 999) : 999;
    const rankB = b.profile.quickStart?.enabled ? (b.profile.quickStart?.rank ?? 999) : 999;
    if (rankA !== rankB) return rankA - rankB;
    return a.profile.id.localeCompare(b.profile.id);
  });
}

function renderGeneratedFile(templates: FlatTemplate[]): string {
  const sorted = sortTemplates(templates);

  // Remove undefined values for clean JSON output
  const cleaned = sorted.map((t) => stripUndefined(t));

  const templatesJson = JSON.stringify(cleaned, null, 2);

  return `/* eslint-disable */
// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.
// Source: ${SOURCE_DIR_RELATIVE}/*.yaml
// Run: make sync-search-profile-templates

export const DEFAULT_TEMPLATE_WORKSPACE_SLUG = "dev";

export type SharedSearchProfileTemplate = {
  workspaceSlug?: string;
  profile: {
    id: string;
    name: string;
    description?: string;
    createdAt?: string;
    updatedAt?: string;
    status: "active" | "paused" | "archived";
    location: string;
    keywords: string[];
    requiredKeywords?: string[];
    jobDescription?: string;
    filterPreset?: string;
    filters?: {
      minExperience?: number;
      maxExperience?: number | null;
      minAge?: number;
      maxAge?: number;
      education?: string[];
      salaryRange?: {
        min?: number;
        max?: number;
        currency?: string;
        period?: string;
      };
      locations?: string[];
    };
    schedule?: {
      enabled: boolean;
      cron?: string;
      timezone?: string;
      maxCandidates?: number;
      notifyOnlyOnNew?: boolean;
    };
    sources?: Array<{
      type: string;
      enabled: boolean;
      priority?: number;
      jobUrl?: string;
      collectLimit?: number;
      maxPages?: number;
    }>;
    quickStart?: {
      enabled: boolean;
      rank?: number;
      label?: string;
      description?: string;
    };
    session?: {
      scope?: string;
      resetTriggers?: string[];
      retention?: {
        mode?: string;
        archiveAfterDays?: number;
      };
    };
  };
  seedLastRunOffsetMs?: number;
};

export const SEARCH_PROFILE_TEMPLATES: SharedSearchProfileTemplate[] = ${templatesJson};

export function normalizeTemplateWorkspaceSlug(workspaceSlug?: string): string {
  const normalized = workspaceSlug?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_TEMPLATE_WORKSPACE_SLUG;
}

export function buildSearchProfileCriteria(profile: SharedSearchProfileTemplate["profile"]) {
  const filterLocations = Array.isArray(profile.filters?.locations)
    ? profile.filters.locations.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const locations = Array.from(new Set([profile.location, ...filterLocations].filter((item) => item && item.trim().length > 0)));

  return {
    keywords: [...profile.keywords],
    locations,
  };
}

export function getWorkspaceSearchProfileTemplates(workspaceSlug?: string): SharedSearchProfileTemplate[] {
  const normalizedWorkspaceSlug = normalizeTemplateWorkspaceSlug(workspaceSlug);
  return SEARCH_PROFILE_TEMPLATES.filter((template) => (
    normalizeTemplateWorkspaceSlug(template.workspaceSlug) === normalizedWorkspaceSlug
  ));
}

export function findWorkspaceSearchProfileTemplate(
  id: string,
  workspaceSlug?: string,
): SharedSearchProfileTemplate | null {
  const normalizedId = id.trim().toLowerCase();
  return getWorkspaceSearchProfileTemplates(workspaceSlug).find((template) => (
    template.profile.id.trim().toLowerCase() === normalizedId
  )) ?? null;
}

export function computeTemplateHash(profile: SharedSearchProfileTemplate["profile"]): string {
  const canonical = JSON.stringify(profile, (_key, value) => {
    if (value === undefined || value === null) return undefined;
    if (Array.isArray(value)) return [...value].sort();
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return Object.keys(value).sort().reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = value[k as keyof typeof value];
        return acc;
      }, {});
    }
    return value;
  });
  let hash = 0;
  for (let i = 0; i < canonical.length; i++) {
    const chr = canonical.charCodeAt(i);
    hash = ((hash << 5) - hash + chr) | 0;
  }
  return "sp-" + Math.abs(hash).toString(36);
}
`;
}

/** Recursively remove undefined values so JSON.stringify output matches TS optional semantics. */
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (val !== undefined) {
        result[key] = stripUndefined(val);
      }
    }
    return result;
  }
  return value;
}

// --- Main ---

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const sourceDir = path.join(repoRoot, SOURCE_DIR_RELATIVE);
const outputPath = path.join(
  repoRoot,
  "packages",
  "shared",
  "src",
  "generated",
  "search-profile-templates.ts",
);

async function run(): Promise<void> {
  const checkMode = process.argv.includes("--check");

  const files = (await readdir(sourceDir))
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();

  if (files.length === 0) {
    console.error(`No YAML files found in ${sourceDir}`);
    process.exit(1);
  }

  const templates: Template[] = [];
  for (const file of files) {
    const raw = await readFile(path.join(sourceDir, file), "utf8");
    const parsed = parseYaml(raw);
    const template = parseTemplate(parsed, file);
    if (template) templates.push(template);
  }

  // Fan out array workspaceSlugs into flat per-slug entries
  const flatTemplates: FlatTemplate[] = [];
  for (const template of templates) {
    for (const slug of template.workspaceSlugs) {
      flatTemplates.push({
        workspaceSlug: slug,
        seedLastRunOffsetMs: template.seedLastRunOffsetMs,
        profile: template.profile,
      });
    }
  }

  if (templates.length === 0) {
    console.error("No valid search profile templates found");
    process.exit(1);
  }

  const expected = renderGeneratedFile(flatTemplates);

  if (checkMode) {
    const current = await readFile(outputPath, "utf8");
    if (current !== expected) {
      console.error("Search profile template artifact drift detected.");
      console.error("Run: make sync-search-profile-templates");
      process.exit(1);
    }
    console.log("Search profile template artifact is up to date");
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, expected, "utf8");
  console.log(`Generated ${outputPath}`);
}

run().catch((error: unknown) => {
  console.error("Failed to sync search profile templates:", error);
  process.exit(1);
});
