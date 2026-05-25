import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db.js so constructor doesn't try to find project root
vi.mock("../db.js", () => ({
  findProjectRoot: () => "/tmp/trends-test",
}));

import { SearchProfileService, matchSearchProfilesByKeywords } from "../search-profile-service.js";
import type { SearchProfile } from "../search-profile-service.js";

function makeProfile(overrides: Partial<SearchProfile> = {}): SearchProfile {
  return {
    id: "test-profile",
    name: "Test Profile",
    status: "active",
    location: "东莞",
    keywords: ["CNC", "数控", "加工中心"],
    ...overrides,
  };
}

describe("SearchProfileService", () => {
  let service: SearchProfileService;

  beforeEach(() => {
    service = new SearchProfileService("/tmp/trends-test");
  });

  describe("normalizeProfileIdentifier", () => {
    it("lowercases and slugifies id", () => {
      expect(service.normalizeProfileIdentifier("CNC 操作员")).toBe("cnc");
    });

    it("replaces spaces and underscores with hyphens", () => {
      expect(service.normalizeProfileIdentifier("my_test profile")).toBe("my-test-profile");
    });

    it("removes non-alphanumeric characters", () => {
      expect(service.normalizeProfileIdentifier("profile@#$%123")).toBe("profile-123");
    });

    it("collapses multiple hyphens", () => {
      expect(service.normalizeProfileIdentifier("a---b")).toBe("a-b");
    });

    it("trims leading/trailing hyphens", () => {
      expect(service.normalizeProfileIdentifier("-test-")).toBe("test");
    });

    it("returns 'profile' for empty input", () => {
      expect(service.normalizeProfileIdentifier("")).toBe("profile");
      expect(service.normalizeProfileIdentifier("   ")).toBe("profile");
    });

    it("handles pure CJK input", () => {
      expect(service.normalizeProfileIdentifier("数控车床")).toBe("profile");
    });
  });

  describe("normalizeProfileInput", () => {
    it("coerces a complete profile object", () => {
      const input = {
        id: "cnc-ops",
        name: "CNC Operators",
        status: "active",
        location: "东莞",
        keywords: ["CNC", "数控"],
      };
      const result = service.normalizeProfileInput(input);
      expect(result.id).toBe("cnc-ops");
      expect(result.name).toBe("CNC Operators");
      expect(result.status).toBe("active");
      expect(result.location).toBe("东莞");
      expect(result.keywords.length).toBeGreaterThan(0);
    });

    it("uses fallback values for missing fields", () => {
      const fallback = makeProfile({ id: "fallback-id", name: "Fallback Name" });
      const input = { keywords: ["test"] };
      const result = service.normalizeProfileInput(input, fallback);
      expect(result.id).toBe("fallback-id");
      expect(result.name).toBe("Fallback Name");
    });

    it("defaults status to active when invalid", () => {
      const input = { id: "test", name: "Test", keywords: ["k1"], status: "invalid" };
      const result = service.normalizeProfileInput(input);
      expect(result.status).toBe("active");
    });

    it("accepts paused status", () => {
      const input = { id: "test", name: "Test", keywords: ["k1"], status: "paused" };
      const result = service.normalizeProfileInput(input);
      expect(result.status).toBe("paused");
    });

    it("accepts archived status", () => {
      const input = { id: "test", name: "Test", keywords: ["k1"], status: "archived" };
      const result = service.normalizeProfileInput(input);
      expect(result.status).toBe("archived");
    });

    it("normalizes keywords", () => {
      const input = { id: "test", name: "Test", keywords: ["  CNC  ", "数控 ", "  加工  "] };
      const result = service.normalizeProfileInput(input);
      expect(result.keywords).toContain("CNC");
    });

    it("parses filters", () => {
      const input = {
        id: "test",
        name: "Test",
        keywords: ["k1"],
        filters: {
          minExperience: 3,
          maxExperience: 10,
          education: ["本科"],
          locations: ["东莞", "深圳"],
        },
      };
      const result = service.normalizeProfileInput(input);
      expect(result.filters).toBeDefined();
      expect(result.filters!.minExperience).toBe(3);
      expect(result.filters!.education).toEqual(["本科"]);
    });

    it("parses schedule", () => {
      const input = {
        id: "test",
        name: "Test",
        keywords: ["k1"],
        schedule: {
          enabled: true,
          cron: "0 9 * * *",
          timezone: "Asia/Shanghai",
        },
      };
      const result = service.normalizeProfileInput(input);
      expect(result.schedule).toBeDefined();
      expect(result.schedule!.enabled).toBe(true);
      expect(result.schedule!.cron).toBe("0 9 * * *");
    });

    it("parses sources", () => {
      const input = {
        id: "test",
        name: "Test",
        keywords: ["k1"],
        sources: [
          { type: "seek", enabled: true, mode: "recommended", jobUrl: "https://employer.seek.com/candidates/recommended" },
        ],
      };
      const result = service.normalizeProfileInput(input);
      expect(result.sources).toBeDefined();
      expect(result.sources!.length).toBe(1);
      expect(result.sources![0].type).toBe("seek");
    });

    it("parses quickStart", () => {
      const input = {
        id: "test",
        name: "Test",
        keywords: ["k1"],
        quickStart: { enabled: true, label: "快速开始", rank: 1 },
      };
      const result = service.normalizeProfileInput(input);
      expect(result.quickStart).toBeDefined();
      expect(result.quickStart!.enabled).toBe(true);
      expect(result.quickStart!.label).toBe("快速开始");
    });

    it("parses notifications", () => {
      const input = {
        id: "test",
        name: "Test",
        keywords: ["k1"],
        notifications: {
          enabled: true,
          channels: [{ type: "feishu", enabled: true, webhook: "https://hook.example.com" }],
        },
      };
      const result = service.normalizeProfileInput(input);
      expect(result.notifications).toBeDefined();
      expect(result.notifications!.enabled).toBe(true);
      expect(result.notifications!.channels!.length).toBe(1);
    });

    it("parses ai config", () => {
      const input = {
        id: "test",
        name: "Test",
        keywords: ["k1"],
        ai: {
          pipeline: [{ stage: "screen", model: "gpt-4", threshold: 70 }],
          generateOutreach: true,
        },
      };
      const result = service.normalizeProfileInput(input);
      expect(result.ai).toBeDefined();
      expect(result.ai!.pipeline!.length).toBe(1);
      expect(result.ai!.generateOutreach).toBe(true);
    });

    it("parses session config", () => {
      const input = {
        id: "test",
        name: "Test",
        keywords: ["k1"],
        session: {
          scope: "workspace",
          retention: { mode: "archive", archiveAfterDays: 30 },
        },
      };
      const result = service.normalizeProfileInput(input);
      expect(result.session).toBeDefined();
      expect(result.session!.scope).toBe("workspace");
      expect(result.session!.retention!.archiveAfterDays).toBe(30);
    });

    it("handles non-object input gracefully", () => {
      const result = service.normalizeProfileInput("not an object");
      expect(result.id).toBeDefined();
      expect(result.name).toBeDefined();
    });

    it("clears location with empty string", () => {
      const fallback = makeProfile({ location: "东莞" });
      const input = { location: "" };
      const result = service.normalizeProfileInput(input, fallback);
      expect(result.location).toBe("");
    });

    it("parses salary range", () => {
      const input = {
        id: "test",
        name: "Test",
        keywords: ["k1"],
        filters: {
          salaryRange: { min: 8000, max: 15000, currency: "CNY", period: "monthly" },
        },
      };
      const result = service.normalizeProfileInput(input);
      expect(result.filters!.salaryRange).toBeDefined();
      expect(result.filters!.salaryRange!.min).toBe(8000);
      expect(result.filters!.salaryRange!.currency).toBe("CNY");
    });

    it("handles string boolean values", () => {
      const input = {
        id: "test",
        name: "Test",
        keywords: ["k1"],
        schedule: { enabled: "true", notifyOnlyOnNew: "false" },
      };
      const result = service.normalizeProfileInput(input);
      expect(result.schedule!.enabled).toBe(true);
      expect(result.schedule!.notifyOnlyOnNew).toBe(false);
    });

    it("handles string number values", () => {
      const input = {
        id: "test",
        name: "Test",
        keywords: ["k1"],
        filters: { minExperience: "5", maxExperience: "10" },
      };
      const result = service.normalizeProfileInput(input);
      expect(result.filters!.minExperience).toBe(5);
      expect(result.filters!.maxExperience).toBe(10);
    });

    it("returns undefined for empty filter objects", () => {
      const input = { id: "test", name: "Test", keywords: ["k1"], filters: {} };
      const result = service.normalizeProfileInput(input);
      expect(result.filters).toBeUndefined();
    });

    it("preserves maxExperience null", () => {
      const input = {
        id: "test",
        name: "Test",
        keywords: ["k1"],
        filters: { minExperience: 3, maxExperience: null },
      };
      const result = service.normalizeProfileInput(input);
      expect(result.filters!.maxExperience).toBeNull();
    });
  });

  describe("validateProfile", () => {
    it("passes for valid profile", () => {
      const profile = makeProfile();
      expect(() => service.validateProfile(profile)).not.toThrow();
    });

    it("throws when id is missing", () => {
      const profile = makeProfile({ id: "" });
      expect(() => service.validateProfile(profile)).toThrow("Profile id is required");
    });

    it("throws when name is missing", () => {
      const profile = makeProfile({ name: "" });
      expect(() => service.validateProfile(profile)).toThrow("Profile name is required");
    });

    it("throws when keywords is empty", () => {
      const profile = makeProfile({ keywords: [] });
      expect(() => service.validateProfile(profile)).toThrow("at least one value");
    });

    it("throws when keywords is not an array", () => {
      const profile = makeProfile({ keywords: "not-array" as unknown as string[] });
      expect(() => service.validateProfile(profile)).toThrow("at least one value");
    });

    it("validates Seek source with correct recommended URL", () => {
      const profile = makeProfile({
        sources: [
          {
            type: "seek",
            enabled: true,
            mode: "recommended",
            jobUrl: "https://au.employer.seek.com/candidates/recommended",
          },
        ],
      });
      expect(() => service.validateProfile(profile)).not.toThrow();
    });

    it("validates Seek source with correct talentsearch URL", () => {
      const profile = makeProfile({
        sources: [
          {
            type: "seek",
            enabled: true,
            mode: "talentsearch",
            jobUrl: "https://au.employer.seek.com/talentsearch?keywords=CNC",
          },
        ],
      });
      expect(() => service.validateProfile(profile)).not.toThrow();
    });

    it("throws for Seek source with mismatched URL mode", () => {
      const profile = makeProfile({
        sources: [
          {
            type: "seek",
            enabled: true,
            mode: "recommended",
            jobUrl: "https://employer.seek.com/talentsearch?keywords=CNC",
          },
        ],
      });
      expect(() => service.validateProfile(profile)).toThrow("valid Seek");
    });

    it("throws for Seek source with invalid URL", () => {
      const profile = makeProfile({
        sources: [
          { type: "seek", enabled: true, mode: "recommended", jobUrl: "https://example.com" },
        ],
      });
      expect(() => service.validateProfile(profile)).toThrow("valid Seek");
    });

    it("skips disabled Seek sources", () => {
      const profile = makeProfile({
        sources: [
          { type: "seek", enabled: false, mode: "recommended", jobUrl: "https://example.com" },
        ],
      });
      expect(() => service.validateProfile(profile)).not.toThrow();
    });

    it("skips non-Seek sources", () => {
      const profile = makeProfile({
        sources: [
          { type: "job51", enabled: true, jobUrl: "https://example.com" },
        ],
      });
      expect(() => service.validateProfile(profile)).not.toThrow();
    });
  });
});

