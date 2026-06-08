import { describe, expect, it } from "vitest";

import {
  computeVerifiedRoleYears,
  getRoleRelevantSignalYears,
  isSalesRequiredContext,
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
