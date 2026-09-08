import { describe, expect, it } from "vitest";

import {
  computeVerifiedRoleYears,
  getRoleRelevantSignalYears,
  isSalesRequiredContext,
  normalizeSearchRoleFilterType,
  resolveGateRoleYears,
  resolveResumeDiagnosticsSourceKey,
} from "../analysis-key";

describe("isSalesRequiredContext", () => {
  it("detects common English sales-title phrases", () => {
    expect(isSalesRequiredContext("account manager")).toBe(true);
    expect(isSalesRequiredContext("key account manager")).toBe(true);
    expect(isSalesRequiredContext("business development manager")).toBe(true);
    expect(isSalesRequiredContext("channel manager")).toBe(true);
  });

  it("detects Chinese sales terms", () => {
    expect(isSalesRequiredContext("销售经理")).toBe(true);
    expect(isSalesRequiredContext("客户开发")).toBe(true);
    expect(isSalesRequiredContext("业务拓展")).toBe(true);
  });

  it("does not classify non-sales technical titles as sales", () => {
    expect(isSalesRequiredContext("应用工程师")).toBe(false);
    expect(isSalesRequiredContext("机械工程师")).toBe(false);
  });
});

describe("resolveResumeDiagnosticsSourceKey", () => {
  it("keeps manual 51job imports as their own diagnostics key", () => {
    expect(resolveResumeDiagnosticsSourceKey({ source: "51job-manual" })).toBe("51job-manual");
    expect(resolveResumeDiagnosticsSourceKey({ sourceKey: "51job-manual" })).toBe("51job-manual");
  });

  it("maps live source hosts to grouped diagnostics keys", () => {
    expect(resolveResumeDiagnosticsSourceKey({ source: "hr.job5156.com" })).toBe("job5156");
    expect(resolveResumeDiagnosticsSourceKey({ source: "ehire.51job.com" })).toBe("51job");
    expect(resolveResumeDiagnosticsSourceKey({ source: "my.employer.seek.com" })).toBe("seek");
  });

  it("returns unknown for unmatched source values", () => {
    expect(resolveResumeDiagnosticsSourceKey({ source: "manual.51job.com" })).toBe("unknown");
    expect(resolveResumeDiagnosticsSourceKey({ source: "unknown-host.example.com" })).toBe("unknown");
    expect(resolveResumeDiagnosticsSourceKey({ source: "" })).toBe("unknown");
  });
});

describe("computeVerifiedRoleYears", () => {
  it("projects industryVerifiedRelevantYears by role type", () => {
    const result = computeVerifiedRoleYears([
      {
        type: "sales",
        verifyIn: "workHistory",
        industryVerifiedRelevantYears: 5,
        industryVerifiedYears: 5,
      },
      {
        type: "engineer",
        verifyIn: "workHistory",
        industryVerifiedYears: 3,
      },
    ]);

    expect(result).toEqual({ sales: 5, engineer: 3 });
  });

  it("never reads unverified roleRelevantYears or raw years", () => {
    const result = computeVerifiedRoleYears([
      {
        type: "sales",
        verifyIn: "workHistory",
        years: 10,
        roleRelevantYears: 7,
      },
    ]);

    expect(result).toEqual({});
  });

  it("drops entries whose verified value resolves to 0", () => {
    const result = computeVerifiedRoleYears([
      {
        type: "sales",
        verifyIn: "workHistory",
        industryVerifiedRelevantYears: 0,
        industryVerifiedYears: 0,
      },
    ]);

    expect(result).toEqual({});
  });

  it("returns empty object for undefined / empty input", () => {
    expect(computeVerifiedRoleYears(undefined)).toEqual({});
    expect(computeVerifiedRoleYears([])).toEqual({});
  });
});

describe("getRoleRelevantSignalYears", () => {
  it("counts direct role-matched sales years even when the company is not industry verified", () => {
    const years = getRoleRelevantSignalYears([
      {
        type: "sales",
        verifyIn: "workHistory",
        years: 6.75,
        roleRelevantYears: 6.75,
        industryVerifiedRelevantYears: 0,
        matchedWorkEntries: [
          {
            years: 6.75,
            directRoleMatch: true,
            industryVerified: false,
          },
        ],
      },
    ], "sales");

    expect(years).toBe(6.75);
  });

  it("does not count description-only sales mentions when directRoleMatch is false", () => {
    const years = getRoleRelevantSignalYears([
      {
        type: "sales",
        verifyIn: "workHistory",
        years: 5,
        roleRelevantYears: 0,
        industryVerifiedRelevantYears: 0,
        matchedWorkEntries: [
          {
            years: 5,
            directRoleMatch: false,
            industryVerified: false,
          },
        ],
      },
    ], "sales");

    expect(years).toBe(0);
  });

  it("falls back to roleRelevantYears for older role signals without entry-level direct flags", () => {
    const years = getRoleRelevantSignalYears([
      {
        type: "sales",
        verifyIn: "workHistory",
        years: 2.08,
        roleRelevantYears: 2.08,
        industryVerifiedRelevantYears: 0,
      },
    ], "sales");

    expect(years).toBe(2.08);
  });
});

