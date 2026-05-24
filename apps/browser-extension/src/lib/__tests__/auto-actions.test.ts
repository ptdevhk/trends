/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { createAutoActions } from "../auto-actions.js";

const SOURCE_KEYS = { JOB5156: "job5156", JOB51: "51job", SEEK: "seek", UNKNOWN: "unknown" };

function createMockDeps(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    activateElement: vi.fn(),
    fireMouseEvent: vi.fn(),
    setInputValue: vi.fn(),
    apiSnapshot: {},
    getCurrentSourceKey: vi.fn(() => SOURCE_KEYS.JOB5156),
    getCurrentAgeRange: vi.fn(() => ({ enabled: false })),
    SOURCE_KEYS,
    isElementVisible: vi.fn(() => true),
    resolveJob51AgeFilterDropdown: vi.fn(() => null),
    ensureJob51AgeCustomRangeInputs: vi.fn(),
    applyJob51AgeCustomRangeViaVue: vi.fn(),
    waitForJob51AgeFilterRefresh: vi.fn(),
    waitForExtractionData: vi.fn(),
    asHTMLElement: vi.fn((el: any) => el),
    SELECTORS: {},
    AUTO_LOCATION_PARAM: "location",
    AUTO_SEARCH_PARAM: "keyword",
    AUTO_KEYWORD_MODE_PARAM: "tr_kw_mode",
    KEYWORD_MODE_SPACED: "spaced",
    normalizeKeyword: vi.fn((k: string) => k.trim()),
    normalizeKeywordMode: vi.fn(() => "concat"),
    getKeywordMode: vi.fn(async () => "concat"),
    normalizeSeekLocationLabel: vi.fn((l: string) => l),
    hasJob51SearchSnapshot: vi.fn(() => false),
    isJob51EmptySearchPromptVisible: vi.fn(() => false),
    parseAutoLocationValues: vi.fn(() => []),
    extractResumes: vi.fn(() => []),
    extractResumesRaw: vi.fn(() => ({ url: "", extractedAt: "", count: 0, cards: [] })),
    isJob51DetailPage: vi.fn(() => false),
    isJob5156DetailPage: vi.fn(() => false),
    isSeekProfileMode: vi.fn(() => false),
    enrich51JobSearchResumesWithDetail: vi.fn(async (r: any[]) => r),
    enrichJob5156SearchResumesWithDetail: vi.fn(async (r: any[]) => r),
    enrichSeekResumesWithDetail: vi.fn(async (r: any[]) => r),
    buildSubmitMetadata: vi.fn(() => ({})),
    AUTO_EXPORT_PARAM: "tr_auto_export",
    AUTO_SYNC_PARAM: "tr_auto_sync",
    buildExportMetadata: vi.fn(() => ({})),
    buildExportFilename: vi.fn(() => "resumes.json"),
    doc: document,
    win: window as unknown as Window,
    chrome: { runtime: { sendMessage: vi.fn(), getManifest: vi.fn(() => ({ version: "1.0.0" })) } } as any,
    ...overrides,
  };
}

