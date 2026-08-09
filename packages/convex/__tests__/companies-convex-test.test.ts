/**
 * Integration tests for companies.ts (K3 company registry + policy).
 */
import { createTest } from "./test-helpers.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";

const WRITE_SECRET = "test-secret";
const originalWriteSecret = process.env.CONVEX_WRITE_SECRET;

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = WRITE_SECRET;
});

afterEach(() => {
  if (originalWriteSecret === undefined) {
    delete process.env.CONVEX_WRITE_SECRET;
    return;
  }
  process.env.CONVEX_WRITE_SECRET = originalWriteSecret;
});

describe("companies (convex-test)", () => {
  it("rejects reads without write secret", async () => {
    const t = createTest();
    await expect(t.query(api.companies.list, {})).rejects.toThrow("Unauthorized Convex read");
  });

  it("seeds Pro-Technic and Polywell as separate confirmed companies", async () => {
    const t = createTest();
    const seed = await t.mutation(api.companies.seedCanonicalCompanies, {
      writeSecret: WRITE_SECRET,
      seedNoHireForWorkspace: true,
      workspaceSlug: "hr",
      createdBy: "test",
    });
    expect(seed.companiesCreated).toBe(2);
    expect(seed.aliasesCreated).toBeGreaterThan(0);
    expect(seed.policiesSeeded).toBe(2);
    expect(seed.policyRevision).toBe(1);

    const list = await t.query(api.companies.list, { writeSecret: WRITE_SECRET });
    expect(list).toHaveLength(2);
    const keys = list.map((item) => item.companyKey).sort();
    expect(keys).toEqual(["polywell", "pro-technic-machinery"]);

    const resolved = await t.query(api.companies.resolveAlias, {
      alias: "宝力机械有限公司",
      writeSecret: WRITE_SECRET,
    });
    expect(resolved?.companyKey).toBe("pro-technic-machinery");

    const polywell = await t.query(api.companies.resolveAlias, {
      alias: "Polywell",
      writeSecret: WRITE_SECRET,
    });
    expect(polywell?.companyKey).toBe("polywell");

    const policies = await t.query(api.companies.listPoliciesForScope, {
      scopeType: "workspace",
      scopeId: "hr",
      writeSecret: WRITE_SECRET,
    });
    expect(policies).toHaveLength(2);
    for (const policy of policies) {
      expect(policy.effects?.rankingEffect).toBe("band_known_bad");
      expect(policy.effects?.visibility).toBe("hide");
      expect(policy.effects?.workflow).toBe("blocked");
    }
  });

  it("re-seeds no-hire after policies were cleared to none", async () => {
    const t = createTest();
    await t.mutation(api.companies.seedCanonicalCompanies, {
      writeSecret: WRITE_SECRET,
      seedNoHireForWorkspace: true,
      workspaceSlug: "hr",
    });

    // HR sets both to "none"
    for (const companyKey of ["pro-technic-machinery", "polywell"] as const) {
      await t.mutation(api.companies.appendPolicyRevision, {
        companyKey,
        scopeType: "workspace",
        scopeId: "hr",
        rankingEffect: "none",
        visibility: "default",
        workflow: "default",
        reasonCodes: [],
        writeSecret: WRITE_SECRET,
        createdBy: "hr",
      });
    }

    let policies = await t.query(api.companies.listPoliciesForScope, {
      scopeType: "workspace",
      scopeId: "hr",
      writeSecret: WRITE_SECRET,
    });
    expect(policies.every((p) => p.effects?.rankingEffect === "none")).toBe(true);

    // Re-click seed → force both back to no-hire
    const reseed = await t.mutation(api.companies.seedCanonicalCompanies, {
      writeSecret: WRITE_SECRET,
      seedNoHireForWorkspace: true,
      workspaceSlug: "hr",
    });
    expect(reseed.policiesSeeded).toBe(2);

    policies = await t.query(api.companies.listPoliciesForScope, {
      scopeType: "workspace",
      scopeId: "hr",
      writeSecret: WRITE_SECRET,
    });
    expect(policies).toHaveLength(2);
    for (const policy of policies) {
      expect(policy.effects?.visibility).toBe("hide");
      expect(policy.effects?.workflow).toBe("blocked");
      expect(policy.effects?.rankingEffect).toBe("band_known_bad");
      expect(policy.revision).toBeGreaterThanOrEqual(2);
    }

    // Idempotent: already no-hire → no new revisions
    const again = await t.mutation(api.companies.seedCanonicalCompanies, {
      writeSecret: WRITE_SECRET,
      seedNoHireForWorkspace: true,
      workspaceSlug: "hr",
    });
    expect(again.policiesSeeded).toBe(0);
  });

  it("restore-cycle guard: empty revisions → seed → no_hire for both → re-seed appends nothing", async () => {
    // Models a preview data restore (`convex import --replace-all`): tables
    // missing from the imported snapshot are materialized EMPTY, so the
    // workspace blacklist starts unset — exactly the state that made
    // preview's policies page show "no workspace policy" after the upgrade.
    const t = createTest();
    const before = await t.query(api.companies.listPoliciesForScope, {
      scopeType: "workspace",
      scopeId: "hr",
      writeSecret: WRITE_SECRET,
    });
    expect(before).toEqual([]);

    // The restore path re-asserts the canonical no-hire policies.
    const seed = await t.mutation(api.companies.seedCanonicalCompanies, {
      workspaceSlug: "hr",
      seedNoHireForWorkspace: true,
      writeSecret: WRITE_SECRET,
      createdBy: "seed",
    });
    expect(seed.companiesCreated).toBe(2);
    expect(seed.policiesSeeded).toBe(2);

    // The settings page lookup (`/hr/settings/policies` → listPoliciesForScope
    // with scopeId "hr") now resolves both companies to no-hire.
    const after = await t.query(api.companies.listPoliciesForScope, {
      scopeType: "workspace",
      scopeId: "hr",
      writeSecret: WRITE_SECRET,
    });
    expect(after.map((policy) => policy.companyKey).sort()).toEqual([
      "polywell",
      "pro-technic-machinery",
    ]);
    for (const policy of after) {
      expect(policy.scopeId).toBe("hr");
      expect(policy.revision).toBe(1);
      expect(policy.effects?.visibility).toBe("hide");
      expect(policy.effects?.workflow).toBe("blocked");
      expect(policy.effects?.rankingEffect).toBe("band_known_bad");
      expect(policy.effects?.summary).toContain("Seeded no-hire employer");
    }

    // A repeat restore cycle re-runs the same seed: already no-hire → no new
    // revision rows (idempotent), so revisions stay at 1.
    const reseed = await t.mutation(api.companies.seedCanonicalCompanies, {
      workspaceSlug: "hr",
      seedNoHireForWorkspace: true,
      writeSecret: WRITE_SECRET,
      createdBy: "seed",
    });
    expect(reseed.policiesSeeded).toBe(0);
    expect(reseed.policyRevision).toBeNull();
    const afterReseed = await t.query(api.companies.listPoliciesForScope, {
      scopeType: "workspace",
      scopeId: "hr",
      writeSecret: WRITE_SECRET,
    });
    expect(afterReseed).toHaveLength(2);
    expect(afterReseed.every((policy) => policy.revision === 1)).toBe(true);
  });

  it("archives and restores companies (soft delete)", async () => {
    const t = createTest();
    await t.mutation(api.companies.upsert, {
      companyKey: "acme-cnc",
      displayName: "ACME CNC",
      status: "confirmed",
      writeSecret: WRITE_SECRET,
      createdBy: "operator",
    });

    // Active by default: visible in the default list.
    const before = await t.query(api.companies.list, { writeSecret: WRITE_SECRET });
    expect(before.map((company) => company.companyKey)).toContain("acme-cnc");
    expect(before.find((company) => company.companyKey === "acme-cnc")?.archivedAt).toBeUndefined();

    // Archive → hidden from the default list, visible with includeArchived.
    const archived = await t.mutation(api.companies.setCompanyArchived, {
      companyKey: "acme-cnc",
      archived: true,
      writeSecret: WRITE_SECRET,
      createdBy: "operator",
    });
    expect(archived.archived).toBe(true);
    expect(archived.archivedAt).toBeTypeOf("number");

    const defaultList = await t.query(api.companies.list, { writeSecret: WRITE_SECRET });
    expect(defaultList.map((company) => company.companyKey)).not.toContain("acme-cnc");

    const withArchived = await t.query(api.companies.list, {
      includeArchived: true,
      writeSecret: WRITE_SECRET,
    });
    const archivedRow = withArchived.find((company) => company.companyKey === "acme-cnc");
    expect(archivedRow?.archivedAt).toBeTypeOf("number");

    // Status-filtered listing also hides archived rows.
    const confirmedOnly = await t.query(api.companies.list, {
      status: "confirmed",
      writeSecret: WRITE_SECRET,
    });
    expect(confirmedOnly.map((company) => company.companyKey)).not.toContain("acme-cnc");

    // Restore → visible again, archivedAt cleared.
    const restored = await t.mutation(api.companies.setCompanyArchived, {
      companyKey: "acme-cnc",
      archived: false,
      writeSecret: WRITE_SECRET,
      createdBy: "operator",
    });
    expect(restored.archived).toBe(false);
    expect(restored.archivedAt).toBeNull();

    const after = await t.query(api.companies.list, { writeSecret: WRITE_SECRET });
    const restoredRow = after.find((company) => company.companyKey === "acme-cnc");
    expect(restoredRow).toBeDefined();
    expect(restoredRow?.archivedAt).toBeUndefined();

    await expect(
      t.mutation(api.companies.setCompanyArchived, {
        companyKey: "no-such-company",
        archived: true,
        writeSecret: WRITE_SECRET,
      }),
    ).rejects.toThrow(/Unknown companyKey/);

    await expect(
      t.mutation(api.companies.setCompanyArchived, {
        companyKey: "acme-cnc",
        archived: true,
      }),
    ).rejects.toThrow("Unauthorized Convex write");
  });

  it("appends policy revisions and resolves workspace over global", async () => {
    const t = createTest();
    await t.mutation(api.companies.seedCanonicalCompanies, {
      writeSecret: WRITE_SECRET,
    });

    await t.mutation(api.companies.appendPolicyRevision, {
      companyKey: "pro-technic-machinery",
      scopeType: "global",
      scopeId: "global",
      rankingEffect: "band_known_bad",
      visibility: "hide",
      writeSecret: WRITE_SECRET,
      createdBy: "admin",
    });
    await t.mutation(api.companies.appendPolicyRevision, {
      companyKey: "pro-technic-machinery",
      scopeType: "workspace",
      scopeId: "hr",
      rankingEffect: "band_known_good",
      visibility: "default",
      writeSecret: WRITE_SECRET,
      createdBy: "hr-user",
    });

    const effective = await t.query(api.companies.getEffectivePolicy, {
      companyKey: "pro-technic-machinery",
      workspaceSlug: "hr",
      market: "CN",
      writeSecret: WRITE_SECRET,
    });
    expect(effective?.effects?.rankingEffect).toBe("band_known_good");
    expect(effective?.resolvedFrom?.scopeType).toBe("workspace");
  });

  it("refuses alias reassignment across companies", async () => {
    const t = createTest();
    await t.mutation(api.companies.seedCanonicalCompanies, {
      writeSecret: WRITE_SECRET,
    });
    await expect(
      t.mutation(api.companies.addAlias, {
        companyKey: "polywell",
        alias: "宝力机械",
        writeSecret: WRITE_SECRET,
      }),
    ).rejects.toThrow(/already mapped/);
  });

  it("upserts provisional companies and operator aliases", async () => {
    const t = createTest();
    const created = await t.mutation(api.companies.upsert, {
      companyKey: "acme-cnc",
      displayName: "ACME CNC",
      status: "provisional",
      writeSecret: WRITE_SECRET,
      createdBy: "operator",
    });
    expect(created.created).toBe(true);

    await t.mutation(api.companies.addAlias, {
      companyKey: "acme-cnc",
      alias: "ACME CNC Co.",
      source: "operator",
      writeSecret: WRITE_SECRET,
    });

    const resolved = await t.query(api.companies.resolveAlias, {
      alias: "acme cnc co",
      writeSecret: WRITE_SECRET,
    });
    expect(resolved?.companyKey).toBe("acme-cnc");
  });

  it("deduplicates open industry proposals by company and coalesces triggers", async () => {
    const t = createTest();
    await t.mutation(api.companies.upsert, {
      companyKey: "acme-cnc",
      displayName: "ACME CNC",
      status: "confirmed",
      writeSecret: WRITE_SECRET,
    });

    const first = await t.mutation(api.companies.upsertIndustryProposal, {
      proposalId: "proposal-acme-1",
      companyKey: "acme-cnc",
      triggerReasons: ["unknown_employer"],
      priority: 40,
      sampleReferences: [
        {
          workspaceSlug: "hr",
          resumeIdentity: "resume-1",
          workEntryFingerprint: "entry-1",
        },
      ],
      writeSecret: WRITE_SECRET,
    });
    const second = await t.mutation(api.companies.upsertIndustryProposal, {
      proposalId: "proposal-acme-duplicate",
      companyKey: "acme-cnc",
      triggerReasons: ["high_value_candidate", "unknown_employer"],
      priority: 90,
      sampleReferences: [
        {
          workspaceSlug: "hr",
          resumeIdentity: "resume-2",
          workEntryFingerprint: "entry-2",
        },
      ],
      writeSecret: WRITE_SECRET,
    });

    expect(second.proposalId).toBe(first.proposalId);
    expect(second.created).toBe(false);

    const proposals = await t.query(api.companies.listIndustryProposals, {
      status: "new",
      writeSecret: WRITE_SECRET,
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.priority).toBe(90);
    expect(proposals[0]?.triggerReasons).toEqual([
      "high_value_candidate",
      "unknown_employer",
    ]);
    expect(proposals[0]?.sampleReferences).toHaveLength(2);
  });

  it("resolves review targets only from exact workspace, resume identity, and work-entry fingerprint links", async () => {
    const t = createTest();
    const resumeId = await t.run(async (ctx) =>
      ctx.db.insert("resumes", {
        externalId: "external-vision-resume",
        identityKey: "identity-vision-resume",
        content: {},
        hash: "hash-vision-resume",
        tags: [],
        crawledAt: 1,
        source: "test",
        workspaceSlug: "dev",
        ingestData: {
          industryTags: [],
          synonymHits: [],
          roleSignals: [
            {
              type: "sales",
              matchedSignals: [],
              signalCount: 0,
              occurrences: 3,
              years: 6,
              industryVerifiedYears: 6,
              matchedWorkEntries: [
                {
                  companyName: "Vision Machine Tools",
                  jobTitle: "Sales Engineer",
                  years: 3,
                  industryVerified: true,
                  workEntryFingerprint: "fingerprint-vision",
                  matchedSignals: [],
                  directRoleMatch: true,
                },
                {
                  companyName: "Ambiguous CNC",
                  jobTitle: "Sales Engineer",
                  years: 2,
                  industryVerified: true,
                  workEntryFingerprint: "fingerprint-ambiguous",
                  matchedSignals: [],
                  directRoleMatch: true,
                },
                {
                  companyName: "Unlinked Employer",
                  jobTitle: "Sales Engineer",
                  years: 1,
                  industryVerified: true,
                  workEntryFingerprint: "fingerprint-unlinked",
                  matchedSignals: [],
                  directRoleMatch: true,
                },
              ],
              verifyIn: "workHistory",
            },
          ],
          ruleScores: {},
          experienceLevel: "senior",
          computedAt: 1,
          skillsVersion: 1,
        },
      }),
    );

    await t.run(async (ctx) => {
      const proposalRows = [
        {
          proposalId: "proposal-vision-open",
          normalizedEmployerSurface: "vision machine tools",
          status: "new" as const,
          priority: 90,
          sampleReferences: [
            {
              workspaceSlug: "dev",
              resumeIdentity: "identity-vision-resume",
              workEntryFingerprint: "fingerprint-vision",
            },
            {
              workspaceSlug: "dev",
              resumeIdentity: "external-vision-resume",
              workEntryFingerprint: "fingerprint-vision",
            },
          ],
        },
        {
          proposalId: "proposal-vision-terminal",
          normalizedEmployerSurface: "vision machine tools",
          status: "approved" as const,
          priority: 80,
          sampleReferences: [
            {
              workspaceSlug: "dev",
              resumeIdentity: "identity-vision-resume",
              workEntryFingerprint: "fingerprint-vision",
            },
          ],
        },
        {
          proposalId: "proposal-wrong-workspace",
          normalizedEmployerSurface: "vision machine tools",
          status: "new" as const,
          priority: 100,
          sampleReferences: [
            {
              workspaceSlug: "hr",
              resumeIdentity: "identity-vision-resume",
              workEntryFingerprint: "fingerprint-vision",
            },
          ],
        },
        {
          proposalId: "proposal-wrong-fingerprint",
          normalizedEmployerSurface: "vision machine tools",
          status: "new" as const,
          priority: 100,
          sampleReferences: [
            {
              workspaceSlug: "dev",
              resumeIdentity: "identity-vision-resume",
              workEntryFingerprint: "fingerprint-not-vision",
            },
          ],
        },
        {
          proposalId: "proposal-ambiguous-one",
          normalizedEmployerSurface: "ambiguous cnc one",
          status: "new" as const,
          priority: 80,
          sampleReferences: [
            {
              workspaceSlug: "dev",
              resumeIdentity: "identity-vision-resume",
              workEntryFingerprint: "fingerprint-ambiguous",
            },
          ],
        },
        {
          proposalId: "proposal-ambiguous-two",
          normalizedEmployerSurface: "ambiguous cnc two",
          status: "researching" as const,
          priority: 80,
          sampleReferences: [
            {
              workspaceSlug: "dev",
              resumeIdentity: "identity-vision-resume",
              workEntryFingerprint: "fingerprint-ambiguous",
            },
          ],
        },
      ];

      for (const row of proposalRows) {
        await ctx.db.insert("company_industry_review_proposals", {
          ...row,
          triggerReasons: ["unknown_employer"],
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });

    const result = await t.query(
      api.companies.resolveIndustryReviewTargetsForResume,
      {
        writeSecret: WRITE_SECRET,
        workspaceSlug: "dev",
        resumeId,
      },
    );

    expect(result.targets).toEqual([
      {
        workEntryKey: "fingerprint-ambiguous",
        employerLabel: "Ambiguous CNC",
        availability: "not_linked",
      },
      {
        workEntryKey: "fingerprint-unlinked",
        employerLabel: "Unlinked Employer",
        availability: "not_linked",
      },
      {
        workEntryKey: "fingerprint-vision",
        employerLabel: "Vision Machine Tools",
        proposalId: "proposal-vision-open",
        status: "new",
        availability: "target_available",
      },
    ]);

    await expect(
      t.query(api.companies.resolveIndustryReviewTargetsForResume, {
        workspaceSlug: "dev",
        resumeId,
      }),
    ).rejects.toThrow("Unauthorized Convex read");
  });

  it("creates immutable verdict revisions and advances only the current profile projection", async () => {
    const t = createTest();
    await t.mutation(api.companies.upsert, {
      companyKey: "acme-cnc",
      displayName: "ACME CNC",
      status: "confirmed",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.upsertIndustryProposal, {
      proposalId: "proposal-acme-1",
      companyKey: "acme-cnc",
      triggerReasons: ["missing_approved_profile"],
      priority: 80,
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.upsertIndustryEvidenceSource, {
      sourceId: "source-acme-official",
      proposalId: "proposal-acme-1",
      companyKey: "acme-cnc",
      url: "https://acme.example.com/products",
      sourceType: "official_site",
      trustTier: "primary",
      title: "ACME products",
      evidenceExcerpt: "CNC machining centres and industrial automation.",
      fetchStatus: "fetched",
      contentFingerprint: "sha256:first",
      writeSecret: WRITE_SECRET,
    });

    const firstApproval = await t.mutation(api.companies.approveIndustryProposal, {
      proposalId: "proposal-acme-1",
      revisionId: "revision-acme-1",
      verificationLevel: "verified",
      industryClass: "cnc",
      approvedSourceIds: ["source-acme-official"],
      evidenceSummary: "Official product evidence confirms CNC machinery.",
      reviewer: "admin@example.com",
      decisionReason: "Official first-party evidence.",
      taxonomyVersion: "industry-taxonomy-v1",
      reviewAttestation: {
        schemaVersion: "industry-review-attestation.v1",
        inputFingerprint: "legacy-convex-test",
        decisionMode: "standard",
        acknowledgedRiskFlags: [],
        cncEvidenceAcknowledged: true,
        acknowledgementReason: "",
      },
      writeSecret: WRITE_SECRET,
    });
    expect(firstApproval.revisionId).toBe("revision-acme-1");
    expect(firstApproval.supersedesRevisionId).toBeUndefined();
    const idempotentApproval = await t.mutation(
      api.companies.approveIndustryProposal,
      {
        proposalId: "proposal-acme-1",
        revisionId: "revision-acme-1",
        verificationLevel: "verified",
        industryClass: "cnc",
        approvedSourceIds: ["source-acme-official"],
        evidenceSummary: "Official product evidence confirms CNC machinery.",
        reviewer: "admin@example.com",
        decisionReason: "Official first-party evidence.",
        taxonomyVersion: "industry-taxonomy-v1",
        reviewAttestation: {
          schemaVersion: "industry-review-attestation.v1",
          inputFingerprint: "legacy-convex-test",
          decisionMode: "standard",
          acknowledgedRiskFlags: [],
          cncEvidenceAcknowledged: true,
          acknowledgementReason: "",
        },
        writeSecret: WRITE_SECRET,
      },
    );
    expect(idempotentApproval).toEqual(firstApproval);

    const firstProfile = await t.query(api.companies.getIndustryProfile, {
      companyKey: "acme-cnc",
      writeSecret: WRITE_SECRET,
    });
    expect(firstProfile).toMatchObject({
      companyKey: "acme-cnc",
      verificationLevel: "verified",
      currentRevisionId: "revision-acme-1",
      sourceCount: 1,
      reviewedBy: "admin@example.com",
    });
    expect(firstProfile?.nextReviewAt).toBeGreaterThan(firstProfile?.reviewedAt ?? 0);

    await t.mutation(api.companies.upsertIndustryProposal, {
      proposalId: "proposal-acme-2",
      companyKey: "acme-cnc",
      triggerReasons: ["material_source_change"],
      priority: 95,
      currentRevisionId: "revision-acme-1",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.upsertIndustryEvidenceSource, {
      sourceId: "source-acme-registry",
      proposalId: "proposal-acme-2",
      companyKey: "acme-cnc",
      url: "https://registry.example.gov.my/acme",
      sourceType: "registry",
      trustTier: "authoritative",
      title: "ACME registry",
      evidenceExcerpt: "Registered machinery manufacturing activity.",
      fetchStatus: "fetched",
      contentFingerprint: "sha256:second",
      writeSecret: WRITE_SECRET,
    });

    const secondApproval = await t.mutation(api.companies.approveIndustryProposal, {
      proposalId: "proposal-acme-2",
      revisionId: "revision-acme-2",
      expectedCurrentRevisionId: "revision-acme-1",
      verificationLevel: "verified",
      industryClass: "industrial",
      approvedSourceIds: ["source-acme-registry"],
      evidenceSummary: "Registry evidence supports industrial machinery.",
      reviewer: "admin@example.com",
      decisionReason: "Material classification refinement.",
      taxonomyVersion: "industry-taxonomy-v1",
      writeSecret: WRITE_SECRET,
    });
    expect(secondApproval.supersedesRevisionId).toBe("revision-acme-1");

    const revisions = await t.query(api.companies.listIndustryVerdictRevisions, {
      companyKey: "acme-cnc",
      writeSecret: WRITE_SECRET,
    });
    expect(revisions.map((revision) => revision.revisionId)).toEqual([
      "revision-acme-2",
      "revision-acme-1",
    ]);
    expect(revisions[0]?.supersedesRevisionId).toBe("revision-acme-1");

    const currentProfile = await t.query(api.companies.getIndustryProfile, {
      companyKey: "acme-cnc",
      writeSecret: WRITE_SECRET,
    });
    expect(currentProfile?.currentRevisionId).toBe("revision-acme-2");

  });

  it("rejecting or requesting more evidence does not change current approved truth", async () => {
    const t = createTest();
    await t.mutation(api.companies.upsert, {
      companyKey: "acme-cnc",
      displayName: "ACME CNC",
      status: "confirmed",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.upsertIndustryProfile, {
      companyKey: "acme-cnc",
      industryClass: "cnc",
      verificationLevel: "verified",
      evidenceSource: "manual",
      currentRevisionId: "revision-existing",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.upsertIndustryProposal, {
      proposalId: "proposal-review-only",
      companyKey: "acme-cnc",
      triggerReasons: ["recruiter_refresh_request"],
      priority: 100,
      currentRevisionId: "revision-existing",
      writeSecret: WRITE_SECRET,
    });

    await t.mutation(api.companies.resolveIndustryProposal, {
      proposalId: "proposal-review-only",
      resolution: "needs_more_evidence",
      reviewer: "admin@example.com",
      reviewNote: "Need registry corroboration.",
      writeSecret: WRITE_SECRET,
    });

    const profile = await t.query(api.companies.getIndustryProfile, {
      companyKey: "acme-cnc",
      writeSecret: WRITE_SECRET,
    });
    expect(profile?.currentRevisionId).toBe("revision-existing");

    const proposal = await t.query(api.companies.getIndustryProposal, {
      proposalId: "proposal-review-only",
      writeSecret: WRITE_SECRET,
    });
    expect(proposal?.status).toBe("needs_more_evidence");
  });

  it("accepts a resolution without a review note (bulk reject contract)", async () => {
    const t = createTest();
    await t.mutation(api.companies.upsert, {
      companyKey: "acme-cnc",
      displayName: "ACME CNC",
      status: "confirmed",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.upsertIndustryProposal, {
      proposalId: "proposal-bulk-reject",
      companyKey: "acme-cnc",
      triggerReasons: ["recruiter_refresh_request"],
      priority: 100,
      writeSecret: WRITE_SECRET,
    });

    const result = await t.mutation(api.companies.resolveIndustryProposal, {
      proposalId: "proposal-bulk-reject",
      resolution: "rejected",
      reviewer: "admin@example.com",
      writeSecret: WRITE_SECRET,
    });

    expect(result).toEqual({ proposalId: "proposal-bulk-reject", status: "rejected" });
    const proposal = await t.query(api.companies.getIndustryProposal, {
      proposalId: "proposal-bulk-reject",
      writeSecret: WRITE_SECRET,
    });
    expect(proposal?.reviewNote).toBe("");
  });

  it("allows worker research to enrich only an open proposal", async () => {
    const t = createTest();
    await t.mutation(api.companies.upsert, {
      companyKey: "acme-cnc",
      displayName: "ACME CNC",
      status: "confirmed",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.upsertIndustryProposal, {
      proposalId: "proposal-worker-research",
      companyKey: "acme-cnc",
      triggerReasons: ["unknown_employer"],
      priority: 70,
      writeSecret: WRITE_SECRET,
    });

    await t.mutation(api.companies.setIndustryProposalResearchState, {
      proposalId: "proposal-worker-research",
      status: "researching",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.upsertIndustryEvidenceSource, {
      sourceId: "source-worker-official",
      proposalId: "proposal-worker-research",
      companyKey: "acme-cnc",
      url: "https://acme.example.com/cnc",
      sourceType: "official_site",
      trustTier: "primary",
      fetchStatus: "fetched",
      contentFingerprint: "sha256:worker",
      suggestedIndustryClass: "cnc",
      workerConfidence: 0.92,
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.setIndustryProposalResearchState, {
      proposalId: "proposal-worker-research",
      status: "ready_for_review",
      suggestedIndustryClass: "cnc",
      suggestedVerificationLevel: "candidate",
      materialChangeSummary: "Official product page mentions CNC machining centres.",
      writeSecret: WRITE_SECRET,
    });

    const proposal = await t.query(api.companies.getIndustryProposal, {
      proposalId: "proposal-worker-research",
      writeSecret: WRITE_SECRET,
    });
    expect(proposal).toMatchObject({
      status: "ready_for_review",
      suggestedIndustryClass: "cnc",
      suggestedVerificationLevel: "candidate",
    });
    expect(proposal?.researchStartedAt).toBeTypeOf("number");
    expect(proposal?.readyForReviewAt).toBeTypeOf("number");

    const profile = await t.query(api.companies.getIndustryProfile, {
      companyKey: "acme-cnc",
      writeSecret: WRITE_SECRET,
    });
    expect(profile).toBeNull();
    const revisions = await t.query(api.companies.listIndustryVerdictRevisions, {
      companyKey: "acme-cnc",
      writeSecret: WRITE_SECRET,
    });
    expect(revisions).toEqual([]);
  });

  it("selects due approved sources and records unchanged freshness without changing truth", async () => {
    const t = createTest();
    await t.mutation(api.companies.upsert, {
      companyKey: "acme-cnc",
      displayName: "ACME CNC",
      status: "confirmed",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.upsertIndustryProposal, {
      proposalId: "proposal-freshness-bootstrap",
      companyKey: "acme-cnc",
      triggerReasons: ["missing_approved_profile"],
      priority: 80,
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.upsertIndustryEvidenceSource, {
      sourceId: "source-freshness-official",
      proposalId: "proposal-freshness-bootstrap",
      companyKey: "acme-cnc",
      url: "https://acme.example.com/products",
      sourceType: "official_site",
      trustTier: "primary",
      evidenceExcerpt: "CNC machining centres and industrial automation.",
      fetchStatus: "fetched",
      contentFingerprint: "sha256:stable",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.approveIndustryProposal, {
      proposalId: "proposal-freshness-bootstrap",
      revisionId: "revision-freshness-1",
      verificationLevel: "verified",
      industryClass: "cnc",
      approvedSourceIds: ["source-freshness-official"],
      evidenceSummary: "Approved CNC evidence.",
      reviewer: "admin@example.com",
      decisionReason: "Official evidence.",
      taxonomyVersion: "industry-taxonomy-v1",
      reviewAttestation: {
        schemaVersion: "industry-review-attestation.v1",
        inputFingerprint: "legacy-convex-test",
        decisionMode: "standard",
        acknowledgedRiskFlags: [],
        cncEvidenceAcknowledged: true,
        acknowledgementReason: "",
      },
      nextReviewAt: 100,
      writeSecret: WRITE_SECRET,
    });

    const notDue = await t.query(api.companies.listDueIndustryEvidenceSources, {
      now: 99,
      writeSecret: WRITE_SECRET,
    });
    expect(notDue).toEqual([]);
    const due = await t.query(api.companies.listDueIndustryEvidenceSources, {
      now: 100,
      writeSecret: WRITE_SECRET,
    });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      sourceId: "source-freshness-official",
      companyKey: "acme-cnc",
      verdictRevisionId: "revision-freshness-1",
      approvedSourceCount: 1,
    });

    await t.mutation(api.companies.markIndustryEvidenceProfilesChecking, {
      profiles: [
        {
          companyKey: "acme-cnc",
          verdictRevisionId: "revision-freshness-1",
        },
      ],
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.recordIndustryEvidenceFreshnessCheck, {
      checkId: "check-stable-1",
      sourceId: "source-freshness-official",
      companyKey: "acme-cnc",
      verdictRevisionId: "revision-freshness-1",
      checkedAt: 200,
      outcome: "unchanged",
      observedUrl: "https://acme.example.com/products",
      observedContentFingerprint: "sha256:stable",
      fetchStatus: "fetched",
      writeSecret: WRITE_SECRET,
    });

    const profile = await t.query(api.companies.getIndustryProfile, {
      companyKey: "acme-cnc",
      writeSecret: WRITE_SECRET,
    });
    expect(profile).toMatchObject({
      currentRevisionId: "revision-freshness-1",
      verificationLevel: "verified",
      freshnessState: "fresh",
      nextReviewAt: 200 + 180 * 24 * 60 * 60 * 1_000,
    });
    const checks = await t.query(api.companies.listIndustryEvidenceChecks, {
      companyKey: "acme-cnc",
      writeSecret: WRITE_SECRET,
    });
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      checkId: "check-stable-1",
      outcome: "unchanged",
    });
  });

  it("requires a coalesced proposal for changed or unavailable evidence and preserves the badge", async () => {
    const t = createTest();
    await t.mutation(api.companies.upsert, {
      companyKey: "acme-cnc",
      displayName: "ACME CNC",
      status: "confirmed",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.upsertIndustryProposal, {
      proposalId: "proposal-current",
      companyKey: "acme-cnc",
      triggerReasons: ["missing_approved_profile"],
      priority: 80,
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.upsertIndustryEvidenceSource, {
      sourceId: "source-current",
      proposalId: "proposal-current",
      companyKey: "acme-cnc",
      url: "https://acme.example.com/products",
      sourceType: "official_site",
      trustTier: "primary",
      evidenceExcerpt: "CNC machining centres and industrial automation.",
      fetchStatus: "fetched",
      contentFingerprint: "sha256:old",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.approveIndustryProposal, {
      proposalId: "proposal-current",
      revisionId: "revision-current",
      verificationLevel: "verified",
      industryClass: "cnc",
      approvedSourceIds: ["source-current"],
      evidenceSummary: "Approved CNC evidence.",
      reviewer: "admin@example.com",
      decisionReason: "Official evidence.",
      taxonomyVersion: "industry-taxonomy-v1",
      reviewAttestation: {
        schemaVersion: "industry-review-attestation.v1",
        inputFingerprint: "legacy-convex-test",
        decisionMode: "standard",
        acknowledgedRiskFlags: [],
        cncEvidenceAcknowledged: true,
        acknowledgementReason: "",
      },
      nextReviewAt: 100,
      writeSecret: WRITE_SECRET,
    });

    await expect(
      t.mutation(api.companies.recordIndustryEvidenceFreshnessCheck, {
        checkId: "check-change-without-proposal",
        sourceId: "source-current",
        companyKey: "acme-cnc",
        verdictRevisionId: "revision-current",
        checkedAt: 200,
        outcome: "changed",
        observedContentFingerprint: "sha256:new",
        fetchStatus: "fetched",
        writeSecret: WRITE_SECRET,
      }),
    ).rejects.toThrow(/requires a proposal/i);

    const proposal = await t.mutation(api.companies.upsertIndustryProposal, {
      proposalId: "proposal-source-unavailable",
      companyKey: "acme-cnc",
      triggerReasons: ["scheduled_freshness", "source_unavailable"],
      priority: 100,
      currentRevisionId: "revision-current",
      materialChangeSummary: "All approved sources were unavailable.",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.recordIndustryEvidenceFreshnessCheck, {
      checkId: "check-unavailable-1",
      sourceId: "source-current",
      companyKey: "acme-cnc",
      verdictRevisionId: "revision-current",
      proposalId: proposal.proposalId,
      checkedAt: 200,
      outcome: "unavailable",
      fetchStatus: "unavailable",
      httpStatus: 503,
      errorCode: "temporary_outage",
      writeSecret: WRITE_SECRET,
    });

    const profile = await t.query(api.companies.getIndustryProfile, {
      companyKey: "acme-cnc",
      writeSecret: WRITE_SECRET,
    });
    expect(profile).toMatchObject({
      currentRevisionId: "revision-current",
      verificationLevel: "verified",
      freshnessState: "unavailable",
    });
    const revisions = await t.query(api.companies.listIndustryVerdictRevisions, {
      companyKey: "acme-cnc",
      writeSecret: WRITE_SECRET,
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.verificationLevel).toBe("verified");
  });

  it("records each authorized recruiter refresh request against the coalesced proposal", async () => {
    const t = createTest();
    await t.mutation(api.companies.upsert, {
      companyKey: "acme-cnc",
      displayName: "ACME CNC",
      status: "confirmed",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.upsertIndustryProfile, {
      companyKey: "acme-cnc",
      industryClass: "cnc",
      verificationLevel: "verified",
      evidenceSource: "manual",
      currentRevisionId: "revision-current",
      writeSecret: WRITE_SECRET,
    });
    const resumeId = await t.run(async (ctx) =>
      ctx.db.insert("resumes", {
        externalId: "resume-1",
        identityKey: "identity-resume-1",
        content: {},
        hash: "hash-resume-1",
        tags: [],
        crawledAt: 1,
        source: "test",
        workspaceSlug: "my",
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("company_resume_links", {
        workspaceSlug: "my",
        companyKey: "acme-cnc",
        resumeId,
        resumeIdentity: "identity-resume-1",
        matchedEmployerSurfaces: ["ACME CNC"],
        workEntryFingerprints: ["work-1"],
        currentVerdictRevisionId: "revision-current",
        updatedAt: 1,
      });
    });
    const proposal = await t.mutation(api.companies.upsertIndustryProposal, {
      proposalId: "proposal-refresh-request",
      companyKey: "acme-cnc",
      triggerReasons: ["recruiter_refresh_request"],
      priority: 100,
      currentRevisionId: "revision-current",
      requestedBy: "recruiter-1",
      writeSecret: WRITE_SECRET,
    });
    const resolvedReference = await t.query(
      api.companies.resolveIndustryRefreshResumeReference,
      {
        workspaceSlug: "my",
        companyKey: "acme-cnc",
        verdictRevisionId: "revision-current",
        resumeReference: String(resumeId),
        writeSecret: WRITE_SECRET,
      },
    );
    expect(resolvedReference).toEqual({
      resumeIdentity: "identity-resume-1",
      workEntryFingerprint: "work-1",
    });

    const first = await t.mutation(api.companies.recordIndustryRefreshRequest, {
      requestId: "refresh-request-1",
      proposalId: proposal.proposalId,
      companyKey: "acme-cnc",
      verdictRevisionId: "revision-current",
      workspaceSlug: "my",
      requesterId: "recruiter-1",
      reasonCode: "stale",
      resumeIdentity: "identity-resume-1",
      workEntryFingerprint: "work-1",
      writeSecret: WRITE_SECRET,
    });
    const duplicate = await t.mutation(
      api.companies.recordIndustryRefreshRequest,
      {
        requestId: "refresh-request-1",
        proposalId: proposal.proposalId,
        companyKey: "acme-cnc",
        verdictRevisionId: "revision-current",
        workspaceSlug: "my",
        requesterId: "recruiter-1",
        reasonCode: "stale",
        resumeIdentity: "identity-resume-1",
        workEntryFingerprint: "work-1",
        writeSecret: WRITE_SECRET,
      },
    );
    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);

    const requests = await t.query(api.companies.listIndustryRefreshRequests, {
      proposalId: proposal.proposalId,
      writeSecret: WRITE_SECRET,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      companyKey: "acme-cnc",
      verdictRevisionId: "revision-current",
      workspaceSlug: "my",
      requesterId: "recruiter-1",
      reasonCode: "stale",
      resumeIdentity: "identity-resume-1",
      workEntryFingerprint: "work-1",
    });

    const profile = await t.query(api.companies.getIndustryProfile, {
      companyKey: "acme-cnc",
      writeSecret: WRITE_SECRET,
    });
    expect(profile).toMatchObject({
      verificationLevel: "verified",
      currentRevisionId: "revision-current",
    });
  });
});
