import { describe, expect, it } from "vitest";
import {
  buildCompanyAliasIndex,
  buildCompanyPolicyAliasIndex,
  CANONICAL_SEED_COMPANIES,
  companyRankingEffectTier,
  compareCompanyRankingEffects,
  hasActiveOverride,
  inferPolicyPreset,
  isAdvancingCandidateStatus,
  isCompanyPolicyHidden,
  isCompanyWorkflowBlocked,
  matchResumeCompanyPolicies,
  normalizeCompanyAlias,
  policyEffectsFromPreset,
  resolveCompanyAlias,
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

  it("prefers durable companyKey stamps over surface strings", () => {
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

    // A stamped entry resolves through the canonical key even when the
    // surface string itself matches no registered alias.
    const stamped = matchResumeCompanyPolicies(
      {
        workHistory: [
          {
            companyName: "Polywell Trading (HK) Co. Ltd.",
            companyKey: "polywell",
          },
        ],
      },
      index,
    );
    expect(stamped).toHaveLength(1);
    expect(stamped[0]?.companyKey).toBe("polywell");
    expect(stamped[0]?.preset).toBe("known_good");

    // The stamp wins over a surface string that would resolve elsewhere.
    const conflict = matchResumeCompanyPolicies(
      {
        workHistory: [
          { companyName: "东莞宝力机械", companyKey: "polywell" },
        ],
      },
      index,
    );
    expect(conflict).toHaveLength(1);
    expect(conflict[0]?.companyKey).toBe("polywell");

    // Unlinked entries keep the surface-string fallback.
    const fallback = matchResumeCompanyPolicies(
      { workHistory: [{ companyName: "东莞市宝力机械科技有限公司" }] },
      index,
    );
    expect(fallback[0]?.companyKey).toBe("pro-technic-machinery");
  });

  it("excludes archived (soft-deleted) companies from the policy alias index", () => {
    const policies = new Map([
      ["pro-technic-machinery", policyEffectsFromPreset("no_hire")],
      ["polywell", policyEffectsFromPreset("known_good")],
    ]);
    const index = buildCompanyPolicyAliasIndex(
      CANONICAL_SEED_COMPANIES.map((seed, i) => ({
        companyKey: seed.companyKey,
        displayName: seed.displayName,
        nameCn: seed.nameCn,
        nameEn: seed.nameEn,
        aliases: [...seed.aliases],
        // Polywell is archived (soft-deleted); Pro-Technic stays active.
        archivedAt: i === 1 ? 1784787490976 : undefined,
      })),
      policies,
    );

    const hits = matchResumeCompanyPolicies(
      {
        workHistory: [{ companyName: "Polywell" }],
        companyHits: ["宝惠"],
      },
      index,
    );
    expect(hits).toEqual([]);

    const active = matchResumeCompanyPolicies(
      { workHistory: [{ companyName: "宝力机械" }] },
      index,
    );
    expect(active).toHaveLength(1);
    expect(active[0]?.companyKey).toBe("pro-technic-machinery");
    expect(active[0]?.preset).toBe("no_hire");
  });
});

describe("ranking-effect tiers (score-sort stratification)", () => {
  it("maps effects to good/neutral/bad tiers without score mutation", () => {
    expect(companyRankingEffectTier("band_known_good")).toBe("good");
    expect(companyRankingEffectTier("boost")).toBe("good");
    expect(companyRankingEffectTier("none")).toBe("neutral");
    expect(companyRankingEffectTier(undefined)).toBe("neutral");
    expect(companyRankingEffectTier("band_known_bad")).toBe("bad");
    expect(companyRankingEffectTier("demote")).toBe("bad");
  });

  it("orders good before neutral before bad, equal tiers stable", () => {
    expect(compareCompanyRankingEffects("band_known_good", "band_known_bad")).toBeLessThan(0);
    expect(compareCompanyRankingEffects("boost", "none")).toBeLessThan(0);
    expect(compareCompanyRankingEffects("none", undefined)).toBe(0);
    expect(compareCompanyRankingEffects("demote", "band_known_bad")).toBe(0);
    expect(compareCompanyRankingEffects("band_known_bad", "band_known_good")).toBeGreaterThan(0);
    expect(compareCompanyRankingEffects(undefined, "boost")).toBeGreaterThan(0);
  });
});

