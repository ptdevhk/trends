/**
 * Service layer for reviewed company-industry profiles.
 *
 * Talks to Convex via the same callConvexMutation/callConvexQuery pattern
 * as company-policy-service. Reuses companyKey as the canonical identity;
 * does not create a second employer registry.
 */

import {
  INDUSTRY_EVIDENCE_FRESHNESS_STATES,
  isRecord,
  normalizeCompanyAlias,
  type IndustryClass,
  type IndustryEvidenceFreshnessState,
  type IndustryVerificationLevel,
  type MachineOrigin,
} from "@trends/shared";

import { callConvexMutation, callConvexQuery } from "./convex-utils.js";
import { config } from "./config.js";
import { invalidateIndustryReviewIndex } from "./company-industry-review-index.js";
import {
  parseReviewedIndustryProfileSnapshot,
} from "./company-industry-contracts.js";
import type { ReviewedIndustryProfileSnapshot } from "./industry-verification-service.js";

const industryEvidenceFreshnessStates = new Set<string>(
  INDUSTRY_EVIDENCE_FRESHNESS_STATES,
);

export type VerificationLevel = IndustryVerificationLevel;

export type EvidenceSource = "seed" | "manual" | "worker_web";

export interface CompanyIndustryProfile {
  _id: string;
  companyKey: string;
  industryClass: IndustryClass;
  machineOrigin?: MachineOrigin;
  verificationLevel: VerificationLevel;
  officialDomain?: string;
  evidenceSource: EvidenceSource;
  summary?: string;
  sourceUrl?: string;
  sourceDomain?: string;
  sourceType?: string;
  msicCode?: string;
  msicDescription?: string;
  fetchedAt?: number;
  currentRevisionId?: string;
  reviewedAt?: number;
  reviewedBy?: string;
  sourceCount?: number;
  freshnessState?: IndustryEvidenceFreshnessState;
  nextReviewAt?: number;
  catalogVersion?: number;
  compatibilityState?: "legacy_seed" | "reviewed" | "strict_reviewed";
  updatedAt: number;
  updatedBy?: string;
}

function parseProfile(value: unknown): CompanyIndustryProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  const companyKey = typeof value.companyKey === "string" ? value.companyKey : "";
  if (!companyKey) {
    return null;
  }

  const industryClass = value.industryClass as IndustryClass;
  const machineOrigin = typeof value.machineOrigin === "string" ? (value.machineOrigin as MachineOrigin) : undefined;
  const verificationLevel = value.verificationLevel as VerificationLevel;
  const evidenceSource = (value.evidenceSource as EvidenceSource) ?? "manual";

  return {
    _id: typeof value._id === "string" ? value._id : String(value._id ?? ""),
    companyKey,
    industryClass,
    ...(machineOrigin ? { machineOrigin } : {}),
    verificationLevel,
    ...(typeof value.officialDomain === "string" ? { officialDomain: value.officialDomain } : {}),
    evidenceSource,
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(typeof value.sourceUrl === "string" ? { sourceUrl: value.sourceUrl } : {}),
    ...(typeof value.sourceDomain === "string" ? { sourceDomain: value.sourceDomain } : {}),
    ...(typeof value.sourceType === "string" ? { sourceType: value.sourceType } : {}),
    ...(typeof value.msicCode === "string" ? { msicCode: value.msicCode } : {}),
    ...(typeof value.msicDescription === "string" ? { msicDescription: value.msicDescription } : {}),
    ...(typeof value.fetchedAt === "number" ? { fetchedAt: value.fetchedAt } : {}),
    ...(typeof value.currentRevisionId === "string"
      ? { currentRevisionId: value.currentRevisionId }
      : {}),
    ...(typeof value.reviewedAt === "number" ? { reviewedAt: value.reviewedAt } : {}),
    ...(typeof value.reviewedBy === "string" ? { reviewedBy: value.reviewedBy } : {}),
    ...(typeof value.sourceCount === "number" ? { sourceCount: value.sourceCount } : {}),
    ...(typeof value.freshnessState === "string" &&
    industryEvidenceFreshnessStates.has(value.freshnessState)
      ? {
          freshnessState:
            value.freshnessState as IndustryEvidenceFreshnessState,
        }
      : {}),
    ...(typeof value.nextReviewAt === "number"
      ? { nextReviewAt: value.nextReviewAt }
      : {}),
    ...(typeof value.catalogVersion === "number"
      ? { catalogVersion: value.catalogVersion }
      : {}),
    ...(value.compatibilityState === "legacy_seed" ||
    value.compatibilityState === "reviewed" ||
    value.compatibilityState === "strict_reviewed"
      ? { compatibilityState: value.compatibilityState }
      : {}),
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    ...(typeof value.updatedBy === "string" ? { updatedBy: value.updatedBy } : {}),
  };
}

