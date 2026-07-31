import {
  normalizeIndustryEvidenceUrl,
  type IndustryClass,
  type IndustryEvidenceSourceType,
  type IndustryEvidenceTrustTier,
} from "@trends/shared";

import {
  parseIndustryEvidenceSource,
  type IndustryEvidenceSource,
} from "./company-industry-contracts.js";
import { config } from "./config.js";
import { callConvexMutation, callConvexQuery } from "./convex-utils.js";
import { invalidateIndustryReviewIndex } from "./company-industry-review-index.js";

export async function listIndustryEvidenceSources(filter: {
  companyKey?: string;
  proposalId?: string;
} = {}): Promise<IndustryEvidenceSource[]> {
  const value = await callConvexQuery("companies:listIndustryEvidenceSources", {
    writeSecret: config.auth.convexWriteSecret,
    ...(filter.companyKey ? { companyKey: filter.companyKey } : {}),
    ...(filter.proposalId ? { proposalId: filter.proposalId } : {}),
  });
  if (!Array.isArray(value)) {
    throw new Error("Invalid companies:listIndustryEvidenceSources response");
  }
  return value.map((item) => {
    const parsed = parseIndustryEvidenceSource(item);
    if (!parsed) {
      throw new Error("Invalid industry evidence source response");
    }
    return parsed;
  });
}

export async function upsertIndustryEvidenceSource(input: {
  sourceId: string;
  companyKey?: string;
  proposalId?: string;
  url: string;
  sourceType: IndustryEvidenceSourceType;
  trustTier: IndustryEvidenceTrustTier;
  title?: string;
  evidenceExcerpt?: string;
  fetchedAt?: number;
  contentFingerprint?: string;
  fetchStatus: "pending" | "fetched" | "failed" | "unavailable";
  suggestedIndustryClass?: IndustryClass;
  workerConfidence?: number;
}): Promise<{ sourceId: string; created: boolean }> {
  const normalizedUrl = normalizeIndustryEvidenceUrl(input.url);
  if (!normalizedUrl) {
    throw new Error("Evidence requires a safe public HTTP(S) URL");
  }
  if (input.sourceType === "search_result" && input.trustTier !== "discovery") {
    throw new Error("search_result evidence must use discovery trust");
  }
  const value = await callConvexMutation("companies:upsertIndustryEvidenceSource", {
    ...input,
    url: normalizedUrl.url,
    writeSecret: config.auth.convexWriteSecret,
  });
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as { sourceId?: unknown }).sourceId !== "string"
  ) {
    throw new Error("Invalid companies:upsertIndustryEvidenceSource response");
  }
  invalidateIndustryReviewIndex();
  return {
    sourceId: (value as { sourceId: string }).sourceId,
    created: (value as { created?: unknown }).created === true,
  };
}
