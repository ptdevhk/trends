import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "../convex/_generated/api.js";
import { createTest, seedResume } from "./test-helpers.js";

const originalWriteSecret = process.env.CONVEX_WRITE_SECRET;

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = "test-secret";
});

afterEach(() => {
  if (originalWriteSecret === undefined) {
    delete process.env.CONVEX_WRITE_SECRET;
  } else {
    process.env.CONVEX_WRITE_SECRET = originalWriteSecret;
  }
});

describe("companies:getIndustryCoverageSummary (budget-safe)", () => {
  it("computes resume counts from resumes.count() + company_resume_links and probes sources per open proposal", async () => {
    const t = createTest();
    const resumeA = await seedResume(t);
    const resumeB = await seedResume(t, {
      externalId: "test-resume-2",
      identityKey: "profileUrl:example.com/candidates/2",
      hash: "hash-2",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("company_industry_review_proposals", {
        proposalId: "proposal-1",
        status: "new",
        triggerReasons: ["unknown_employer"],
        priority: 40,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("company_industry_evidence_sources", {
        sourceId: "source-1",
        proposalId: "proposal-1",
        url: "https://x.example/about",
        sourceDomain: "x.example",
        sourceType: "official_site",
        trustTier: "primary",
        fetchStatus: "fetched",
        reviewStatus: "unreviewed",
        sourceState: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("company_industry_review_proposals", {
        proposalId: "proposal-2",
        status: "new",
        triggerReasons: ["unknown_employer"],
        priority: 30,
        createdAt: 1,
        updatedAt: 1,
      });
      // Resume A was computed under a verified verdict: its link carries the
      // current verdict revision (this is the same population the old
      // resume_digests scan counted, without scanning ~9k digests).
      await ctx.db.insert("company_resume_links", {
        workspaceSlug: "hr",
        companyKey: "ksb-malaysia",
        resumeId: resumeA,
        resumeIdentity: "identity-1",
        matchedEmployerSurfaces: ["ksb"],
        workEntryFingerprints: [],
        currentVerdictRevisionId: "rev-1",
        updatedAt: 1,
      });
      // Resume B has a link but was never computed under a verdict: it must
      // not count as verified evidence.
      await ctx.db.insert("company_resume_links", {
        workspaceSlug: "hr",
        companyKey: "other-co",
        resumeId: resumeB,
        resumeIdentity: "identity-2",
        matchedEmployerSurfaces: ["other"],
        workEntryFingerprints: [],
        updatedAt: 1,
      });
    });

    const summary = await t.query(api.companies.getIndustryCoverageSummary, {
      workspaceSlug: "hr",
      writeSecret: "test-secret",
    });

    expect(summary.resumes.total).toBe(2);
    expect(summary.resumes.withVerifiedEvidence).toBe(1);
    expect(summary.proposalsByStatus.new).toBe(2);
    expect(summary.openTotal).toBe(2);
    expect(summary.openWithSources).toBe(1);
    expect(summary.openWithoutSources).toBe(1);
    expect(summary.workspaceSlug).toBe("hr");
  });
});
