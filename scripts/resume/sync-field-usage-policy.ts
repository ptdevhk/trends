#!/usr/bin/env -S npx tsx

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import JSON5 from "json5";

const RESUME_FIELD_USAGE_SURFACES = ["analysis", "presentation", "outreach", "debug"] as const;

type ResumeFieldUsageSurface = (typeof RESUME_FIELD_USAGE_SURFACES)[number];
type ResumeFieldUsageFieldPolicy = {
  surfaces?: Partial<Record<ResumeFieldUsageSurface, boolean>>;
};

type ResumeFieldUsagePolicy = {
  version: number;
  updatedAt?: string;
  description?: string;
  sourceFileRelativePath: string;
  fields: Record<string, ResumeFieldUsageFieldPolicy>;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const sourceRelativePath = "config/resume/field-usage-policy.json5";
const sourcePath = path.join(repoRoot, sourceRelativePath);
const outputPath = path.join(
  repoRoot,
  "packages",
  "shared",
  "src",
  "generated",
  "resume-field-usage-policy.ts",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseFieldPolicy(value: unknown): ResumeFieldUsageFieldPolicy | null {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = isRecord(value.surfaces) ? value.surfaces : value;
  const surfaces: Partial<Record<ResumeFieldUsageSurface, boolean>> = {};

  for (const surface of RESUME_FIELD_USAGE_SURFACES) {
    const allowed = candidate[surface];
    if (typeof allowed === "boolean") {
      surfaces[surface] = allowed;
    }
  }

  return Object.keys(surfaces).length > 0 ? { surfaces } : null;
}

function parsePolicy(raw: unknown): ResumeFieldUsagePolicy {
  const root = isRecord(raw) ? raw : {};
  const fieldsRoot = isRecord(root.fields) ? root.fields : {};
  const fields = Object.fromEntries(
    Object.entries(fieldsRoot)
      .map(([fieldKey, value]) => [fieldKey.trim(), parseFieldPolicy(value)] as const)
      .filter(
        (entry): entry is [string, ResumeFieldUsageFieldPolicy] =>
          entry[0].length > 0 && entry[1] !== null,
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );

  return {
    version: readNumber(root.version) ?? 1,
    updatedAt: readString(root.updatedAt),
    description: readString(root.description),
    sourceFileRelativePath: sourceRelativePath,
    fields,
  };
}

function renderGeneratedFile(policy: ResumeFieldUsagePolicy): string {
  return `/* eslint-disable */
// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.
// Source: ${sourceRelativePath}
// Run: make sync-resume-field-usage-policy

export const RESUME_FIELD_USAGE_SURFACES = ${JSON.stringify(RESUME_FIELD_USAGE_SURFACES)} as const;

export type ResumeFieldUsageSurface = (typeof RESUME_FIELD_USAGE_SURFACES)[number];

export interface ResumeFieldUsageFieldPolicy {
  surfaces?: Partial<Record<ResumeFieldUsageSurface, boolean>>;
}

export interface ResumeFieldUsagePolicy {
  version: number;
  updatedAt?: string;
  description?: string;
  sourceFileRelativePath: string;
  fields: Record<string, ResumeFieldUsageFieldPolicy>;
}

export const DEFAULT_RESUME_FIELD_USAGE_POLICY = ${JSON.stringify(policy, null, 2)} as const satisfies ResumeFieldUsagePolicy;
`;
}

async function run(): Promise<void> {
  const checkMode = process.argv.includes("--check");
  const rawSource = await readFile(sourcePath, "utf8");
  const parsed = parsePolicy(JSON5.parse(rawSource) as unknown);
  const expected = renderGeneratedFile(parsed);

  if (checkMode) {
    const current = await readFile(outputPath, "utf8");
    if (current !== expected) {
      console.error("Resume field usage policy artifact drift detected.");
      console.error("Run: make sync-resume-field-usage-policy");
      process.exit(1);
    }
    console.log("Resume field usage policy artifact is up to date");
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, expected, "utf8");
  console.log(`Generated ${outputPath}`);
}

run().catch((error: unknown) => {
  console.error("Failed to sync resume field usage policy:", error);
  process.exit(1);
});