describe("matchSearchProfilesByKeywords", () => {
  it("returns empty result for empty keywords", () => {
    const result = matchSearchProfilesByKeywords([makeProfile()], []);
    expect(result.confidence).toBe(0);
    expect(result.matchedKeywords).toEqual([]);
  });

  it("matches keywords against active profiles", () => {
    const profile = makeProfile({ keywords: ["CNC", "数控", "加工中心"] });
    const result = matchSearchProfilesByKeywords([profile], ["CNC"]);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.matchedKeywords.length).toBeGreaterThan(0);
  });

  it("skips non-active profiles", () => {
    const paused = makeProfile({ status: "paused", keywords: ["CNC"] });
    const archived = makeProfile({ status: "archived", keywords: ["CNC"] });
    const result = matchSearchProfilesByKeywords([paused, archived], ["CNC"]);
    expect(result.confidence).toBe(0);
  });

  it("returns best match when multiple profiles match", () => {
    const weak = makeProfile({ id: "weak", keywords: ["CNC"] });
    const strong = makeProfile({ id: "strong", keywords: ["CNC", "数控", "加工中心"] });
    const result = matchSearchProfilesByKeywords([weak, strong], ["CNC", "数控", "加工中心"]);
    expect(result.profile?.id).toBe("strong");
  });

  it("adds location bonus for matching location", () => {
    const profileWithLocation = makeProfile({ keywords: ["CNC", "数控", "加工"], location: "东莞" });
    const profileWithoutLocation = makeProfile({ id: "no-loc", keywords: ["CNC", "数控", "加工"], location: "" });

    const withLoc = matchSearchProfilesByKeywords([profileWithLocation], ["CNC"], "东莞");
    const withoutLoc = matchSearchProfilesByKeywords([profileWithoutLocation], ["CNC"], "东莞");

    // Both should match, but withLoc has higher or equal confidence due to location bonus
    // (capped at 1.0 so could be equal)
    expect(withLoc.confidence).toBeGreaterThanOrEqual(withoutLoc.confidence);
  });

  it("does not match when confidence below threshold", () => {
    const profile = makeProfile({ keywords: ["java", "python", "react"] });
    const result = matchSearchProfilesByKeywords([profile], ["CNC"]);
    expect(result.profile).toBeUndefined();
    expect(result.confidence).toBe(0);
  });

  it("returns profile metadata with match", () => {
    const profile = makeProfile({
      keywords: ["CNC"],
      jobDescription: "jd_001",
      filterPreset: "cnc-filter",
    });
    const result = matchSearchProfilesByKeywords([profile], ["CNC"]);
    expect(result.jobDescription).toBe("jd_001");
    expect(result.filterPreset).toBe("cnc-filter");
  });

  it("caps confidence at 1.0", () => {
    const profile = makeProfile({ keywords: ["CNC"] });
    const result = matchSearchProfilesByKeywords([profile], ["CNC"], "东莞");
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
