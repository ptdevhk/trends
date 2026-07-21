import { describe, expect, it } from "vitest";
import { evaluateResearchParity, nextGreenStreak } from "./parity.js";

describe("evaluateResearchParity", () => {
  const goldenOk = [{ companyKey: "pro-technic-machinery", signalCount: 2 }];

  it("passes when all locked rules hold", () => {
    const result = evaluateResearchParity({
      platformBreakdown: [
        { platform: "weibo", nativeCount: 10, shadowCount: 10 },
        { platform: "rss:hn", nativeCount: 8, shadowCount: 10 },
      ],
      goldenCompanies: goldenOk,
    });
    expect(result.green).toBe(true);
    expect(result.aggregateRatio).toBeGreaterThanOrEqual(0.8);
    expect(result.nativeNonEmpty).toBe(true);
    expect(result.goldenCompanyResults.every((g) => g.pass)).toBe(true);
    expect(result.platformBreakdown.every((p) => !p.zeroWithShadow)).toBe(true);
  });

  it("fails when aggregateRatio < 0.80", () => {
    const result = evaluateResearchParity({
      platformBreakdown: [{ platform: "weibo", nativeCount: 5, shadowCount: 10 }],
      goldenCompanies: goldenOk,
    });
    expect(result.green).toBe(false);
    expect(result.aggregateRatio).toBeLessThan(0.8);
    expect(result.reasons.some((r) => r.includes("aggregateRatio"))).toBe(true);
  });

  it("fails when an enabled platform has shadow but zero native", () => {
    const result = evaluateResearchParity({
      platformBreakdown: [
        { platform: "weibo", nativeCount: 20, shadowCount: 10 },
        { platform: "toutiao", nativeCount: 0, shadowCount: 5 },
      ],
      goldenCompanies: goldenOk,
    });
    expect(result.green).toBe(false);
    expect(result.platformBreakdown.find((p) => p.platform === "toutiao")?.zeroWithShadow).toBe(
      true,
    );
  });

  it("fails when golden company has zero signals", () => {
    const result = evaluateResearchParity({
      platformBreakdown: [{ platform: "weibo", nativeCount: 10, shadowCount: 10 }],
      goldenCompanies: [{ companyKey: "pro-technic-machinery", signalCount: 0 }],
    });
    expect(result.green).toBe(false);
    expect(result.goldenCompanyResults[0].pass).toBe(false);
  });

  it("fails when native is empty", () => {
    const result = evaluateResearchParity({
      platformBreakdown: [{ platform: "weibo", nativeCount: 0, shadowCount: 0 }],
      goldenCompanies: goldenOk,
      nativeTotal: 0,
    });
    expect(result.green).toBe(false);
    expect(result.nativeNonEmpty).toBe(false);
  });
});

describe("nextGreenStreak", () => {
  it("increments on green and resets on fail", () => {
    expect(nextGreenStreak(0, true)).toBe(1);
    expect(nextGreenStreak(2, true)).toBe(3);
    expect(nextGreenStreak(3, false)).toBe(0);
  });
});
