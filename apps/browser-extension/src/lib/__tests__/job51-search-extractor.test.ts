// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

import { createJob51SearchExtractor } from "../job51-search-extractor";

function createMockDeps(overrides = {}) {
  return {
    getCurrentSourceKey: vi.fn(() => "job51"),
    SOURCE_KEYS: { JOB51: "job51", JOB5156: "job5156", SEEK: "seek" },
    apiSnapshot: {},
    normalizeJob51Text: (v: unknown) =>
      v == null ? "" : String(v).trim().replace(/\s+/g, " "),
    normalizeJob51MultilineText: (v: unknown) =>
      v == null ? "" : String(v).trim().replace(/\s+/g, " "),
    normalizeResumeText: (v: unknown) =>
      v == null ? "" : String(v).trim().replace(/\s+/g, " "),
    buildWorkHistoryRawParts: (parts: string[]) =>
      parts.filter(Boolean).join(" · "),
    EHIRE_51JOB_PROFILE_URL_PREFIX: "https://ehire.51job.com/resume/view?resumeId=",
    EHIRE_51JOB_HOST: "ehire.51job.com",
    JOB51_PAGE_COOLDOWN_MS: 1000,
    JOB51_DETAIL_FETCH_TIMEOUT_MS: 10000,
    JOB51_RATE_LIMIT_ERROR_MESSAGE: "51job rate limit reached",
    buildJob51DetailResumeFromPayload: vi.fn(() => []),
    filterCurrentResumesByAgeRange: vi.fn((r) => r),
    chrome: { runtime: { sendMessage: vi.fn() } },
    window: { location: { pathname: "/", href: "https://ehire.51job.com/" }, setTimeout: vi.fn(), clearTimeout: vi.fn() },
    fetch: vi.fn(),
    delay: vi.fn(),
    isElementVisible: vi.fn(() => true),
    activateElement: vi.fn(),
    findVueParentByName: vi.fn(() => null),
    ...overrides,
  };
}

import { vi } from "vitest";

