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
});
