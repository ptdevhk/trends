import { describe, expect, it } from "vitest";
import {
  buildCompanyAliasIndex,
  buildCompanyPolicyAliasIndex,
  CANONICAL_SEED_COMPANIES,
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