describe("policy-free company alias index (link backfill)", () => {
  const companies = [
    {
      companyKey: "seco-tools-sdn-bhd",
      displayName: "SECO TOOLS (M) SDN BHD",
      aliases: [
        { aliasDisplay: "SECO Tools", aliasNormalized: "seco tools" },
        { aliasDisplay: "SECO TOOLS (M) SDN. BHD.", aliasNormalized: "seco tools m sdn bhd" },
      ],
    },
  ];

  it("matches exact and case/punctuation variants of display names and aliases", () => {
    const index = buildCompanyAliasIndex(companies);
    expect(index.get("seco tools m sdn bhd")).toBe("seco-tools-sdn-bhd");

    expect(resolveCompanyAlias(index, "SECO TOOLS (M) SDN. BHD.")).toBe(
      "seco-tools-sdn-bhd",
    );
    expect(resolveCompanyAlias(index, "seco tools m sdn bhd")).toBe(
      "seco-tools-sdn-bhd",
    );
    expect(resolveCompanyAlias(index, "  Seco Tools Sdn. Bhd. ")).toBe(
      "seco-tools-sdn-bhd",
    );
    expect(resolveCompanyAlias(index, "SECO TOOLS (M) SDN BHD")).toBe(
      "seco-tools-sdn-bhd",
    );
  });

  it("soft-matches employer strings that embed a registered alias", () => {
    const index = buildCompanyAliasIndex(companies);
    // "seco tools" is embedded in a longer employer string.
    expect(resolveCompanyAlias(index, "SECO TOOLS MALAYSIA TRADING")).toBe(
      "seco-tools-sdn-bhd",
    );
  });

  it("prefers the longest matching alias over shorter ones", () => {
    const index = buildCompanyAliasIndex([
      {
        companyKey: "haas-malaysia",
        displayName: "HAAS CNC",
        aliases: [{ aliasDisplay: "Haas Malaysia" }],
      },
      {
        companyKey: "haas-asia",
        displayName: "HAAS ASIA PACIFIC",
        aliases: [{ aliasDisplay: "Haas" }],
      },
    ]);
    // "Haas Malaysia Sdn Bhd" embeds both "haas malaysia" (longest) and "haas".
    expect(resolveCompanyAlias(index, "Haas Malaysia Sdn Bhd")).toBe("haas-malaysia");
  });

  it("returns null for unmatched employers and generic fragments shorter than 4 chars", () => {
    const index = buildCompanyAliasIndex(companies);
    expect(resolveCompanyAlias(index, "Unrelated Manufacturing Sdn Bhd")).toBeNull();
    expect(resolveCompanyAlias(index, "ABC")).toBeNull();
    expect(resolveCompanyAlias(index, "")).toBeNull();
    expect(resolveCompanyAlias(index, "   ")).toBeNull();
  });

  it("does not cross-map aliases between companies", () => {
    const index = buildCompanyAliasIndex([
      { companyKey: "acme-cnc", displayName: "ACME CNC" },
      { companyKey: "acme-other", displayName: "Acme Trading" },
    ]);
    expect(resolveCompanyAlias(index, "ACME CNC")).toBe("acme-cnc");
    expect(resolveCompanyAlias(index, "Acme Trading Sdn Bhd")).toBe("acme-other");
  });
});

describe("candidate policy overrides (advance-gate lift)", () => {
  const baseOverride = {
    _id: "id-1",
    workspaceSlug: "default",
    resumeId: "resume-1",
    resumeIdentity: "identity-1",
    companyKey: "polywell",
    effect: "allow" as const,
    reason: "HR approved follow-up",
    createdAt: 1,
    updatedAt: 2,
  };

  it("returns true only for an exact resume/company pair", () => {
    expect(hasActiveOverride([baseOverride], "identity-1", "polywell")).toBe(true);
    expect(hasActiveOverride([baseOverride], "identity-2", "polywell")).toBe(false);
    expect(hasActiveOverride([baseOverride], "identity-1", "pro-technic-machinery")).toBe(false);
  });

  it("tolerates whitespace drift in identity and company keys", () => {
    expect(hasActiveOverride([baseOverride], "  identity-1 ", " polywell ")).toBe(true);
  });

  it("is false for empty lists, undefined, and blank keys", () => {
    expect(hasActiveOverride([], "identity-1", "polywell")).toBe(false);
    expect(hasActiveOverride(undefined, "identity-1", "polywell")).toBe(false);
    expect(hasActiveOverride([baseOverride], "", "polywell")).toBe(false);
    expect(hasActiveOverride([baseOverride], "identity-1", "   ")).toBe(false);
  });

  it("ignores overrides for other companies when multiple exist", () => {
    const overrides = [
      baseOverride,
      {
        ...baseOverride,
        _id: "id-2",
        companyKey: "pro-technic-machinery",
        resumeIdentity: "identity-1",
      },
    ];
    expect(hasActiveOverride(overrides, "identity-1", "polywell")).toBe(true);
    expect(hasActiveOverride(overrides, "identity-1", "pro-technic-machinery")).toBe(true);
  });
});