export interface ReviewedIndustryCatalogDiagnostic {
  companyKey: string;
  code: "invalid_current_revision";
  currentRevisionId?: string;
}

export interface ReviewedIndustryCatalogResult {
  profiles: Map<string, ReviewedIndustryProfileSnapshot>;
  missingCompanyKeys: string[];
  diagnostics: ReviewedIndustryCatalogDiagnostic[];
  degraded: boolean;
  error?: string;
}

export interface EmployerSurfaceResolutionResult {
  companyKeysByNormalizedSurface: Map<string, string>;
  missingNormalizedSurfaces: string[];
  degraded: boolean;
  error?: string;
}

function normalizeCompanyKeys(companyKeys: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const companyKey of companyKeys) {
    const key = companyKey.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

function normalizeEmployerSurface(value: string): string {
  return normalizeCompanyAlias(value);
}

export async function resolveCompanyKeysForEmployerSurfaces(
  employerSurfaces: string[],
): Promise<EmployerSurfaceResolutionResult> {
  const seen = new Set<string>();
  const surfaces: string[] = [];
  for (const surface of employerSurfaces) {
    const normalized = normalizeEmployerSurface(surface);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    surfaces.push(surface.trim());
  }
  if (surfaces.length === 0) {
    return {
      companyKeysByNormalizedSurface: new Map(),
      missingNormalizedSurfaces: [],
      degraded: false,
    };
  }
  if (surfaces.length > 200) {
    throw new Error("Company alias lookup is limited to 200 surfaces");
  }

  try {
    const value = await callConvexQuery("companies:resolveAliasesBatch", {
      aliases: surfaces,
      writeSecret: config.auth.convexWriteSecret,
    });
    if (!Array.isArray(value)) {
      throw new Error("Invalid companies:resolveAliasesBatch response");
    }
    const companyKeysByNormalizedSurface = new Map<string, string>();
    const missingNormalizedSurfaces: string[] = [];
    for (const row of value) {
      if (
        !isRecord(row) ||
        typeof row.normalizedEmployerSurface !== "string" ||
        (row.status !== "resolved" && row.status !== "missing")
      ) {
        throw new Error("Invalid company alias resolution row");
      }
      const normalizedSurface = normalizeEmployerSurface(
        row.normalizedEmployerSurface,
      );
      if (row.status === "missing") {
        missingNormalizedSurfaces.push(normalizedSurface);
      } else if (typeof row.companyKey === "string" && row.companyKey.trim()) {
        companyKeysByNormalizedSurface.set(
          normalizedSurface,
          row.companyKey.trim().toLowerCase(),
        );
      } else {
        throw new Error("Resolved company alias is missing companyKey");
      }
    }
    return {
      companyKeysByNormalizedSurface,
      missingNormalizedSurfaces,
      degraded: false,
    };
  } catch (error) {
    return {
      companyKeysByNormalizedSurface: new Map(),
      missingNormalizedSurfaces: surfaces.map(normalizeEmployerSurface),
      degraded: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getReviewedIndustryProfilesByKeys(
  companyKeys: string[],
): Promise<ReviewedIndustryCatalogResult> {
  const normalizedKeys = normalizeCompanyKeys(companyKeys);
  if (normalizedKeys.length === 0) {
    return {
      profiles: new Map(),
      missingCompanyKeys: [],
      diagnostics: [],
      degraded: false,
    };
  }
  if (normalizedKeys.length > 200) {
    throw new Error("Reviewed industry catalog lookup is limited to 200 companies");
  }

  const value = await callConvexQuery(
    "companies:getReviewedIndustryCatalogByKeys",
    {
      companyKeys: normalizedKeys,
      writeSecret: config.auth.convexWriteSecret,
    },
  );
  if (!Array.isArray(value)) {
    throw new Error("Invalid companies:getReviewedIndustryCatalogByKeys response");
  }

  const profiles = new Map<string, ReviewedIndustryProfileSnapshot>();
  const missingCompanyKeys: string[] = [];
  const diagnostics: ReviewedIndustryCatalogDiagnostic[] = [];
  for (const row of value) {
    if (!isRecord(row) || typeof row.companyKey !== "string") {
      throw new Error("Invalid reviewed industry catalog row");
    }
    const companyKey = row.companyKey.trim().toLowerCase();
    if (row.status === "missing") {
      missingCompanyKeys.push(companyKey);
      continue;
    }
    if (row.status === "invalid_current_revision") {
      diagnostics.push({
        companyKey,
        code: "invalid_current_revision",
        ...(typeof row.currentRevisionId === "string"
          ? { currentRevisionId: row.currentRevisionId }
          : {}),
      });
      continue;
    }
    if (row.status !== "reviewed") {
      throw new Error(`Invalid reviewed industry catalog status for ${companyKey}`);
    }
    const parsed = parseReviewedIndustryProfileSnapshot(row.profile);
    if (!parsed || parsed.companyKey !== companyKey) {
      throw new Error(`Invalid reviewed industry profile for ${companyKey}`);
    }
    profiles.set(companyKey, parsed);
  }

  return {
    profiles,
    missingCompanyKeys,
    diagnostics,
    degraded: false,
  };
}

export async function loadReviewedIndustryCatalog(
  companyKeys: string[],
): Promise<ReviewedIndustryCatalogResult> {
  try {
    return await getReviewedIndustryProfilesByKeys(companyKeys);
  } catch (error) {
    return {
      profiles: new Map(),
      missingCompanyKeys: normalizeCompanyKeys(companyKeys),
      diagnostics: [],
      degraded: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listIndustryProfiles(
  verificationLevel?: VerificationLevel,
): Promise<CompanyIndustryProfile[]> {
  const value = await callConvexQuery("companies:listIndustryProfiles", {
    writeSecret: config.auth.convexWriteSecret,
    ...(verificationLevel ? { verificationLevel } : {}),
  });
  if (!Array.isArray(value)) {
    throw new Error("Invalid companies:listIndustryProfiles response");
  }
  return value
    .map(parseProfile)
    .filter((item): item is CompanyIndustryProfile => item != null);
}

export async function getIndustryProfile(
  companyKey: string,
): Promise<CompanyIndustryProfile | null> {
  const value = await callConvexQuery("companies:getIndustryProfile", {
    writeSecret: config.auth.convexWriteSecret,
    companyKey,
  });
  const parsed = parseProfile(value);
  return parsed;
}

export async function upsertIndustryProfile(input: {
  companyKey: string;
  industryClass: IndustryClass;
  verificationLevel: VerificationLevel;
  officialDomain?: string;
  evidenceSource?: EvidenceSource;
  summary?: string;
  sourceUrl?: string;
  sourceDomain?: string;
  sourceType?: string;
  msicCode?: string;
  msicDescription?: string;
  fetchedAt?: number;
  updatedBy?: string;
}): Promise<{ companyKey: string; created: boolean }> {
  const value = await callConvexMutation("companies:upsertIndustryProfile", {
    ...input,
    writeSecret: config.auth.convexWriteSecret,
  });
  if (!isRecord(value) || typeof value.companyKey !== "string") {
    throw new Error("Invalid companies:upsertIndustryProfile response");
  }
  invalidateIndustryReviewIndex();
  return {
    companyKey: value.companyKey,
    created: value.created === true,
  };
}

export async function deleteIndustryProfile(
  companyKey: string,
): Promise<{ deleted: number }> {
  const value = await callConvexMutation("companies:deleteIndustryProfile", {
    writeSecret: config.auth.convexWriteSecret,
    companyKey,
  });
  if (!isRecord(value) || typeof value.deleted !== "number") {
    throw new Error("Invalid companies:deleteIndustryProfile response");
  }
  invalidateIndustryReviewIndex();
  return { deleted: value.deleted };
}
