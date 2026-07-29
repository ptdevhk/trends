import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api, internal } from "../convex/_generated/api.js";
import { createTest } from "./test-helpers.js";

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

function ingestData(
  entries: Array<{
    companyKey: string;
    companyName: string;
    jobTitle: string;
    verdictRevisionId?: string;
    workEntryFingerprint: string;
  }>,
) {
  return {
    industryTags: [],
    synonymHits: [],
    brandHits: [],
    companyHits: [],
    roleSignals: [
      {
        type: "sales",
        matchedSignals: ["sales"],
        signalCount: 1,
        occurrences: entries.length,
        years: entries.length,
        industryVerifiedYears: entries.length,
        matchedWorkEntries: entries.map((entry) => ({
          ...entry,
          years: 1,
          industryVerified: true,
          matchedSignals: ["sales"],
          directRoleMatch: true,
        })),
        verifyIn: "workHistory",
      },
    ],
    ruleScores: {},
    experienceLevel: "senior",
    computedAt: 1,
    skillsVersion: 1,
    evidenceProjectionVersion: 1,
  };
}

describe("company_resume_links", () => {
  it("derives deduplicated company links during ingest recompute and replaces stale links", async () => {
    const t = createTest();
    const resumeId = await t.run(async (ctx) =>
      ctx.db.insert("resumes", {
        externalId: "external-1",
        identityKey: "identity-1",
        content: { name: "Candidate" },
        hash: "hash-1",
        tags: [],
        crawledAt: 1,
        source: "test",
        workspaceSlug: "hr",
      }),
    );

    await t.mutation(internal.resumes_mutations.updateIngestDataBatch, {
      updates: [
        {
          resumeId,
          ingestData: ingestData([
            {
              companyKey: "acme-cnc",
              companyName: "ACME CNC",
              jobTitle: "Sales Manager",
              verdictRevisionId: "revision-acme-1",
              workEntryFingerprint: "acme-1",
            },
            {
              companyKey: "acme-cnc",
              companyName: "ACME CNC Sdn. Bhd.",
              jobTitle: "Sales Manager",
              verdictRevisionId: "revision-acme-1",
              workEntryFingerprint: "acme-2",
            },
            {
              companyKey: "other-industrial",
              companyName: "Other Industrial",
              jobTitle: "Sales Manager",
              verdictRevisionId: "revision-other-1",
              workEntryFingerprint: "other-1",
            },
          ]),
        },
      ],
    });

    const acme = await t.query(api.companies.listAffectedResumesByCompany, {
      companyKey: "acme-cnc",
      workspaceSlug: "hr",
      limit: 50,
      writeSecret: "test-secret",
    });
    expect(acme.items).toHaveLength(1);
    expect(acme.items[0]).toMatchObject({
      resumeId,
      resumeIdentity: "identity-1",
      currentVerdictRevisionId: "revision-acme-1",
    });
    expect(acme.items[0]?.matchedEmployerSurfaces).toEqual([
      "ACME CNC",
      "ACME CNC Sdn. Bhd.",
    ]);
    expect(acme.items[0]?.workEntryFingerprints).toEqual([
      "acme-1",
      "acme-2",
    ]);

    await t.mutation(internal.resumes_mutations.updateIngestDataBatch, {
      updates: [
        {
          resumeId,
          ingestData: ingestData([
            {
              companyKey: "other-industrial",
              companyName: "Other Industrial",
              jobTitle: "Sales Manager",
              verdictRevisionId: "revision-other-2",
              workEntryFingerprint: "other-2",
            },
          ]),
        },
      ],
    });

    const staleAcme = await t.query(api.companies.listAffectedResumesByCompany, {
      companyKey: "acme-cnc",
      workspaceSlug: "hr",
      limit: 50,
      writeSecret: "test-secret",
    });
    expect(staleAcme.items).toEqual([]);

    const other = await t.query(api.companies.listAffectedResumesByCompany, {
      companyKey: "other-industrial",
      workspaceSlug: "hr",
      limit: 50,
      writeSecret: "test-secret",
    });
    expect(other.items).toHaveLength(1);
    expect(other.items[0]?.currentVerdictRevisionId).toBe("revision-other-2");
  });

  it("preserves workspace scoping for affected-resume queries", async () => {
    const t = createTest();
    const resumeId = await t.run(async (ctx) =>
      ctx.db.insert("resumes", {
        externalId: "external-2",
        identityKey: "identity-2",
        content: { name: "Candidate" },
        hash: "hash-2",
        tags: [],
        crawledAt: 1,
        source: "test",
        workspaceSlug: "sales",
      }),
    );
    await t.mutation(internal.resumes_mutations.updateIngestDataBatch, {
      updates: [
        {
          resumeId,
          ingestData: ingestData([
            {
              companyKey: "acme-cnc",
              companyName: "ACME CNC",
              jobTitle: "Engineer",
              verdictRevisionId: "revision-acme-1",
              workEntryFingerprint: "acme-sales-1",
            },
          ]),
        },
      ],
    });

    const wrongWorkspace = await t.query(
      api.companies.listAffectedResumesByCompany,
      {
        companyKey: "acme-cnc",
        workspaceSlug: "hr",
        limit: 50,
        writeSecret: "test-secret",
      },
    );
    expect(wrongWorkspace.items).toEqual([]);
  });
});
