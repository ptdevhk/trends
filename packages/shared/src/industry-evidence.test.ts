import { describe, expect, it } from "vitest";

import {
  MAX_RECRUITER_INDUSTRY_EVIDENCE_SOURCES,
  normalizeIndustryEvidenceUrl,
  parseVerifiedIndustryEvidenceSummary,
} from "./industry-evidence";

describe("industry evidence contracts", () => {
  it("accepts a human-approved verified recruiter summary", () => {
    const summary = parseVerifiedIndustryEvidenceSummary({
      companyKey: "cnc-mechatronics",
      companyName: "CNC Mechatronics Sdn. Bhd.",
      industryClass: "cnc",
      verificationLevel: "verified",
      verdictRevisionId: "rev-cnc-mechatronics-2",
      evidenceSummary: "Official product evidence confirms CNC machinery operations.",
      verifiedYears: 4.25,
      reviewedAt: 1_754_000_000_000,
      sourceCount: 2,
      sourcePreviews: [
        {
          sourceId: "src-official",
          url: "https://cnc.example.com/about",
          sourceDomain: "cnc.example.com",
          sourceType: "official_site",
          trustTier: "primary",
          title: "About CNC Mechatronics",
          evidenceExcerpt: "Supplies CNC machining centres and related services.",
          reviewedAt: 1_754_000_000_000,
        },
      ],
    });

    expect(summary).toMatchObject({
      companyKey: "cnc-mechatronics",
      verificationLevel: "verified",
      verdictRevisionId: "rev-cnc-mechatronics-2",
      sourceCount: 2,
      additionalSourceCount: 1,
    });
    expect(summary?.sourcePreviews[0]?.url).toBe("https://cnc.example.com/about");
  });

  it.each(["candidate", "rejected"])(
    "rejects %s evidence from the recruiter-facing summary",
    (verificationLevel) => {
      expect(
        parseVerifiedIndustryEvidenceSummary({
          companyKey: "not-approved",
          companyName: "Not Approved",
          industryClass: "cnc",
          verificationLevel,
          verdictRevisionId: "rev-1",
          evidenceSummary: "Internal-only evidence.",
          reviewedAt: 1,
          sourceCount: 0,
          sourcePreviews: [],
        }),
      ).toBeNull();
    },
  );

  it("rejects a verified summary without an approved revision ID", () => {
    expect(
      parseVerifiedIndustryEvidenceSummary({
        companyKey: "missing-revision",
        companyName: "Missing Revision",
        industryClass: "cnc",
        verificationLevel: "verified",
        evidenceSummary: "No durable approval lineage.",
        reviewedAt: 1,
        sourceCount: 0,
        sourcePreviews: [],
      }),
    ).toBeNull();
  });

  it("omits unsafe URLs and bounds source previews deterministically", () => {
    const summary = parseVerifiedIndustryEvidenceSummary({
      companyKey: "bounded-company",
      companyName: "Bounded Company",
      industryClass: "industrial",
      verificationLevel: "verified",
      verdictRevisionId: "rev-bounded-1",
      evidenceSummary: "Reviewed industrial evidence.",
      reviewedAt: 2,
      sourceCount: 6,
      sourcePreviews: [
        {
          sourceId: "unsafe-js",
          url: "javascript:alert(1)",
          sourceType: "reporting",
          trustTier: "corroborating",
          title: "Unsafe",
          evidenceExcerpt: "Unsafe source.",
        },
        {
          sourceId: "unsafe-local",
          url: "http://127.0.0.1/private",
          sourceType: "registry",
          trustTier: "authoritative",
          title: "Local",
          evidenceExcerpt: "Private source.",
        },
        {
          sourceId: "directory",
          url: "https://directory.example.net/company",
          sourceType: "directory",
          trustTier: "corroborating",
          title: "Directory",
          evidenceExcerpt: "Industrial directory listing.",
        },
        {
          sourceId: "official",
          url: "https://official.example.com/products",
          sourceType: "official_site",
          trustTier: "primary",
          title: "Products",
          evidenceExcerpt: "Official machinery product catalogue.",
        },
        {
          sourceId: "registry",
          url: "https://registry.example.gov.my/company",
          sourceType: "registry",
          trustTier: "authoritative",
          title: "Registry",
          evidenceExcerpt: "Registered industrial business activity.",
        },
        {
          sourceId: "oem",
          url: "https://oem.example.org/partners/company",
          sourceType: "oem_partner",
          trustTier: "corroborating",
          title: "OEM partner",
          evidenceExcerpt: "Authorized machinery partner.",
        },
      ],
    });

    expect(summary?.sourcePreviews).toHaveLength(
      MAX_RECRUITER_INDUSTRY_EVIDENCE_SOURCES,
    );
    expect(summary?.sourcePreviews.map((source) => source.sourceId)).toEqual([
      "official",
      "registry",
      "oem",
    ]);
    expect(summary?.additionalSourceCount).toBe(3);
  });

  it("normalizes safe public URLs and rejects credentialed/private URLs", () => {
    expect(normalizeIndustryEvidenceUrl(" HTTPS://Example.COM:443/a#b ")).toEqual({
      url: "https://example.com/a#b",
      sourceDomain: "example.com",
    });
    expect(normalizeIndustryEvidenceUrl("https://user:pass@example.com")).toBeNull();
    expect(normalizeIndustryEvidenceUrl("http://localhost:3000")).toBeNull();
    expect(normalizeIndustryEvidenceUrl("https://10.0.0.8/internal")).toBeNull();
  });

  it("keeps legacy resume compatibility by accepting an absent projection", () => {
    expect(parseVerifiedIndustryEvidenceSummary(undefined)).toBeNull();
    expect(parseVerifiedIndustryEvidenceSummary(null)).toBeNull();
  });
});