describe("auto-actions", () => {
  describe("parseAutoExportMode", () => {
    it("returns disabled for empty/undefined input", () => {
      const actions = createAutoActions(createMockDeps());
      expect(actions.parseAutoExportMode("")).toEqual({ enabled: false });
      expect(actions.parseAutoExportMode(undefined as any)).toEqual({ enabled: false });
    });

    it("enables markdown for boolean-like values", () => {
      const actions = createAutoActions(createMockDeps());
      const result = actions.parseAutoExportMode("1");
      expect(result.enabled).toBe(true);
      expect(result.downloadMarkdown).toBe(true);
    });

    it("enables console logging for 'console' mode", () => {
      const actions = createAutoActions(createMockDeps());
      const result = actions.parseAutoExportMode("console");
      expect(result.enabled).toBe(true);
      expect(result.logStructured).toBe(true);
    });

    it("enables CSV download for 'csv' mode", () => {
      const actions = createAutoActions(createMockDeps());
      const result = actions.parseAutoExportMode("csv");
      expect(result.enabled).toBe(true);
      expect(result.downloadCsv).toBe(true);
    });

    it("enables JSON download for 'json' mode", () => {
      const actions = createAutoActions(createMockDeps());
      const result = actions.parseAutoExportMode("json");
      expect(result.enabled).toBe(true);
      expect(result.downloadJson).toBe(true);
    });

    it("enables raw JSON download for 'raw_json' mode", () => {
      const actions = createAutoActions(createMockDeps());
      const result = actions.parseAutoExportMode("raw_json");
      expect(result.enabled).toBe(true);
      expect(result.downloadRawJson).toBe(true);
    });

    it("parses combined token modes", () => {
      const actions = createAutoActions(createMockDeps());
      const result = actions.parseAutoExportMode("md,rawjson,saveas");
      expect(result.enabled).toBe(true);
      expect(result.downloadMarkdown).toBe(true);
      expect(result.downloadRawJson).toBe(true);
      expect(result.saveAs).toBe(true);
    });

    it("defaults to markdown when no recognized tokens", () => {
      const actions = createAutoActions(createMockDeps());
      const result = actions.parseAutoExportMode("unknown");
      expect(result.enabled).toBe(true);
      expect(result.downloadMarkdown).toBe(true);
    });
  });

  describe("parseAutoSyncFlag", () => {
    it("returns true for truthy values", () => {
      const actions = createAutoActions(createMockDeps());
      expect(actions.parseAutoSyncFlag("1")).toBe(true);
      expect(actions.parseAutoSyncFlag("true")).toBe(true);
      expect(actions.parseAutoSyncFlag("yes")).toBe(true);
      expect(actions.parseAutoSyncFlag("on")).toBe(true);
    });

    it("returns false for other values", () => {
      const actions = createAutoActions(createMockDeps());
      expect(actions.parseAutoSyncFlag("0")).toBe(false);
      expect(actions.parseAutoSyncFlag("false")).toBe(false);
      expect(actions.parseAutoSyncFlag("")).toBe(false);
      expect(actions.parseAutoSyncFlag(undefined as any)).toBe(false);
    });
  });

  describe("normalizeCardText", () => {
    it("trims lines and removes empty ones", () => {
      const actions = createAutoActions(createMockDeps());
      expect(actions.normalizeCardText("  hello  \n\n  world  ")).toBe("hello\nworld");
    });

    it("returns empty string for null/undefined", () => {
      const actions = createAutoActions(createMockDeps());
      expect(actions.normalizeCardText(null as any)).toBe("");
      expect(actions.normalizeCardText(undefined as any)).toBe("");
    });
  });

  describe("resumesToCSV", () => {
    it("returns empty string for empty array", () => {
      const actions = createAutoActions(createMockDeps());
      expect(actions.resumesToCSV([])).toBe("");
    });

    it("generates CSV with headers and rows", () => {
      const actions = createAutoActions(createMockDeps());
      const csv = actions.resumesToCSV([
        { name: "Alice", age: 25, experience: "3年", education: "本科", location: "上海" },
      ]);
      expect(csv).toContain("序号");
      expect(csv).toContain("Alice");
      expect(csv.split("\n").length).toBe(2); // header + 1 row
    });

    it("escapes double quotes in cells", () => {
      const actions = createAutoActions(createMockDeps());
      const csv = actions.resumesToCSV([
        { name: 'He said "hello"' },
      ]);
      expect(csv).toContain('""hello""');
    });
  });

  describe("resolveAutoSyncErrorStatus", () => {
    it("detects 51job rate limit", () => {
      const actions = createAutoActions(createMockDeps());
      const result = actions.resolveAutoSyncErrorStatus("搜索访问太快，请60分钟后再试");
      expect(result.message).toContain("访问限制");
      expect(result.hint).toContain("60分钟");
    });

    it("detects missing token", () => {
      const actions = createAutoActions(createMockDeps());
      const result = actions.resolveAutoSyncErrorStatus("Server token not configured");
      expect(result.message).toContain("Token");
    });

    it("detects 401 unauthorized", () => {
      const actions = createAutoActions(createMockDeps());
      const result = actions.resolveAutoSyncErrorStatus({ error: "401 Unauthorized" });
      expect(result.message).toContain("认证失败");
    });

    it("detects network errors", () => {
      const actions = createAutoActions(createMockDeps());
      const result = actions.resolveAutoSyncErrorStatus("Failed to fetch");
      expect(result.message).toContain("无法连接");
    });

    it("returns generic error for unknown errors", () => {
      const actions = createAutoActions(createMockDeps());
      const result = actions.resolveAutoSyncErrorStatus("Something went wrong");
      expect(result.message).toContain("同步失败");
    });
  });

  describe("resolveAutoSyncStopReason", () => {
    it("returns job51-rate-limited for rate limit messages", () => {
      const actions = createAutoActions(createMockDeps());
      expect(actions.resolveAutoSyncStopReason("搜索访问太快")).toBe("job51-rate-limited");
      expect(actions.resolveAutoSyncStopReason("请60分钟后再试")).toBe("job51-rate-limited");
    });

    it("returns failed for other errors", () => {
      const actions = createAutoActions(createMockDeps());
      expect(actions.resolveAutoSyncStopReason("Network error")).toBe("failed");
    });
  });

  describe("getExtensionVersion", () => {
    it("returns version when chrome.runtime available", () => {
      vi.stubGlobal("chrome", { runtime: { getManifest: vi.fn(() => ({ version: "1.0.0" })) } });
      const actions = createAutoActions(createMockDeps());
      expect(actions.getExtensionVersion()).toBe("1.0.0");
      vi.unstubAllGlobals();
    });

    it("returns unknown when chrome.runtime fails", () => {
      vi.stubGlobal("chrome", {});
      const actions = createAutoActions(createMockDeps());
      expect(actions.getExtensionVersion()).toBe("unknown");
      vi.unstubAllGlobals();
    });
  });
});
