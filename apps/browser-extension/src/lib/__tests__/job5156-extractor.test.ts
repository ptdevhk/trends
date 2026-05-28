// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

import { createJob5156Extractor, type Job5156ExtractorDeps } from "../job5156-extractor";

function createMockDeps(overrides: Record<string, unknown> = {}): Job5156ExtractorDeps {
  return {
    getCurrentSourceKey: vi.fn(() => "job5156"),
    SOURCE_KEYS: { JOB51: "job51", JOB5156: "job5156", SEEK: "seek" },
    apiSnapshot: {},
    normalizeResumeText: (v: unknown) =>
      v == null ? "" : String(v).trim().replace(/\s+/g, " "),
    normalizeResumeMultilineText: (v: unknown) =>
      v == null ? "" : String(v).trim().replace(/\s+/g, " "),
    buildWorkHistoryRawParts: (parts: string[]) =>
      parts.filter(Boolean).join(" · "),
    normalizeOptionalPositiveInt: (v: unknown) => {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
      if (typeof v === "string") {
        const n = Number.parseInt(v, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
      return null;
    },
    JOB5156_HOST: "hr.job5156.com",
    JOB5156_PROFILE_URL_PREFIX: "https://hr.job5156.com/resume/view/",
    JOB5156_DETAIL_FETCH_TIMEOUT_MS: 10000,
    JOB5156_DETAIL_FETCH_CONCURRENCY: 3,
    DEFAULT_COLLECTION_GUARDS: {},
    GUARD_FIELD_NAMES: ["experience", "education"],
    GUARD_ARRAY_FIELD_NAMES: ["workHistory"],
    loadCollectionGuards: vi.fn(() => Promise.resolve(null)),
    parseGuardFieldNames: vi.fn(() => []),
    applyCollectionGuards: vi.fn((r) => r),
    isMeaningfulJob5156WorkHistoryEntry: vi.fn(() => true),
    collectJob5156SectionItemsByHeading: vi.fn(() => []),
    ...overrides,
  } as unknown as Job5156ExtractorDeps;
}

describe("job5156-extractor", () => {
  describe("extractJob5156ResumeId", () => {
    it("extracts resumeId from /api/com/resume/ path", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      expect(extractor.extractJob5156ResumeId("/api/com/resume/ABC123")).toBe(
        "ABC123",
      );
    });

    it("extracts resumeId from /resume/view/ path", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      expect(extractor.extractJob5156ResumeId("/resume/view/XYZ789")).toBe(
        "XYZ789",
      );
    });

    it("returns empty string for null/undefined", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      expect(extractor.extractJob5156ResumeId(null as unknown as string)).toBe("");
      expect(extractor.extractJob5156ResumeId(undefined as unknown as string)).toBe(
        "",
      );
    });

    it("returns empty string for non-matching path", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      expect(extractor.extractJob5156ResumeId("/other/path")).toBe("");
    });

    it("returns empty string for empty string", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      expect(extractor.extractJob5156ResumeId("")).toBe("");
    });

    it("handles URI-encoded resumeId", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      expect(
        extractor.extractJob5156ResumeId("/resume/view/%E4%B8%AD%E6%96%87"),
      ).toBe("中文");
    });
  });

  describe("normalizeJob5156ProfileUrlForExport", () => {
    it("normalizes /resume/view/ URL to prefix format", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      const result = extractor.normalizeJob5156ProfileUrlForExport(
        "https://hr.job5156.com/resume/view/ABC123",
      );
      expect(result).toBe(
        "https://hr.job5156.com/resume/view/ABC123",
      );
    });

    it("returns empty for empty input", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      expect(extractor.normalizeJob5156ProfileUrlForExport("")).toBe("");
    });

    it("returns empty for whitespace-only input", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      expect(extractor.normalizeJob5156ProfileUrlForExport("   ")).toBe("");
    });

    it("returns href as-is for non-matching hostname", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      const result = extractor.normalizeJob5156ProfileUrlForExport(
        "https://other.site.com/resume/123",
      );
      expect(result).toBe("https://other.site.com/resume/123");
    });
  });

  describe("normalizeJob5156ExtractOptions", () => {
    it("provides defaults for missing options", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      const result = extractor.normalizeJob5156ExtractOptions({});
      expect(typeof result.pathname).toBe("string");
      expect(typeof result.profileUrl).toBe("string");
      expect(typeof result.extractedAt).toBe("string");
      expect(result.pathname).toContain("/");
    });

    it("uses provided pathname", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      const result = extractor.normalizeJob5156ExtractOptions({
        pathname: "/resume/view/ABC",
      });
      expect(result.pathname).toBe("/resume/view/ABC");
    });

    it("uses provided profileUrl", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      const result = extractor.normalizeJob5156ExtractOptions({
        profileUrl: "https://example.com/profile",
      });
      expect(result.profileUrl).toBe("https://example.com/profile");
    });

    it("uses provided extractedAt", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      const result = extractor.normalizeJob5156ExtractOptions({
        extractedAt: "2026-01-01T00:00:00Z",
      });
      expect(result.extractedAt).toBe("2026-01-01T00:00:00Z");
    });
  });

  describe("parseJob5156BasicInfoItems", () => {
    it("parses 4+ items as age, experience, education, location", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      const result = extractor.parseJob5156BasicInfoItems([
        "30岁",
        "5年",
        "本科",
        "深圳",
      ]);
      expect(result.age).toBe("30岁");
      expect(result.experience).toBe("5年");
      expect(result.education).toBe("本科");
      expect(result.location).toBe("深圳");
    });

    it("infers fields from content when less than 4 items", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      const result = extractor.parseJob5156BasicInfoItems([
        "30岁",
        "本科",
        "深圳",
      ]);
      expect(result.age).toBe("30岁");
      expect(result.education).toBe("本科");
    });

    it("uses locationOverride when provided", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      const result = extractor.parseJob5156BasicInfoItems(
        ["30岁", "5年", "本科", "广州"],
        "深圳",
      );
      expect(result.location).toBe("深圳");
    });

    it("handles empty items array", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      const result = extractor.parseJob5156BasicInfoItems([]);
      expect(result.age).toBe("");
      expect(result.experience).toBe("");
    });

    it("correctly parses 5-item basicInfo with gender prefix", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      const result = extractor.parseJob5156BasicInfoItems([
        "男",
        "30岁",
        "5年工作经验",
        "本科",
        "上海",
      ]);
      expect(result.age).toBe("30岁");
      expect(result.experience).toBe("5年工作经验");
      expect(result.education).toBe("本科");
      expect(result.location).toBe("上海");
    });
  });

  describe("isJob5156DetailPage", () => {
    it("returns true for job5156 source on /resume/view/ path", () => {
      // jsdom defaults to "http://localhost/" — we need to set pathname
      const originalHref = window.location.href;
      // Using history.pushState to set the path
      window.history.pushState({}, "", "/resume/view/ABC123");
      try {
        const extractor = createJob5156Extractor(createMockDeps());
        expect(extractor.isJob5156DetailPage()).toBe(true);
      } finally {
        window.history.pushState({}, "", "/");
      }
    });

    it("returns false for non-job5156 source", () => {
      const extractor = createJob5156Extractor(
        createMockDeps({
          getCurrentSourceKey: vi.fn(() => "job51"),
        }),
      );
      expect(extractor.isJob5156DetailPage()).toBe(false);
    });
  });

  describe("buildJob5156DetailWorkHistoryItemFromApi", () => {
    it("builds work history from API item", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      const result = extractor.buildJob5156DetailWorkHistoryItemFromApi({
        begin: "2020-01",
        end: "2023-06",
        comName: "Test Corp",
        jobNameStr: "Developer",
      });
      expect(result).not.toBeNull();
      expect(result!.companyName).toBe("Test Corp");
      expect(result!.jobTitle).toBe("Developer");
      expect(result!.startDate).toBe("2020-01");
      expect(result!.endDate).toBe("2023-06");
    });

    it("returns null for null input", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      expect(
        extractor.buildJob5156DetailWorkHistoryItemFromApi(null),
      ).toBeNull();
    });

    it("returns null for empty object", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      expect(
        extractor.buildJob5156DetailWorkHistoryItemFromApi({}),
      ).toBeNull();
    });
  });

  describe("buildJob5156EducationItemFromApi", () => {
    it("builds education item from API data", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      const result = extractor.buildJob5156EducationItemFromApi({
        schoolName: "Test University",
        degreeStr: "Bachelor",
        speciality: "Computer Science",
        begin: "2016",
        end: "2020",
      });
      expect(result).not.toBeNull();
      expect(result!.institution).toBe("Test University");
      expect(result!.qualification).toContain("Bachelor");
    });

    it("returns null for null input", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      expect(
        extractor.buildJob5156EducationItemFromApi(null),
      ).toBeNull();
    });

    it("returns null for empty object", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      expect(
        extractor.buildJob5156EducationItemFromApi({}),
      ).toBeNull();
    });
  });

  describe("buildJob5156DetailResumeFromApiPayload", () => {
    it("returns empty array for null payload", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      expect(extractor.buildJob5156DetailResumeFromApiPayload(null)).toEqual([]);
    });

    it("returns empty array for non-object payload", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      expect(
        extractor.buildJob5156DetailResumeFromApiPayload("string"),
      ).toEqual([]);
    });

    it("returns empty array when resumeId is missing", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      const payload = {
        resumeViewVo: {
          cnVo: { basicInfoVo: { userName: "Test" } },
        },
      };
      expect(
        extractor.buildJob5156DetailResumeFromApiPayload(payload),
      ).toEqual([]);
    });

    it("returns empty array when cnVo is missing", () => {
      const extractor = createJob5156Extractor(createMockDeps());
      const payload = {
        resumeViewVo: {},
      };
      expect(
        extractor.buildJob5156DetailResumeFromApiPayload(payload, {
          pathname: "/api/com/resume/123",
        }),
      ).toEqual([]);
    });
  });
});
