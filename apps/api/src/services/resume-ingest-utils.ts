import type {
  BrandContext,
  BrandHit,
  BrandRole,
  RoleSignalSummary,
} from "./rule-scoring.js";
import type { ResumeItem } from "../types/resume.js";
import { isRecord } from "@trends/shared";

// ── Shared helpers for resume ingest data parsing ────────────────────────
// These functions handle type-safe extraction of ingest-data fields from
// unknown/untyped records (Convex query results, backup data, etc.).
// They are duplicated across resumes.ts, resumes_import.ts, and
// resumes_search.ts — this file is the canonical source.


export function toStringValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

export function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => toStringValue(item))
    .filter(Boolean);
}

function toBrandRole(value: unknown): BrandRole | null {
  if (value === "employer" || value === "equipment" || value === "both") {
    return value;
  }
  return null;
}

function toBrandContext(value: unknown): BrandContext | null {
  if (
    value === "employer"
    || value === "equipment"
    || value === "sales"
    || value === "technical"
    || value === "general"
  ) {
    return value;
  }
  return null;
}

export function parseBrandHits(value: unknown): BrandHit[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const brand = toStringValue(item.brand);
    const role = toBrandRole(item.role);
    const source = item.source === "workHistory"
      || item.source === "selfIntro"
      || item.source === "jobIntention"
      ? item.source
      : null;
    const context = toBrandContext(item.context);

    if (!brand || !role || !source || !context) {
      return [];
    }

    const origin =
      item.origin === "international" || item.origin === "domestic" || item.origin === "unknown"
        ? item.origin
        : undefined;
    const productClass =
      item.productClass === "complete_machine"
      || item.productClass === "tool_accessory"
      || item.productClass === "industrial_component"
      || item.productClass === "other"
        ? item.productClass
        : undefined;

    return [{
      brand,
      role,
      source,
      context,
      ...(origin ? { origin } : {}),
      ...(productClass ? { productClass } : {}),
    }];
  });
}

export function parseRoleSignals(value: unknown): RoleSignalSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const type = toStringValue(item.type);
    const years = toOptionalNumber(item.years);
    if (!type || years === undefined) {
      return [];
    }

    const matchedSignals = toStringArray(item.matchedSignals);
    const verifyIn = item.verifyIn === "searchText" ? "searchText" as const : "workHistory" as const;
    const signalCount = toOptionalNumber(item.signalCount) ?? matchedSignals.length;
    const occurrences = toOptionalNumber(item.occurrences) ?? matchedSignals.length;
    const industryVerifiedYears = toOptionalNumber(item.industryVerifiedYears) ?? 0;
    const roleRelevantYears = toOptionalNumber(item.roleRelevantYears);
    const industryVerifiedRelevantYears = toOptionalNumber(item.industryVerifiedRelevantYears);
    const matchedWorkEntries = Array.isArray(item.matchedWorkEntries)
      ? item.matchedWorkEntries.flatMap((entry) => {
          if (!isRecord(entry)) {
            return [];
          }
          const entryYears = toOptionalNumber(entry.years);
          if (entryYears === undefined) {
            return [];
          }
          return [{
            companyName: toStringValue(entry.companyName) || undefined,
            jobTitle: toStringValue(entry.jobTitle) || undefined,
            years: entryYears,
            industryVerified: entry.industryVerified === true,
            matchedSignals: toStringArray(entry.matchedSignals),
            ...(typeof entry.directRoleMatch === "boolean"
              ? { directRoleMatch: entry.directRoleMatch }
              : {}),
          }];
        })
      : undefined;

    return [{
      type,
      matchedSignals,
      signalCount,
      occurrences,
      years,
      industryVerifiedYears,
      ...(roleRelevantYears === undefined ? {} : { roleRelevantYears }),
      ...(industryVerifiedRelevantYears === undefined ? {} : { industryVerifiedRelevantYears }),
      ...(matchedWorkEntries && matchedWorkEntries.length > 0 ? { matchedWorkEntries } : {}),
      verifyIn,
    }];
  });
}

export function buildResumeIngestData(value: unknown): ResumeItem["ingestData"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const industryTags = toStringArray(value.industryTags);
  const synonymHits = toStringArray(value.synonymHits);
  const evidenceText = toStringValue(value.evidenceText) || undefined;
  const companyHits = toStringArray(value.companyHits);
  const brandHits = parseBrandHits(value.brandHits);
  const roleSignals = parseRoleSignals(value.roleSignals);
  const industryDbV2Raw = toOptionalNumber(value.industryDbV2Raw);
  const experienceLevel = toStringValue(value.experienceLevel) || undefined;
  const normalizedExperienceLevel = experienceLevel?.trim().toLowerCase();
  const meaningfulExperienceLevel = normalizedExperienceLevel && normalizedExperienceLevel !== "unknown" ? experienceLevel : undefined;
  const market = toStringValue(value.market) || undefined;
  const ruleScores = isRecord(value.ruleScores)
    ? Object.fromEntries(
        Object.entries(value.ruleScores)
          .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])),
      )
    : undefined;
  const computedAt = toOptionalNumber(value.computedAt);
  const skillsVersion = toOptionalNumber(value.skillsVersion);

  if (
    industryTags.length === 0
    && synonymHits.length === 0
    && !evidenceText
    && companyHits.length === 0
    && brandHits.length === 0
    && roleSignals.length === 0
    && industryDbV2Raw === undefined
    && !meaningfulExperienceLevel
    && !market
    && (!ruleScores || Object.keys(ruleScores).length === 0)
  ) {
    return undefined;
  }

  const verifiedRoleYears = isRecord(value.verifiedRoleYears)
    ? Object.fromEntries(
        Object.entries(value.verifiedRoleYears)
          .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])),
      )
    : undefined;

  return {
    ...(industryTags.length > 0 ? { industryTags } : {}),
    ...(synonymHits.length > 0 ? { synonymHits } : {}),
    ...(evidenceText ? { evidenceText } : {}),
    ...(companyHits.length > 0 ? { companyHits } : {}),
    ...(brandHits.length > 0 ? { brandHits } : {}),
    ...(roleSignals.length > 0 ? { roleSignals } : {}),
    ...(industryDbV2Raw === undefined ? {} : { industryDbV2Raw }),
    ...(meaningfulExperienceLevel ? { experienceLevel: meaningfulExperienceLevel } : {}),
    ...(verifiedRoleYears && Object.keys(verifiedRoleYears).length > 0 ? { verifiedRoleYears } : {}),
    ...(ruleScores && Object.keys(ruleScores).length > 0 ? { ruleScores } : {}),
    ...(market ? { market } : {}),
    ...(computedAt !== undefined ? { computedAt } : {}),
    ...(skillsVersion !== undefined ? { skillsVersion } : {}),
  };
}
