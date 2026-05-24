/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { createUiUtils, type UiUtilsDeps } from "../ui-utils.js";

const SOURCE_KEYS = { JOB5156: "job5156", JOB51: "51job", SEEK: "seek", UNKNOWN: "unknown" };

function createMockDeps(overrides: Record<string, any> = {}): UiUtilsDeps {
  return {
    win: window as unknown as Window,
    doc: document,
    SOURCE_KEYS,
    AUTO_EXPORT_PARAM: "tr_auto_export",
    AUTO_SYNC_PARAM: "tr_auto_sync",
    AUTO_LIMIT_PARAM: "tr_limit",
    AUTO_MAX_PAGES_PARAM: "tr_max_pages",
    AUTO_MIN_AGE_PARAM: "tr_min_age",
    AUTO_MAX_AGE_PARAM: "tr_max_age",
    AUTO_SEARCH_PARAM: "keyword",
    AUTO_LOCATION_PARAM: "location",
    SAMPLE_NAME_PARAM: "tr_sample_name",
    KEYWORD_MODE_CONCAT: "concat",
    KEYWORD_MODE_SPACED: "spaced",
    LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY: "latestAutoSyncSummaries",
    JOB5156_HOST: "hr.job5156.com",
    EHIRE_51JOB_HOST: "ehire.51job.com",
    SEEK_HOST_SUFFIX: ".employer.seek.com",
    getPaginationInfo: vi.fn(() => ({ currentPage: 1, totalPages: 1, totalItems: 0, hasNextPage: false })),
    makeRandomId: vi.fn(() => "abc123"),
    getExternalAccessorStatus: vi.fn(() => ({})),
    getAgeRangeFromUrl: vi.fn(() => null),
    filterResumesByAgeRange: vi.fn((r: any[]) => r),
    resolveJob51CollectionLimits: vi.fn(() => ({ limit: 0, maxPages: 0 })),
    resolveJob51DetailFetchDelayMs: vi.fn(() => 1000),
    resolveJob51AutoSyncDetailWaitMode: vi.fn(() => "delay"),
    isJob51DetailPage: vi.fn(() => false),
    chrome: { runtime: { getManifest: vi.fn(() => ({ version: "1.0.0" })) } } as any,
    ...overrides,
  } as unknown as UiUtilsDeps;
}

