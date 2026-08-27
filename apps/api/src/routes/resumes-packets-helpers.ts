import type { ResumeItem } from "../types/resume.js";
import { parseMachineOrigin } from "@trends/shared";
import { toStringValue, toOptionalNumber, toStringArray } from "../services/resume-ingest-utils.js";

// --- Pure helper functions for data parsing ---

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Re-exported from canonical source for backward compatibility
export { toStringValue, toOptionalNumber, toStringArray };

export function toBrandRole(value: unknown): "employer" | "equipment" | "both" | null {
  if (value === "employer" || value === "equipment" || value === "both") {
    return value;
  }
  return null;
}

export function toBrandContext(value: unknown): "employer" | "equipment" | "sales" | "technical" | "general" | null {
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

export function parseBrandHits(value: unknown): Array<{
  brand: string;
  role: "employer" | "equipment" | "both";
  source: "workHistory" | "selfIntro" | "jobIntention";
  context: "employer" | "equipment" | "sales" | "technical" | "general";
}> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const brand = toStringValue(item.brand);
    const role = toBrandRole(item.role);
    const source = item.source === "workHistory" || item.source === "selfIntro" || item.source === "jobIntention"
      ? item.source
      : null;
    const context = toBrandContext(item.context);

    if (!brand || !role || !source || !context) {
      return [];
    }

    return [{
      brand,
      role,
      source,
      context,
    }];
  });
}

export function parseRoleSignals(value: unknown): Array<{
  type: string;
  matchedSignals: string[];
  signalCount: number;
  occurrences: number;
  years: number;
  industryVerifiedYears: number;
  roleRelevantYears?: number;
  industryVerifiedRelevantYears?: number;
  matchedWorkEntries?: Array<{
    companyName?: string;
    jobTitle?: string;
    years: number;
    industryVerified: boolean;
    matchedSignals: string[];
  }>;
  verifyIn: string;
}> {
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
    const verifyIn = item.verifyIn === "searchText" ? "searchText" : "workHistory";
    const signalCount = toOptionalNumber(item.signalCount) ?? matchedSignals.length;
    const occurrences = toOptionalNumber(item.occurrences) ?? matchedSignals.length;
    const industryVerifiedYears = toOptionalNumber(item.industryVerifiedYears) ?? 0;
    const roleRelevantYears = toOptionalNumber(item.roleRelevantYears);
    const industryVerifiedRelevantYears = toOptionalNumber(item.industryVerifiedRelevantYears);
    const matchedWorkEntries = Array.isArray(item.matchedWorkEntries)
      ? item.matchedWorkEntries.flatMap((entry: unknown) => {
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
  const meaningfulExperienceLevel = normalizedExperienceLevel && normalizedExperienceLevel !== 'unknown' ? experienceLevel : undefined;
  const machineOrigin = parseMachineOrigin(value.machineOrigin);
  const market = toStringValue(value.market) || undefined;
  const ruleScores = isRecord(value.ruleScores)
    ? Object.fromEntries(
        Object.entries(value.ruleScores)
          .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])),
      )
    : undefined;
  const computedAt = toOptionalNumber(value.computedAt);
  const skillsVersion = toOptionalNumber(value.skillsVersion);
  const ingestComputeEpoch = toOptionalNumber(value.ingestComputeEpoch);

  if (
    industryTags.length === 0
    && synonymHits.length === 0
    && !evidenceText
    && companyHits.length === 0
    && brandHits.length === 0
    && roleSignals.length === 0
    && industryDbV2Raw === undefined
    && machineOrigin === undefined
    && !meaningfulExperienceLevel
    && !market
    && (!ruleScores || Object.keys(ruleScores).length === 0)
  ) {
    return undefined;
  }

  const verifiedRoleYears = isRecord(value.verifiedRoleYears)
    ? Object.fromEntries(
        Object.entries(value.verifiedRoleYears)
          .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])),
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
    ...(machineOrigin ? { machineOrigin } : {}),
    ...(market ? { market } : {}),
    ...(computedAt !== undefined ? { computedAt } : {}),
    ...(skillsVersion !== undefined ? { skillsVersion } : {}),
    ...(ingestComputeEpoch !== undefined ? { ingestComputeEpoch } : {}),
  };
}