describe("job51-search-extractor", () => {
  describe("normalizeJob51AuthContext", () => {
    it("returns null when no auth fields present", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const result = extractor.normalizeJob51AuthContext({}, {});
      expect(result).toBeNull();
    });

    it("extracts accesstoken from headers", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const result = extractor.normalizeJob51AuthContext(
        { accesstoken: "token123" },
        {},
      );
      expect(result).toEqual({ accesstoken: "token123" });
    });

    it("extracts accesstoken from request body", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const result = extractor.normalizeJob51AuthContext(
        {},
        { accessToken: "token-from-body" },
      );
      expect(result).toEqual({ accesstoken: "token-from-body" });
    });

    it("extracts guid from headers", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const result = extractor.normalizeJob51AuthContext({ guid: "g123" }, {});
      expect(result).toEqual({ guid: "g123" });
    });

    it("extracts multiple auth fields", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const result = extractor.normalizeJob51AuthContext(
        { accesstoken: "t", guid: "g", property: "p", sign: "s" },
        {},
      );
      expect(result).toEqual({
        accesstoken: "t",
        guid: "g",
        property: "p",
        sign: "s",
      });
    });

    it("ignores empty string auth values", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const result = extractor.normalizeJob51AuthContext(
        { accesstoken: "  ", guid: "" },
        {},
      );
      expect(result).toBeNull();
    });
  });

  describe("getJob51RawRows", () => {
    it("extracts rows from payload.data.list", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const payload = { data: { list: [{ id: 1 }, { id: 2 }] } };
      const result = extractor.getJob51RawRows(payload);
      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("extracts rows from payload.data.items", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const payload = { data: { items: [{ id: 1 }] } };
      const result = extractor.getJob51RawRows(payload);
      expect(result).toEqual([{ id: 1 }]);
    });

    it("extracts rows from payload.data.rows", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const payload = { data: { rows: [{ id: 3 }] } };
      const result = extractor.getJob51RawRows(payload);
      expect(result).toEqual([{ id: 3 }]);
    });

    it("extracts rows from payload.list directly", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const payload = { list: [{ id: 4 }] };
      const result = extractor.getJob51RawRows(payload);
      expect(result).toEqual([{ id: 4 }]);
    });

    it("returns null for non-array rows", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const result = extractor.getJob51RawRows({ data: { list: "not-array" } });
      expect(result).toBeNull();
    });

    it("returns null for null payload", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const result = extractor.getJob51RawRows(null);
      expect(result).toBeNull();
    });
  });

  describe("getJob51TotalFromPayload", () => {
    it("extracts total from payload.data.total", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const result = extractor.getJob51TotalFromPayload({
        data: { total: 100 },
      });
      expect(result).toBe(100);
    });

    it("extracts total from payload.total directly", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const result = extractor.getJob51TotalFromPayload({ total: 50 });
      expect(result).toBe(50);
    });

    it("returns null for non-number total", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const result = extractor.getJob51TotalFromPayload({ total: "abc" });
      expect(result).toBeNull();
    });

    it("returns null for negative total", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const result = extractor.getJob51TotalFromPayload({ total: -1 });
      expect(result).toBeNull();
    });
  });

  describe("isLikelyJob51ResumeRow", () => {
    it("returns false for null", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      expect(extractor.isLikelyJob51ResumeRow(null)).toBe(false);
    });

    it("returns false for non-object", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      expect(extractor.isLikelyJob51ResumeRow("string")).toBe(false);
    });

    it("returns true for row with identity and name", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const row = { resumeId: "123", name: "张三" };
      expect(extractor.isLikelyJob51ResumeRow(row)).toBe(true);
    });

    it("returns true for row with name and detail fields", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const row = { name: "张三", experience: "5年" };
      expect(extractor.isLikelyJob51ResumeRow(row)).toBe(true);
    });

    it("returns false for row with only identity", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const row = { resumeId: "123" };
      expect(extractor.isLikelyJob51ResumeRow(row)).toBe(false);
    });

    it("returns true for row with base_info identity and name", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      const row = {
        base_info: { accountid: "456", resume_name: "李四" },
      };
      expect(extractor.isLikelyJob51ResumeRow(row)).toBe(true);
    });
  });

  describe("isJob51RateLimitedErrorMessage", () => {
    it("detects rate limit in Chinese", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      expect(extractor.isJob51RateLimitedErrorMessage("搜索访问太快")).toBe(true);
      expect(
        extractor.isJob51RateLimitedErrorMessage("请60分钟后再试"),
      ).toBe(true);
      expect(
        extractor.isJob51RateLimitedErrorMessage("访问频率限制"),
      ).toBe(true);
    });

    it("detects rate limit in English", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      expect(extractor.isJob51RateLimitedErrorMessage("rate limit")).toBe(true);
      expect(extractor.isJob51RateLimitedErrorMessage("Rate Limit")).toBe(true);
    });

    it("returns false for non-rate-limit messages", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      expect(extractor.isJob51RateLimitedErrorMessage("success")).toBe(false);
      expect(extractor.isJob51RateLimitedErrorMessage("")).toBe(false);
    });
  });

  describe("isJob51RateLimitedPayload", () => {
    it("detects rate limit in payload error fields", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      expect(
        extractor.isJob51RateLimitedPayload({ error: "rate limit" }),
      ).toBe(true);
      expect(
        extractor.isJob51RateLimitedPayload({ message: "搜索访问太快" }),
      ).toBe(true);
      expect(
        extractor.isJob51RateLimitedPayload({ data: { msg: "频率限制" } }),
      ).toBe(true);
    });

    it("returns false for null payload", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      expect(extractor.isJob51RateLimitedPayload(null)).toBe(false);
    });

    it("returns false for non-rate-limited payload", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      expect(extractor.isJob51RateLimitedPayload({ error: "not found" })).toBe(
        false,
      );
    });
  });

  describe("isJob51DetailApiErrorPayload", () => {
    it("returns true for result=0", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      expect(extractor.isJob51DetailApiErrorPayload({ result: "0" })).toBe(true);
      expect(extractor.isJob51DetailApiErrorPayload({ result: 0 })).toBe(true);
    });

    it("returns true for error code with message", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      expect(
        extractor.isJob51DetailApiErrorPayload({ code: "500", msg: "error" }),
      ).toBe(true);
    });

    it("returns false for success code 200", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      expect(
        extractor.isJob51DetailApiErrorPayload({ code: "200", msg: "ok" }),
      ).toBe(false);
    });

    it("returns false for null payload", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      expect(extractor.isJob51DetailApiErrorPayload(null)).toBe(false);
    });
  });

  describe("normalizeAgeRequestValue", () => {
    it("returns number as-is when finite", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      expect(extractor.normalizeAgeRequestValue(25)).toBe(25);
    });

    it("parses string to number", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      expect(extractor.normalizeAgeRequestValue("30")).toBe(30);
    });

    it("returns null for empty string", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      expect(extractor.normalizeAgeRequestValue("")).toBeNull();
    });

    it("returns null for NaN string", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      expect(extractor.normalizeAgeRequestValue("abc")).toBeNull();
    });

    it("returns null for Infinity", () => {
      const extractor = createJob51SearchExtractor(createMockDeps());
      expect(extractor.normalizeAgeRequestValue(Infinity)).toBeNull();
    });
  });

  describe("ensureJob51PageAllowed", () => {
    it("does not throw when not rate-limited", () => {
      const extractor = createJob51SearchExtractor(
        createMockDeps({
          getCurrentSourceKey: vi.fn(() => "job5156"), // non-job51 source skips check
        }),
      );
      expect(() => extractor.ensureJob51PageAllowed()).not.toThrow();
    });

    it("throws when rate-limited page detected", () => {
      // Set up document.body with rate-limit text before creating the extractor
      const originalBodyText = document.body?.textContent;
      const div = document.createElement("div");
      div.textContent = "搜索访问太快请60分钟后再试";
      document.body?.appendChild(div);
      try {
        const extractor = createJob51SearchExtractor(
          createMockDeps({
            getCurrentSourceKey: vi.fn(() => "job51"),
          }),
        );
        expect(() => extractor.ensureJob51PageAllowed()).toThrow(
          "51job rate limit reached",
        );
      } finally {
        div.remove();
      }
    });
  });

  describe("hasJob51SearchSnapshot", () => {
    it("returns true when job51SearchRows has items", () => {
      const extractor = createJob51SearchExtractor(
        createMockDeps({
          apiSnapshot: { job51SearchRows: [{ id: 1 }] },
        }),
      );
      expect(extractor.hasJob51SearchSnapshot()).toBe(true);
    });

    it("returns true when job51Total is a number", () => {
      const extractor = createJob51SearchExtractor(
        createMockDeps({
          apiSnapshot: { job51SearchRows: [], job51Total: 100 },
        }),
      );
      expect(extractor.hasJob51SearchSnapshot()).toBe(true);
    });

    it("returns false when empty and no total", () => {
      const extractor = createJob51SearchExtractor(
        createMockDeps({
          apiSnapshot: { job51SearchRows: [] },
        }),
      );
      expect(extractor.hasJob51SearchSnapshot()).toBe(false);
    });
  });
});
