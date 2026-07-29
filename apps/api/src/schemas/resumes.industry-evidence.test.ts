import { describe, expect, it } from "vitest";

import { ResumeItemSchema } from "./resumes";

function createResumeWithEvidence(verificationLevel: string) {
  return {
    name: "Evidence Candidate",
    profileUrl: "https://example.com/candidate/1",
    activityStatus: "active",
    age: "35",
    experience: "10 years",
    education: "Bachelor",
    location: "Malaysia",
    selfIntro: "",
    jobIntention: "CNC Sales",
    expectedSalary: "",
    workHistory: [],
    extractedAt: "2026-07-29T00:00:00.000Z",
    ingestData: {
      evidenceProjectionVersion: 1,
      verifiedIndustryEvidenceSummaries: [
        {
          companyKey: "cnc-mechatronics",
          companyName: "CNC Mechatronics Sdn. Bhd.",
          industryClass: "cnc",
          verificationLevel,
          verdictRevisionId: "rev-1",
          evidenceSummary: "Reviewed official evidence.",
          reviewedAt: 1_754_000_000_000,
          sourceCount: 1,
          additionalSourceCount: 0,
          sourcePreviews: [
            {
              sourceId: "src-1",
              url: "https://cnc.example.com/products",
              sourceDomain: "cnc.example.com",
              sourceType: "official_site",
              trustTier: "primary",
              title: "Products",
            },
          ],
        },
      ],
    },
  };
}

describe("ResumeItemSchema industry evidence", () => {
  it("preserves a verified revision-aware evidence projection", () => {
    const parsed = ResumeItemSchema.parse(createResumeWithEvidence("verified"));
    expect(parsed.ingestData?.evidenceProjectionVersion).toBe(1);
    expect(
      parsed.ingestData?.verifiedIndustryEvidenceSummaries?.[0]
        ?.verdictRevisionId,
    ).toBe("rev-1");
  });

  it("rejects candidate evidence in the recruiter-facing projection", () => {
    expect(
      ResumeItemSchema.safeParse(createResumeWithEvidence("candidate")).success,
    ).toBe(false);
  });
});
