import {
  parseIndustryVerdictRevision,
  type IndustryVerdictRevision,
} from "./company-industry-contracts.js";
import { config } from "./config.js";
import { callConvexQuery } from "./convex-utils.js";
import { getIndustryProfile } from "./company-industry-profile-service.js";
import { listIndustryEvidenceSources } from "./company-industry-evidence-service.js";

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
