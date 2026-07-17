import { describe, expect, it } from "vitest";
import {
  buildCompanyPolicyAliasIndex,
  CANONICAL_SEED_COMPANIES,
  inferPolicyPreset,
  isAdvancingCandidateStatus,
  isCompanyPolicyHidden,
  isCompanyWorkflowBlocked,
  matchResumeCompanyPolicies,
  normalizeCompanyAlias,
  policyEffectsFromPreset,
  resolveMostSpecificPolicy,
} from "./company-policy.js";

describe("company-policy helpers", () => {
  it("keeps Pro-Technic and Polywell as separate seed companies", () => {
    const keys = CANONICAL_SEED_COMPANIES.map((item) => item.companyKey);
    expect(keys).toEqual(["pro-technic-machinery", "polywell"]);
    expect(CANONICAL_SEED_COMPANIES[0]?.nameCn).toBe("宝力机械");
    expect(CANONICAL_SEED_COMPANIES[0]?.nameEn).toBe("Pro-Technic Machinery");
    expect(CANONICAL_SEED_COMPANIES[1]?.nameCn).toBe("宝惠");
    expect(CANONICAL_SEED_COMPANIES[1]?.nameEn).toBe("Polywell");
  });

  it("normalizes aliases for case/punctuation matching", () => {
    expect(normalizeCompanyAlias("  Pro-Technic Machinery ")).toBe("pro-technic machinery");
    expect(normalizeCompanyAlias("宝力机械有限公司")).toBe("宝力机械有限公司");
    expect(normalizeCompanyAlias("Pro Technic")).toBe("pro technic");
  });

  it("maps presets to multi-effect policy payloads", () => {
    expect(policyEffectsFromPreset("known_good").rankingEffect).toBe("band_known_good");
    expect(policyEffectsFromPreset("no_hire")).toMatchObject({
      visibility: "hide",
      workflow: "blocked",
      rankingEffect: "band_known_bad",
    });
    expect(inferPolicyPreset(policyEffectsFromPreset("known_good"))).toBe("known_good");
    expect(inferPolicyPreset(policyEffectsFromPreset("no_hire"))).toBe("no_hire");
    expect(inferPolicyPreset(null)).toBe("none");
  });

  it("resolves most-specific scope wins", () => {
    const effective = resolveMostSpecificPolicy([
      {
        scopeType: "global",
        effects: { rankingEffect: "band_known_bad" },
      },
      {
        scopeType: "workspace",
        effects: { rankingEffect: "band_known_good" },
      },
      {
        scopeType: "market",
        effects: { rankingEffect: "none" },
      },
    ]);
    expect(effective?.rankingEffect).toBe("band_known_good");
  });

  it("matches resume employers to workspace policy without needing score changes", () => {
    const policies = new Map([
      ["pro-technic-machinery", policyEffectsFromPreset("no_hire")],
      ["polywell", policyEffectsFromPreset("known_good")],
    ]);
    const index = buildCompanyPolicyAliasIndex(
      CANONICAL_SEED_COMPANIES.map((seed) => ({
        companyKey: seed.companyKey,
        displayName: seed.displayName,
        nameCn: seed.nameCn,
        nameEn: seed.nameEn,
        aliases: [...seed.aliases],
      })),
      policies,
    );

    const hits = matchResumeCompanyPolicies(
      {
        workHistory: [{ companyName: "东莞宝力机械", jobTitle: "销售" } as { companyName?: string }],
        companyHits: ["宝力机械有限公司"],
      },
      index,
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]?.companyKey).toBe("pro-technic-machinery");
    expect(hits[0]?.preset).toBe("no_hire");

    const soft = matchResumeCompanyPolicies(
      {
        workHistory: [{ companyName: "东莞市宝力机械科技有限公司" }],
      },
      index,
    );
    expect(soft[0]?.companyKey).toBe("pro-technic-machinery");
    expect(soft[0]?.preset).toBe("no_hire");
    expect(isCompanyPolicyHidden(hits)).toBe(true);
    expect(isCompanyWorkflowBlocked(hits)).toBe(true);
    expect(isAdvancingCandidateStatus("shortlisted")).toBe(true);
    expect(isAdvancingCandidateStatus("rejected")).toBe(false);
  });
});
