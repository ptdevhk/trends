import { describe, it, expect } from "vitest";
import {
  SELECTORS,
  AUTO_EXPORT_PARAM,
  AUTO_SYNC_PARAM,
  AUTO_LIMIT_PARAM,
  AUTO_MAX_PAGES_PARAM,
  AUTO_MIN_AGE_PARAM,
  AUTO_MAX_AGE_PARAM,
  AUTO_SEARCH_PARAM,
  AUTO_LOCATION_PARAM,
  AUTO_KEYWORD_MODE_PARAM,
  SAMPLE_NAME_PARAM,
  JOB5156_HOST,
  SEEK_HOST_SUFFIX,
  JOB5156_PROFILE_URL_PREFIX,
  SOURCE_KEYS,
  SEEK_PROFILE_TYPE,
  KEYWORD_MODE_CONCAT,
  KEYWORD_MODE_SPACED,
  JOB51_PAGE_COOLDOWN_MS,
  JOB51_RATE_LIMIT_ERROR_MESSAGE,
  API_CAPTURE_SOURCE,
  EXTERNAL_ACCESS_KEY,
  PAGE_BRIDGE_REQUEST_EVENT,
  PAGE_BRIDGE_RESPONSE_EVENT,
  PAGE_BRIDGE_REQUEST_ATTR,
  PAGE_BRIDGE_RESPONSE_ATTR,
  JOB51_NEXT_PAGE_EVENT,
  CONTENT_SCRIPT_SOURCE,
  JOB5156_DETAIL_FETCH_TIMEOUT_MS,
  JOB5156_DETAIL_FETCH_CONCURRENCY,
  JOB51_DETAIL_FETCH_TIMEOUT_MS,
  JOB51_DETAIL_FETCH_CONCURRENCY,
  DEFAULT_SEEK_PAGE_SIZE,
  LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY,
} from "../content-constants.js";

describe("content-constants", () => {
  describe("SELECTORS", () => {
    it("is a non-empty object", () => {
      expect(SELECTORS).toBeDefined();
      expect(Object.keys(SELECTORS).length).toBeGreaterThan(0);
    });

    it("has required CSS selector keys", () => {
      expect(SELECTORS).toHaveProperty("listContainer");
      expect(SELECTORS).toHaveProperty("resumeCard");
      expect(SELECTORS).toHaveProperty("pagination");
      expect(SELECTORS).toHaveProperty("nextPageBtn");
      expect(SELECTORS).toHaveProperty("searchInput");
    });

    it("all selector values are strings starting with CSS selectors", () => {
      for (const [key, value] of Object.entries(SELECTORS)) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    });

    it("has 51job-specific selectors", () => {
      expect(SELECTORS).toHaveProperty("job51SearchInput");
      expect(SELECTORS).toHaveProperty("job51SearchButton");
    });

    it("has seek-specific selectors", () => {
      expect(SELECTORS).toHaveProperty("seekPagination");
      expect(SELECTORS).toHaveProperty("seekTalentSearchPagination");
    });
  });

  describe("URL parameters", () => {
    it("exports auto-export parameter", () => {
      expect(AUTO_EXPORT_PARAM).toBe("tr_auto_export");
    });

    it("exports auto-sync parameter", () => {
      expect(AUTO_SYNC_PARAM).toBe("tr_auto_sync");
    });

    it("exports auto-limit parameter", () => {
      expect(AUTO_LIMIT_PARAM).toBe("tr_limit");
    });

    it("exports search keyword parameter", () => {
      expect(AUTO_SEARCH_PARAM).toBe("keyword");
    });

    it("exports location parameter", () => {
      expect(AUTO_LOCATION_PARAM).toBe("location");
    });

    it("exports keyword mode parameter", () => {
      expect(AUTO_KEYWORD_MODE_PARAM).toBe("tr_kw_mode");
    });
  });

  describe("source configuration", () => {
    it("SOURCE_KEYS has all three sources", () => {
      expect(SOURCE_KEYS.JOB5156).toBe("job5156");
      expect(SOURCE_KEYS.JOB51).toBe("51job");
      expect(SOURCE_KEYS.SEEK).toBe("seek");
      expect(SOURCE_KEYS.UNKNOWN).toBe("unknown");
    });

    it("SEEK_PROFILE_TYPE matches SOURCE_KEYS.SEEK", () => {
      expect(SEEK_PROFILE_TYPE).toBe(SOURCE_KEYS.SEEK);
    });
  });

  describe("host configuration", () => {
    it("JOB5156_HOST is correct", () => {
      expect(JOB5156_HOST).toBe("hr.job5156.com");
    });

    it("SEEK_HOST_SUFFIX is correct", () => {
      expect(SEEK_HOST_SUFFIX).toBe(".employer.seek.com");
    });

    it("JOB5156_PROFILE_URL_PREFIX includes host", () => {
      expect(JOB5156_PROFILE_URL_PREFIX).toContain(JOB5156_HOST);
      expect(JOB5156_PROFILE_URL_PREFIX).toMatch(/^https:\/\//);
    });
  });

  describe("timeout and concurrency constants", () => {
    it("has positive timeout values", () => {
      expect(JOB5156_DETAIL_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
      expect(JOB51_DETAIL_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it("has positive concurrency values", () => {
      expect(JOB5156_DETAIL_FETCH_CONCURRENCY).toBeGreaterThan(0);
      expect(JOB51_DETAIL_FETCH_CONCURRENCY).toBeGreaterThan(0);
    });

    it("51job has lower concurrency than job5156", () => {
      expect(JOB51_DETAIL_FETCH_CONCURRENCY).toBeLessThan(JOB5156_DETAIL_FETCH_CONCURRENCY);
    });

    it("has positive cooldown", () => {
      expect(JOB51_PAGE_COOLDOWN_MS).toBeGreaterThan(0);
    });
  });

  describe("event and bridge constants", () => {
    it("has matching request/response event names", () => {
      expect(PAGE_BRIDGE_REQUEST_EVENT).toContain("Request");
      expect(PAGE_BRIDGE_RESPONSE_EVENT).toContain("Response");
    });

    it("has matching request/response attribute names", () => {
      expect(PAGE_BRIDGE_REQUEST_ATTR).toContain("request");
      expect(PAGE_BRIDGE_RESPONSE_ATTR).toContain("response");
    });

    it("API_CAPTURE_SOURCE is a string", () => {
      expect(typeof API_CAPTURE_SOURCE).toBe("string");
    });

    it("EXTERNAL_ACCESS_KEY is a string", () => {
      expect(typeof EXTERNAL_ACCESS_KEY).toBe("string");
    });
  });

  describe("keyword modes", () => {
    it("exports concat and spaced modes", () => {
      expect(KEYWORD_MODE_CONCAT).toBe("concat");
      expect(KEYWORD_MODE_SPACED).toBe("spaced");
    });
  });

  describe("default page size", () => {
    it("DEFAULT_SEEK_PAGE_SIZE is positive", () => {
      expect(DEFAULT_SEEK_PAGE_SIZE).toBeGreaterThan(0);
    });
  });

  describe("rate limit error message", () => {
    it("contains Chinese text", () => {
      expect(JOB51_RATE_LIMIT_ERROR_MESSAGE).toMatch(/[\u4e00-\u9fff]/);
    });
  });
});
