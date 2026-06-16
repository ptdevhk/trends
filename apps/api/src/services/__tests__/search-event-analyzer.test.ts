import { describe, it, expect } from "vitest";
import { scoreFromBreakdown } from "../search-event-analyzer.js";

describe("scoreFromBreakdown", () => {
  const defaultWeights = {
    skillMatch: 15,
    roleMatch: 10,
    experienceMatch: 25,
    educationMatch: 15,
    locationMatch: 15,
    industryMatch: 10,
    brandRelevance: 10,
  };

  const perfectBreakdown = {
    skillMatch: 15,
    roleMatch: 10,
    experienceMatch: 25,
    educationMatch: 15,
    locationMatch: 15,
    industryMatch: 10,
    brandRelevance: 10,
  };

  it("returns 100 when breakdown matches current weights perfectly", () => {
    const result = scoreFromBreakdown(perfectBreakdown, defaultWeights, defaultWeights);
    expect(result).toBe(100);
  });

  it("returns 0 when all breakdown values are zero", () => {
    const zeroBreakdown = {
      skillMatch: 0,
      roleMatch: 0,
      experienceMatch: 0,
      educationMatch: 0,
      locationMatch: 0,
      industryMatch: 0,
      brandRelevance: 0,
    };
    const result = scoreFromBreakdown(zeroBreakdown, defaultWeights, defaultWeights);
    expect(result).toBe(0);
  });

  it("scales projected score with proposed weights", () => {
    // Use partial breakdown so result doesn't exceed clamp
    const partialBreakdown = {
      skillMatch: 7.5, // 50% of current weight
      roleMatch: 5, // 50% of current weight
      experienceMatch: 25,
      educationMatch: 15,
      locationMatch: 15,
      industryMatch: 10,
      brandRelevance: 10,
    };
    // Double skillMatch and roleMatch in proposed
    const proposedWeights = {
      skillMatch: 30,
      roleMatch: 20,
      experienceMatch: 25,
      educationMatch: 15,
      locationMatch: 15,
      industryMatch: 10,
      brandRelevance: 0,
    };
    const resultWithDefault = scoreFromBreakdown(partialBreakdown, defaultWeights, defaultWeights);
    const resultWithProposed = scoreFromBreakdown(partialBreakdown, defaultWeights, proposedWeights);
    expect(resultWithProposed).toBeGreaterThan(resultWithDefault);
  });

  it("skips categories with zero current weight", () => {
    const zeroSkillCurrent = { ...defaultWeights, skillMatch: 0 };
    const result = scoreFromBreakdown(perfectBreakdown, zeroSkillCurrent, defaultWeights);
    // skillMatch contributes nothing since current weight is 0
    expect(result).toBeLessThan(100);
  });

  it("clamps projected score to 100", () => {
    const oversizeBreakdown = {
      skillMatch: 50, // Much higher than weight
      roleMatch: 50,
      experienceMatch: 50,
      educationMatch: 50,
      locationMatch: 50,
      industryMatch: 50,
      brandRelevance: 50,
    };
    const result = scoreFromBreakdown(oversizeBreakdown, defaultWeights, defaultWeights);
    expect(result).toBe(100); // Clamped at 100
  });

  it("clamps projected score to 0 minimum", () => {
    const negativeBreakdown = {
      skillMatch: -100,
      roleMatch: -100,
      experienceMatch: -100,
      educationMatch: -100,
      locationMatch: -100,
      industryMatch: -100,
      brandRelevance: -100,
    };
    const result = scoreFromBreakdown(negativeBreakdown, defaultWeights, defaultWeights);
    expect(result).toBe(0);
  });

  it("handles missing brandRelevance in breakdown (defaults to 0)", () => {
    const noBrand = {
      skillMatch: 15,
      roleMatch: 10,
      experienceMatch: 25,
      educationMatch: 15,
      locationMatch: 15,
      industryMatch: 10,
      brandRelevance: 0,
    };
    const result = scoreFromBreakdown(noBrand, defaultWeights, defaultWeights);
    expect(result).toBe(90); // brandRelevance contributes 0, so 10% missing
  });

  it("handles missing roleMatch in breakdown (defaults to 0)", () => {
    const noRole = {
      skillMatch: 15,
      experienceMatch: 25,
      educationMatch: 15,
      locationMatch: 15,
      industryMatch: 10,
      brandRelevance: 10,
    };
    const result = scoreFromBreakdown(noRole, defaultWeights, defaultWeights);
    expect(result).toBe(90); // roleMatch defaults to 0, so 10% missing
  });

  it("computes partial score correctly", () => {
    const partialBreakdown = {
      skillMatch: 7.5, // 50% of weight
      roleMatch: 10,
      experienceMatch: 25,
      educationMatch: 15,
      locationMatch: 15,
      industryMatch: 10,
      brandRelevance: 10,
    };
    const result = scoreFromBreakdown(partialBreakdown, defaultWeights, defaultWeights);
    expect(result).toBeCloseTo(92.5, 0);
  });
});