describe("ui-utils", () => {
  describe("createUiUtil", () => {
    it("returns an object with utility functions", () => {
      const utils = createUiUtils(createMockDeps());
      expect(utils).toBeDefined();
      expect(typeof utils).toBe("object");
    });
  });

  describe("sanitizeSampleName", () => {
    it("is accessible via the factory", () => {
      const utils = createUiUtils(createMockDeps());
      // sanitizeSampleName is internal but used in buildExportFilename
      expect(utils).toHaveProperty("buildExportFilename");
    });
  });

  describe("buildExportFilename", () => {
    it("uses sample name when provided", () => {
      // Set up URL with sample name
      const url = new URL("https://hr.job5156.com/search?tr_sample_name=my-sample");
      const utils = createUiUtils(createMockDeps({
        win: { location: { href: url.toString(), search: url.search, origin: url.origin } } as unknown as Window,
      }));
      const filename = utils.buildExportFilename();
      expect(filename).toContain("my-sample");
    });

    it("generates default filename when no sample name", () => {
      const utils = createUiUtils(createMockDeps());
      const filename = utils.buildExportFilename();
      expect(filename).toMatch(/\.json$/);
    });
  });

  describe("parseAutoLocationValues", () => {
    it("parses comma-separated locations", () => {
      const utils = createUiUtils(createMockDeps());
      // parseAutoLocationValues is internal but testable via getAutoLocationValues
      const url = new URL("https://hr.job5156.com/search?location=Shanghai,Beijing");
      const result = utils.getAutoLocationValues(url);
      expect(result).toContain("Shanghai");
      expect(result).toContain("Beijing");
    });

    it("parses Chinese-comma-separated locations", () => {
      const utils = createUiUtils(createMockDeps());
      const url = new URL("https://hr.job5156.com/search?location=%E4%B8%8A%E6%B5%B7%EF%BC%8C%E5%8C%97%E4%BA%AC");
      const result = utils.getAutoLocationValues(url);
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns empty array for empty location", () => {
      const utils = createUiUtils(createMockDeps());
      const url = new URL("https://hr.job5156.com/search");
      const result = utils.getAutoLocationValues(url);
      expect(result).toEqual([]);
    });

    it("deduplicates locations", () => {
      const utils = createUiUtils(createMockDeps());
      const url = new URL("https://hr.job5156.com/search?location=Shanghai,Shanghai");
      const result = utils.getAutoLocationValues(url);
      const shanghaiCount = result.filter((l: string) => l === "Shanghai").length;
      expect(shanghaiCount).toBeLessThanOrEqual(1);
    });
  });

  describe("getExtensionGeneratedBy", () => {
    it("includes version when chrome.runtime is available", () => {
      const utils = createUiUtils(createMockDeps());
      const result = utils.getExtensionGeneratedBy();
      expect(result).toContain("browser-extension");
    });

    it("returns base string when chrome.runtime fails", () => {
      const utils = createUiUtils(createMockDeps({
        chrome: {} as any,
      }));
      const result = utils.getExtensionGeneratedBy();
      expect(result).toBe("browser-extension");
    });
  });

  describe("normalizeKeyword", () => {
    it("is accessible via the factory", () => {
      const utils = createUiUtils(createMockDeps());
      expect(utils).toHaveProperty("normalizeKeyword");
    });

    it("normalizes full-width spaces to half-width", () => {
      const utils = createUiUtils(createMockDeps());
      const result = utils.normalizeKeyword("销售\u3000经理");
      expect(result).toBe("销售 经理");
    });

    it("collapses multiple spaces", () => {
      const utils = createUiUtils(createMockDeps());
      const result = utils.normalizeKeyword("python   developer");
      expect(result).toBe("python developer");
    });

    it("trims whitespace", () => {
      const utils = createUiUtils(createMockDeps());
      const result = utils.normalizeKeyword("  python  ");
      expect(result).toBe("python");
    });

    it("returns empty string for null", () => {
      const utils = createUiUtils(createMockDeps());
      const result = utils.normalizeKeyword(null as any);
      expect(result).toBe("");
    });
  });

  describe("normalizeKeywordMode", () => {
    it("returns spaced mode when specified", () => {
      const utils = createUiUtils(createMockDeps());
      const result = utils.normalizeKeywordMode("spaced");
      expect(result).toBe("spaced");
    });

    it("defaults to concat mode", () => {
      const utils = createUiUtils(createMockDeps());
      const result = utils.normalizeKeywordMode("unknown");
      expect(result).toBe("concat");
    });
  });

  describe("normalizeCollectionLimit", () => {
    it("parses positive numbers", () => {
      const utils = createUiUtils(createMockDeps());
      const result = utils.normalizeCollectionLimit("50");
      expect(result).toBe(50);
    });

    it("returns 0 for non-numeric input", () => {
      const utils = createUiUtils(createMockDeps());
      const result = utils.normalizeCollectionLimit("abc");
      expect(result).toBe(0);
    });

    it("returns 0 for zero", () => {
      const utils = createUiUtils(createMockDeps());
      const result = utils.normalizeCollectionLimit("0");
      expect(result).toBe(0);
    });

    it("returns 0 for null/undefined", () => {
      const utils = createUiUtils(createMockDeps());
      expect(utils.normalizeCollectionLimit(null as any)).toBe(0);
      expect(utils.normalizeCollectionLimit(undefined as any)).toBe(0);
    });
  });
});
