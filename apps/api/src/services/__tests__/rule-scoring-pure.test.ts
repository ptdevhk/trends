import { describe, it, expect } from "vitest";
import {
  mergeRuleWeights,
  parseRuleWeightsOverrides,
} from "../rule-scoring.js";

describe("mergeRuleWeights", () => {
  it("returns defaults when no overrides provided", () => {
    const result = mergeRuleWeights(undefined);
    expect(result.categoryWeights.skillMatch).toBe(15);
    expect(result.categoryWeights.brandRelevance).toBe(10);
    expect(result.roleContext.enabled).toBe(true);
  });

  it("returns defaults when overrides is empty object", () => {
    const result = mergeRuleWeights({});
    expect(result.categoryWeights.skillMatch).toBe(15);
  });

  it("merges category weight overrides", () => {
    const result = mergeRuleWeights({
      categoryWeights: { skillMatch: 25 },
    });
    expect(result.categoryWeights.skillMatch).toBe(25);
    // Other weights remain default
    expect(result.categoryWeights.roleMatch).toBe(10);
  });

  it("merges roleContext overrides", () => {
    const result = mergeRuleWeights({
      roleContext: { enabled: false },
    });
    expect(result.roleContext.enabled).toBe(false);
    expect(result.roleContext.capRatio).toBe(0.8); // unchanged
  });

  it("merges recommendationThresholds overrides", () => {
    const result = mergeRuleWeights({
      recommendationThresholds: { strongMatch: 90 },
    });
    expect(result.recommendationThresholds.strongMatch).toBe(90);
    expect(result.recommendationThresholds.match).toBe(70); // unchanged
  });

  it("merges brandContextWithTarget overrides", () => {
    const result = mergeRuleWeights({
      brandContextWithTarget: { employer: 15 },
    });
    expect(result.brandContextWithTarget.employer).toBe(15);
    expect(result.brandContextWithTarget.sales).toBe(9); // unchanged
  });

  it("merges multiple override categories at once", () => {
    const result = mergeRuleWeights({
      categoryWeights: { skillMatch: 30, roleMatch: 20 },
      recommendationThresholds: { potential: 40 },
    });
    expect(result.categoryWeights.skillMatch).toBe(30);
    expect(result.categoryWeights.roleMatch).toBe(20);
    expect(result.recommendationThresholds.potential).toBe(40);
  });
});

describe("parseRuleWeightsOverrides", () => {
  it("returns undefined for null input", () => {
    expect(parseRuleWeightsOverrides(null)).toBeUndefined();
  });

  it("returns undefined for string input", () => {
    expect(parseRuleWeightsOverrides("invalid")).toBeUndefined();
  });

  it("returns undefined for negative weight", () => {
    expect(parseRuleWeightsOverrides({
      categoryWeights: { skillMatch: -5 },
    })).toBeUndefined();
  });

  it("parses valid partial overrides", () => {
    const result = parseRuleWeightsOverrides({
      categoryWeights: { skillMatch: 25 },
    });
    expect(result).toBeDefined();
    expect(result!.categoryWeights?.skillMatch).toBe(25);
  });

  it("parses empty object as valid (partial schema)", () => {
    const result = parseRuleWeightsOverrides({});
    expect(result).toBeDefined();
  });

  it("parses roleContext with valid ratios", () => {
    const result = parseRuleWeightsOverrides({
      roleContext: { enabled: true, capRatio: 0.9 },
    });
    expect(result).toBeDefined();
    expect(result!.roleContext?.capRatio).toBe(0.9);
  });

  it("returns undefined for capRatio > 1", () => {
    expect(parseRuleWeightsOverrides({
      roleContext: { capRatio: 1.5 },
    })).toBeUndefined();
  });
});
