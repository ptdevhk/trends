import {
  parseIndustryVerdictRevision,
  type IndustryVerdictRevision,
} from "./company-industry-contracts.js";
import { config } from "./config.js";
import { callConvexQuery } from "./convex-utils.js";
import { getIndustryProfile } from "./company-industry-profile-service.js";
import { listIndustryEvidenceSources } from "./company-industry-evidence-service.js";
import type { CompanyIndustryProfile } from "./company-industry-profile-service.js";

export interface IndustryReviewContext {
  profile: CompanyIndustryProfile | null;
  revisions: IndustryVerdictRevision[];
}

export async function listIndustryVerdictRevisions(
  companyKey: string,
): Promise<IndustryVerdictRevision[]> {
  const value = await callConvexQuery("companies:listIndustryVerdictRevisions", {
    companyKey,
    writeSecret: config.auth.convexWriteSecret,
  });
  if (!Array.isArray(value)) {
    throw new Error("Invalid companies:listIndustryVerdictRevisions response");
  }
  return value.map((item) => {
    const parsed = parseIndustryVerdictRevision(item);
    if (!parsed) throw new Error("Invalid industry verdict revision response");
    return parsed;
  });
}

export async function getCompanyIndustryEvidenceBundle(companyKey: string) {
  const [profile, revisions, sources] = await Promise.all([
    getIndustryProfile(companyKey),
    listIndustryVerdictRevisions(companyKey),
    listIndustryEvidenceSources({ companyKey }),
  ]);
  return { profile, revisions, sources };
}

/**
 * The reviewer needs current truth and immutable history, but not a second
 * copy of every source payload.  Evidence remains a separate packet field so
 * the source-free context can be cached and invalidated independently.
 */
export async function getCompanyIndustryReviewContext(
  companyKey: string,
): Promise<IndustryReviewContext> {
  const [profile, revisions] = await Promise.all([
    getIndustryProfile(companyKey),
    listIndustryVerdictRevisions(companyKey),
  ]);
  return { profile, revisions };
}
