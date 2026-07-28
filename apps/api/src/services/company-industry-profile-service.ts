/**
 * Service layer for reviewed company-industry profiles.
 *
 * Talks to Convex via the same callConvexMutation/callConvexQuery pattern
 * as company-policy-service. Reuses companyKey as the canonical identity;
 * does not create a second employer registry.
 */

import { isRecord } from "@trends/shared";

import { callConvexMutation, callConvexQuery } from "./convex-utils.js";
import { config } from "./config.js";

export type IndustryClass =
  | "cnc"
  | "automation"
  | "metrology"
  | "industrial"
  | "non_industry"
  | "unknown";

export type VerificationLevel = "verified" | "candidate" | "rejected";

export type EvidenceSource = "seed" | "manual" | "worker_web";

export interface CompanyIndustryProfile {
  _id: string;
  companyKey: string;
  industryClass: IndustryClass;
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
  const verificationLevel = value.verificationLevel as VerificationLevel;
  const evidenceSource = (value.evidenceSource as EvidenceSource) ?? "manual";

  return {
    _id: typeof value._id === "string" ? value._id : String(value._id ?? ""),
    companyKey,
    industryClass,
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
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    ...(typeof value.updatedBy === "string" ? { updatedBy: value.updatedBy } : {}),
  };
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
  return { deleted: value.deleted };
}