describe("resolveGateRoleYears", () => {
  const directSalesSignals = [
    {
      type: "sales",
      years: 5.5,
      roleRelevantYears: 5.5,
      industryVerifiedRelevantYears: 0,
      industryVerifiedYears: 0,
      matchedWorkEntries: [
        {
          years: 5.5,
          directRoleMatch: true,
          industryVerified: false,
        },
      ],
    },
  ];

  it("does not fall back to unverified direct-role years for MY or Seek", () => {
    expect(resolveGateRoleYears(directSalesSignals, "sales", {})).toBe(0);
    expect(resolveGateRoleYears(directSalesSignals, "sales", { sales: 0 })).toBe(0);
  });

  it("prefers precomputed verifiedRoleYears when present", () => {
    expect(resolveGateRoleYears(directSalesSignals, "sales", { sales: 3 })).toBe(3);
  });

  it("returns the maximum verified years when roleType is empty", () => {
    expect(resolveGateRoleYears([
      {
        type: "sales",
        years: 2,
        industryVerifiedRelevantYears: 2,
        industryVerifiedYears: 2,
      },
      {
        type: "engineer",
        years: 4,
        industryVerifiedRelevantYears: 4,
        industryVerifiedYears: 4,
      },
    ], undefined, {})).toBe(4);
  });

  it("keeps verified years isolated by requested role type", () => {
    const mixedSignals = [
      {
        type: "sales",
        years: 5.5,
        roleRelevantYears: 5.5,
        industryVerifiedRelevantYears: 0,
        industryVerifiedYears: 0,
        matchedWorkEntries: [
          {
            years: 5.5,
            directRoleMatch: true,
            industryVerified: false,
          },
        ],
      },
      {
        type: "engineer",
        years: 7,
        industryVerifiedRelevantYears: 7,
        industryVerifiedYears: 7,
        matchedWorkEntries: [
          {
            years: 7,
            directRoleMatch: true,
            industryVerified: true,
          },
        ],
      },
    ];

    expect(resolveGateRoleYears(mixedSignals, "sales", {})).toBe(0);
    expect(resolveGateRoleYears(mixedSignals, "engineer", {})).toBe(7);
    expect(resolveGateRoleYears(mixedSignals, undefined, {})).toBe(7);
  });

  it("aliases the legacy technical label to the engineer role key", () => {
    expect(normalizeSearchRoleFilterType("technical")).toBe("engineer");
    expect(normalizeSearchRoleFilterType("TECHNICAL")).toBe("engineer");
    expect(normalizeSearchRoleFilterType("engineer")).toBe("engineer");
    expect(normalizeSearchRoleFilterType("sales")).toBe("sales");
    expect(normalizeSearchRoleFilterType(undefined)).toBe("");
    expect(normalizeSearchRoleFilterType(" ")).toBe("");

    const engineerSignals = [
      {
        type: "engineer",
        years: 4,
        industryVerifiedRelevantYears: 4,
        industryVerifiedYears: 4,
      },
    ];
    // roleType=technical must resolve the engineer years (this is what made the
    // operator URL return 0 before the alias).
    expect(resolveGateRoleYears(engineerSignals, "technical", {})).toBe(4);
  });

  it("keeps strict verified-only gating for CN rows even when no verdict exists", () => {
    // CN is the core market. A direct-role engineer resume at an unverified CN
    // employer (no verdictRevisionId, roleRelevantYears present) must NOT pass
    // minRoleYears under the relaxation — CN stays strict industry-verified.
    const cnUnverified = [
      {
        type: "engineer",
        years: 6,
        roleRelevantYears: 6,
        industryVerifiedRelevantYears: 0,
        industryVerifiedYears: 0,
        matchedWorkEntries: [
          { years: 6, directRoleMatch: true, industryVerified: false },
        ],
      },
    ];
    expect(resolveGateRoleYears(cnUnverified, "engineer", {}, { market: "CN" })).toBe(0);
    expect(resolveGateRoleYears(cnUnverified, "engineer", {})).toBe(0);
  });

  it("relaxes to direct-role years for MY rows whose employer has no verdict yet", () => {
    // MY (SEEK) catalog is still thin — many employers are not yet reviewed.
    // When the matched work entry has no human-approved verdictRevisionId, the
    // unverified direct-role years may satisfy the gate.
    const myUnverified = [
      {
        type: "engineer",
        years: 8,
        roleRelevantYears: 8,
        industryVerifiedRelevantYears: 0,
        industryVerifiedYears: 0,
        matchedWorkEntries: [
          {
            years: 8,
            directRoleMatch: true,
            industryVerified: false,
            // no verdictRevisionId — employer never resolved to a reviewed profile
          },
        ],
      },
    ];
    expect(resolveGateRoleYears(myUnverified, "engineer", {}, { market: "MY" })).toBe(8);
  });

  it("does NOT relax MY rows whose employer carries a verdict", () => {
    // Once a human-approved revision exists (verified or rejected), the MY row
    // must stay strict verified-only — the relaxation only covers "no verdict
    // yet", not "industry said no".
    const myRejected = [
      {
        type: "engineer",
        years: 8,
        roleRelevantYears: 8,
        industryVerifiedRelevantYears: 0,
        industryVerifiedYears: 0,
        matchedWorkEntries: [
          {
            years: 8,
            directRoleMatch: true,
            industryVerified: false,
            verdictRevisionId: "rev-rejected-1",
          },
        ],
      },
    ];
    expect(resolveGateRoleYears(myRejected, "engineer", {}, { market: "MY" })).toBe(0);
  });

  it("prefers precomputed verifiedRoleYears over the MY relaxation", () => {
    const myVerified = [
      {
        type: "engineer",
        years: 8,
        roleRelevantYears: 8,
        industryVerifiedRelevantYears: 0,
        industryVerifiedYears: 0,
        matchedWorkEntries: [
          {
            years: 8,
            directRoleMatch: true,
            industryVerified: false,
            verdictRevisionId: "rev-x",
          },
        ],
      },
    ];
    expect(resolveGateRoleYears(myVerified, "engineer", { engineer: 3 }, { market: "MY" })).toBe(3);
  });
});
