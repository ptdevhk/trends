// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

import { createSeekExtractor, type SeekExtractorDeps } from "../seek-extractor";

function createMockDeps(overrides: Record<string, unknown> = {}): SeekExtractorDeps {
  return {
    getCurrentSourceKey: vi.fn(() => "seek"),
    SOURCE_KEYS: { JOB51: "job51", JOB5156: "job5156", SEEK: "seek" },
    apiSnapshot: {
      seekRecommendedCandidates: [],
      seekTalentSearch: [],
      seekProfile: null,
      seekRecommendedRequest: null,
      seekTalentSearchRequest: null,
      seekProfileRequest: null,
    },
    normalizeOptionalPositiveInt: (v: unknown) => {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
      if (typeof v === "string") {
        const n = Number.parseInt(v, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
      return null;
    },
    DEFAULT_SEEK_PAGE_SIZE: 20,
    SEEK_PROFILE_TYPE: "seek",
    persistLatestAutoSyncSummary: vi.fn(),
    win: {
      location: {
        pathname: "/candidates/recommended",
        href: "https://www.seek.com/candidates/recommended",
        hostname: "www.seek.com",
        search: "",
      },
    },
    doc: { querySelectorAll: vi.fn(() => []), querySelector: vi.fn(() => null) },
    asHTMLElement: (el: unknown) => el as HTMLElement | null,
    isDisabledPaginationControl: vi.fn(() => false),
    waitForSeekProfileSnapshot: vi.fn(),
    SELECTORS: { seekPagination: ".seek-pagination", seekTalentSearchPagination: ".seek-ts-pagination" },
    ...overrides,
  } as unknown as SeekExtractorDeps;
}

describe("seek-extractor", () => {
  describe("normalizeSeekLocationLabel", () => {
    it("removes Malaysia and MY", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.normalizeSeekLocationLabel("Kuala Lumpur, Malaysia")).toBe(
        "kuala lumpur",
      );
      expect(extractor.normalizeSeekLocationLabel("Penang MY")).toBe("penang");
    });

    it("replaces Chinese punctuation with spaces", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(
        extractor.normalizeSeekLocationLabel("吉隆坡、槟城、柔佛"),
      ).toBe("吉隆坡 槟城 柔佛");
    });

    it("collapses multiple spaces", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.normalizeSeekLocationLabel("  a   b  ")).toBe("a b");
    });

    it("returns empty for empty input", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.normalizeSeekLocationLabel("")).toBe("");
      expect(extractor.normalizeSeekLocationLabel(null)).toBe("");
    });

    it("converts to lowercase", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.normalizeSeekLocationLabel("KUALA LUMPUR")).toBe(
        "kuala lumpur",
      );
    });
  });

  describe("getSeekCandidateIdentity", () => {
    it("extracts profileId and profileType from candidate", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.getSeekCandidateIdentity({
        profileId: "12345",
        profileType: "seek",
      });
      expect(result).toEqual({ profileId: "12345", profileType: "seek" });
    });

    it("defaults profileType to SEEK_PROFILE_TYPE", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.getSeekCandidateIdentity({ profileId: "123" });
      expect(result.profileType).toBe("seek");
    });

    it("converts profileId to string", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.getSeekCandidateIdentity({ profileId: 123 });
      expect(result.profileId).toBe("123");
    });

    it("returns empty profileId for null candidate", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.getSeekCandidateIdentity(null);
      expect(result.profileId).toBe("");
    });
  });

  describe("buildSeekProfileUrl", () => {
    it("builds URL with jobId when provided", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const url = extractor.buildSeekProfileUrl("12345", "678");
      expect(url).toContain("openProfileId=12345");
      expect(url).toContain("jobId=678");
    });

    it("builds URL without jobId", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const url = extractor.buildSeekProfileUrl("12345", undefined);
      expect(url).toContain("/candidates/12345");
      expect(url).not.toContain("jobId");
    });

    it("returns empty string for empty profileId", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.buildSeekProfileUrl("", undefined)).toBe("");
      expect(extractor.buildSeekProfileUrl(null as unknown as string, undefined)).toBe("");
    });
  });

  describe("buildSeekNameSearchUrl", () => {
    it("builds search URL with name and market", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const url = extractor.buildSeekNameSearchUrl("John Doe", "MY", undefined);
      expect(url).toContain("searchQuery=John%20Doe");
      expect(url).toContain("market=MY");
      expect(url).toContain("pageNumber=1");
    });

    it("includes roleTitles when provided", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const url = extractor.buildSeekNameSearchUrl(
        "John",
        "MY",
        "Software Engineer",
      );
      expect(url).toContain("roleTitles=Software%20Engineer");
    });

    it("returns empty string for empty name", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.buildSeekNameSearchUrl("", "MY", undefined)).toBe("");
      expect(extractor.buildSeekNameSearchUrl("  ", "MY", undefined)).toBe("");
    });
  });

  describe("resolveSeekAutoSyncPageWindow", () => {
    it("returns start page 1 by default", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.resolveSeekAutoSyncPageWindow({});
      expect(result.startPage).toBe(1);
    });

    it("calculates targetPageEnd from limit and page size", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.resolveSeekAutoSyncPageWindow({
        startPage: 1,
        limit: 60,
        requestedPageSize: 20,
      });
      expect(result.limitPageCount).toBe(3);
      expect(result.targetPageEnd).toBe(3);
    });

    it("respects maxPages when smaller than limitPageCount", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.resolveSeekAutoSyncPageWindow({
        startPage: 1,
        limit: 100,
        maxPages: 2,
        requestedPageSize: 20,
      });
      expect(result.allowedPageCount).toBe(2);
      expect(result.targetPageEnd).toBe(2);
    });

    it("returns null targetPageEnd when no limit or maxPages", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.resolveSeekAutoSyncPageWindow({
        startPage: 1,
      });
      expect(result.targetPageEnd).toBeNull();
    });
  });

  describe("isSeekAutoSyncPageWindowReached", () => {
    it("returns true when currentPage >= targetPageEnd", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(
        extractor.isSeekAutoSyncPageWindowReached(
          { startPage: 1, targetPageEnd: 3 },
          3,
        ),
      ).toBe(true);
      expect(
        extractor.isSeekAutoSyncPageWindowReached(
          { startPage: 1, targetPageEnd: 3 },
          4,
        ),
      ).toBe(true);
    });

    it("returns false when currentPage < targetPageEnd", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(
        extractor.isSeekAutoSyncPageWindowReached(
          { startPage: 1, targetPageEnd: 3 },
          2,
        ),
      ).toBe(false);
    });

    it("returns false when targetPageEnd is null", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(
        extractor.isSeekAutoSyncPageWindowReached(
          { startPage: 1, targetPageEnd: null },
          5,
        ),
      ).toBe(false);
    });
  });

  describe("resolveSeekAutoSyncCurrentPageSelection", () => {
    it("returns full page when no limit", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.resolveSeekAutoSyncCurrentPageSelection({
        currentPageResumeCount: 20,
      });
      expect(result.remainingCapacity).toBeNull();
      expect(result.selectedCount).toBe(20);
      expect(result.hitLimitWithinPage).toBe(false);
    });

    it("calculates remaining capacity from limit", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.resolveSeekAutoSyncCurrentPageSelection({
        limit: 50,
        totalSubmitted: 30,
        currentPageResumeCount: 20,
      });
      expect(result.remainingCapacity).toBe(20);
      expect(result.selectedCount).toBe(20);
      expect(result.hitLimitWithinPage).toBe(false);
    });

    it("detects hitLimitWithinPage", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.resolveSeekAutoSyncCurrentPageSelection({
        limit: 50,
        totalSubmitted: 40,
        currentPageResumeCount: 20,
      });
      expect(result.remainingCapacity).toBe(10);
      expect(result.selectedCount).toBe(10);
      expect(result.hitLimitWithinPage).toBe(true);
    });

    it("detects limitAlreadyReached", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.resolveSeekAutoSyncCurrentPageSelection({
        limit: 50,
        totalSubmitted: 50,
        currentPageResumeCount: 20,
      });
      expect(result.remainingCapacity).toBe(0);
      expect(result.limitAlreadyReached).toBe(true);
    });
  });

  describe("resolveSeekAutoSyncPageSize", () => {
    it("returns requestedPageSize when valid", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.resolveSeekAutoSyncPageSize({ requestedPageSize: 25 })).toBe(25);
    });

    it("falls back to currentPageCandidateCount", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(
        extractor.resolveSeekAutoSyncPageSize({ currentPageCandidateCount: 18 }),
      ).toBe(18);
    });

    it("falls back to DEFAULT_SEEK_PAGE_SIZE", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.resolveSeekAutoSyncPageSize({})).toBe(20);
    });
  });

  describe("getSeekPayloadData", () => {
    it("extracts data from array payload for seekRecommendedCandidates", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const payload = [
        { data: { talentSearchRecommendedCandidatesV2: { items: [] } } },
      ];
      const result = extractor.getSeekPayloadData(
        payload,
        "seekRecommendedCandidates",
      );
      expect(result).toEqual({
        talentSearchRecommendedCandidatesV2: { items: [] },
      });
    });

    it("extracts data from array payload for seekTalentSearch", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const payload = [
        {
          data: {
            talentSearchProfilesNaturalLanguageSearch: { result: {} },
          },
        },
      ];
      const result = extractor.getSeekPayloadData(payload, "seekTalentSearch");
      expect(result).toEqual({
        talentSearchProfilesNaturalLanguageSearch: { result: {} },
      });
    });

    it("extracts data from object payload with data key", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const payload = { data: { someKey: "value" } };
      const result = extractor.getSeekPayloadData(payload, "seekProfile");
      expect(result).toEqual({ someKey: "value" });
    });

    it("returns null for null payload", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.getSeekPayloadData(null, "seekProfile")).toBeNull();
    });
  });

  describe("extractSeekProfileResume", () => {
    it("returns empty array when no profile snapshot", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.extractSeekProfileResume();
      expect(result).toEqual([]);
    });

    it("extracts resume from profile snapshot", () => {
      const extractor = createSeekExtractor(
        createMockDeps({
          apiSnapshot: {
            seekProfile: {
              profileId: "123",
              firstName: "John",
              lastName: "Doe",
              currentJobTitle: "Engineer",
              currentLocation: "KL",
              lastModifiedDate: "2026-01-01",
            },
            seekRecommendedRequest: null,
            seekProfileRequest: null,
          },
        }),
      );
      const result = extractor.extractSeekProfileResume();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("John Doe");
      expect(result[0].jobIntention).toBe("Engineer");
      expect(result[0].location).toBe("KL");
    });
  });

  describe("extractSeekResumes", () => {
    it("returns empty array when no candidates", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.extractSeekResumes();
      expect(result).toEqual([]);
    });

    it("extracts resumes from seekRecommendedCandidates", () => {
      const extractor = createSeekExtractor(
        createMockDeps({
          apiSnapshot: {
            seekRecommendedCandidates: [
              {
                profileId: "1",
                firstName: "Alice",
                lastName: "Smith",
                currentJobTitle: "Manager",
                currentLocation: "SG",
              },
              {
                profileId: "2",
                firstName: "Bob",
                lastName: "Jones",
                currentJobTitle: "Analyst",
                currentLocation: "HK",
              },
            ],
            seekRecommendedRequest: null,
          },
        }),
      );
      const result = extractor.extractSeekResumes();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Alice Smith");
      expect(result[1].name).toBe("Bob Jones");
    });
  });

  describe("extractSeekTalentSearchResumes", () => {
    it("returns empty array when no talent search data", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.extractSeekTalentSearchResumes();
      expect(result).toEqual([]);
    });

    it("extracts resumes from seekTalentSearch", () => {
      const extractor = createSeekExtractor(
        createMockDeps({
          apiSnapshot: {
            seekTalentSearch: [
              {
                id: "relay-1",
                profileGuid: "uuid-abc",
                firstName: "Carol",
                lastName: "White",
                currentJobTitle: "Director",
                currentLocation: "AU",
              },
            ],
            seekTalentSearchRequest: null,
          },
        }),
      );
      const result = extractor.extractSeekTalentSearchResumes();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Carol White");
      expect(result[0].profileId).toBe("uuid-abc");
    });
  });
});
