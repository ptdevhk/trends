import { describe, expect, it } from "vitest";
import {
  isMyThDomainRelevantUnverifiedEntry,
  isProductionMachinistTitle,
} from "./my-th-unverified-hatch.js";
import {
  resolveIndustryDbWithMarketFloor,
  shouldSkipMarketIndustryDbFloor,
} from "./resume-score-semantics.js";

describe("isMyThDomainRelevantUnverifiedEntry", () => {
  it("flags unverified CNC service-engineer titles", () => {
    expect(isMyThDomainRelevantUnverifiedEntry({
      directRoleMatch: true,
      companyName: "Mysyntec Technology",
      jobTitle: "Technical Team Leader",
      matchedSignals: ["engineer", "cnc"],
    })).toBe(true);
  });

  it("flags machine-tool company names without a CNC token in the title", () => {
    expect(isMyThDomainRelevantUnverifiedEntry({
      directRoleMatch: true,
      companyName: "CK MAC (PENANG) SDN BHD",
      jobTitle: "Sales & Service Engineer",
      matchedSignals: ["engineer", "machine tools"],
    })).toBe(true);
  });

  it("rejects production machinist / operator titles", () => {
    expect(isProductionMachinistTitle("CNC Machinist")).toBe(true);
    expect(isMyThDomainRelevantUnverifiedEntry({
      directRoleMatch: true,
      companyName: "Airfoil Services",
      jobTitle: "CNC Milling Machinist",
      matchedSignals: ["cnc", "engineer"],
    })).toBe(false);
  });

  it("rejects retail / insurance / oil-gas employers", () => {
    expect(isMyThDomainRelevantUnverifiedEntry({
      directRoleMatch: true,
      companyName: "7 Eleven",
      jobTitle: "Retail Sales Associate",
      matchedSignals: ["engineer"],
    })).toBe(false);
    expect(isMyThDomainRelevantUnverifiedEntry({
      directRoleMatch: true,
      companyName: "TechnipFMC",
      jobTitle: "Service Project Manager",
      matchedSignals: ["engineer"],
    })).toBe(false);
  });

  it("flags a service manager when CNC appears in work-history evidence", () => {
    expect(isMyThDomainRelevantUnverifiedEntry({
      directRoleMatch: true,
      companyName: "Vintec enterprise",
      jobTitle: "Service Manager",
      matchedSignals: ["engineer"],
      extraText: "troubleshoot CNC machine breakdown, FANUC servo parameter",
    })).toBe(true);
  });

  it("does not deny a CNC service entry because a later retail job is in extraText", () => {
    expect(isMyThDomainRelevantUnverifiedEntry({
      directRoleMatch: true,
      companyName: "Mysyntec Technology",
      jobTitle: "Service Engineer",
      matchedSignals: ["engineer"],
      extraText: "earlier 7-Eleven cashier, later CNC service engineer at Mysyntec",
    })).toBe(true);
  });

  it("does not hatch customer-service titles just because CNC appears elsewhere", () => {
    expect(isMyThDomainRelevantUnverifiedEntry({
      directRoleMatch: true,
      companyName: "SATS GTRSG",
      jobTitle: "Customer Service Representative",
      matchedSignals: ["engineer"],
      extraText: "quoted CNC service engineer keywords from an older profile field",
    })).toBe(false);
  });

  it("flags tools-and-engineering employers from the company name", () => {
    expect(isMyThDomainRelevantUnverifiedEntry({
      directRoleMatch: true,
      companyName: "JET TOOLS & ENGINEERING SDN BHD",
      jobTitle: "Senior Technical Sales & Service Manager",
      matchedSignals: ["engineer"],
    })).toBe(true);
  });

  it("requires a direct role match", () => {
    expect(isMyThDomainRelevantUnverifiedEntry({
      directRoleMatch: false,
      companyName: "Fanuc Mechatronic Malaysia",
      jobTitle: "Service Engineer",
      matchedSignals: ["cnc"],
    })).toBe(false);
  });
});

describe("shouldSkipMarketIndustryDbFloor", () => {
  it("skips on LLM no_match", () => {
    expect(shouldSkipMarketIndustryDbFloor({ llmRecommendation: "no_match" })).toBe(true);
  });

  it("skips on coverage none", () => {
    expect(shouldSkipMarketIndustryDbFloor({ coverage: "none", llmRecommendation: "match" })).toBe(true);
  });

  it("keeps the floor for partial/full coverage matches", () => {
    expect(shouldSkipMarketIndustryDbFloor({ coverage: "partial", llmRecommendation: "match" })).toBe(false);
    expect(shouldSkipMarketIndustryDbFloor({ coverage: "full", llmRecommendation: "potential" })).toBe(false);
  });
});

describe("resolveIndustryDbWithMarketFloor", () => {
  it("keeps the MY floor for a matching resume with no hits", () => {
    expect(resolveIndustryDbWithMarketFloor("MY", 0, { llmRecommendation: "match", coverage: "partial" })).toBe(40);
  });

  it("withholds the MY floor when coverage is none", () => {
    expect(resolveIndustryDbWithMarketFloor("MY", 0, { llmRecommendation: "match", coverage: "none" })).toBe(0);
  });

  it("withholds the MY floor on LLM no_match", () => {
    expect(resolveIndustryDbWithMarketFloor("MY", 0, { llmRecommendation: "no_match" })).toBe(0);
  });

  it("drops brand/company hits when coverage is none", () => {
    expect(resolveIndustryDbWithMarketFloor("MY", 50, { llmRecommendation: "match", coverage: "none" })).toBe(0);
  });
});
