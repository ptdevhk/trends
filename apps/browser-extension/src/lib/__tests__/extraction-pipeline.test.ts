/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { createExtractionPipeline } from "../extraction-pipeline.js";

const SOURCE_KEYS = { JOB5156: "job5156", JOB51: "51job", SEEK: "seek", UNKNOWN: "unknown" };

function createMockDeps(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    getCurrentSourceKey: vi.fn(() => SOURCE_KEYS.JOB5156),
    SOURCE_KEYS,
    apiSnapshot: {} as any,
    SELECTORS: {},
    getApiSnapshotCount: vi.fn(() => 0),
    isExtractionReady: vi.fn(() => false),
    isJob51RateLimitedPage: vi.fn(() => false),
    JOB51_RATE_LIMIT_ERROR_MESSAGE: "51job rate limited",
    getSeekCandidateIdentity: vi.fn(() => null),
    chrome: { storage: { local: { get: vi.fn() } } } as any,
    DEFAULT_COLLECTION_GUARDS: { job5156: "experience", "51job": "experience", seek: "experience" },
    CONTENT_SCRIPT_SOURCE: "tr-resume-content-script",
    JOB51_NEXT_PAGE_EVENT: "trJob51NextPageRequest",
    document: document,
    window: window as unknown as Window,
    resolveCurrentJob51DetailFetchDelayMs: vi.fn(() => 1000),
    JOB51_DETAIL_FETCH_CONCURRENCY: 2,
    enrich51JobSearchResumeWithDetail: vi.fn(async (r: any) => ({ resume: r, enriched: false })),
    syncCurrentPageToServer: vi.fn(async () => ({ success: true })),
    delay: vi.fn(async () => {}),
    pipelineState: { runId: 1, chain: Promise.resolve() },
    isJob51DetailPage: vi.fn(() => false),
    filterCurrentResumesByAgeRange: vi.fn((r: any[]) => r),
    extractJob51DetailResume: vi.fn(() => []),
    extract51JobResumes: vi.fn(() => []),
    isSeekProfileMode: vi.fn(() => false),
    hasSeekProfileSnapshot: vi.fn(() => false),
    extractSeekProfileResume: vi.fn(() => []),
    hasSeekTalentSearchSnapshot: vi.fn(() => false),
    extractSeekTalentSearchResumes: vi.fn(() => []),
    hasSeekListSnapshot: vi.fn(() => false),
    extractSeekResumes: vi.fn(() => []),
    isJob5156DetailPage: vi.fn(() => false),
    extractJob5156DetailResume: vi.fn(() => []),
    getApiRowForIndex: vi.fn(() => null),
    extractSingleResume: vi.fn(() => ({})),
    isJob51DetailReady: vi.fn(() => false),
    getSeekProfileRequest: vi.fn(() => null),
    getSeekTalentSearchRequest: vi.fn(() => null),
    getSeekRecommendedRequest: vi.fn(() => null),
    SEEK_PROFILE_TYPE: "seek",
    getJob5156DetailRoot: vi.fn(() => null),
    getSeekNextPageLinkForMode: vi.fn(() => null),
    getPaginationInfo: vi.fn(() => ({ currentPage: 1, totalPages: 1, totalItems: 0, hasNextPage: false })),
    asHTMLElement: vi.fn((el: any) => el),
    ...overrides,
  };
}

describe("extraction-pipeline", () => {
  describe("parseGuardFieldNames", () => {
    it("returns empty array for empty/undefined input", () => {
      const pipeline = createExtractionPipeline(createMockDeps());
      expect(pipeline.parseGuardFieldNames("")).toEqual([]);
      expect(pipeline.parseGuardFieldNames(null as any)).toEqual([]);
      expect(pipeline.parseGuardFieldNames(undefined as any)).toEqual([]);
    });

    it("parses valid field names", () => {
      const pipeline = createExtractionPipeline(createMockDeps());
      // extraction-pipeline uses GUARD_ARRAY_FIELD_NAMES subset
      const result = pipeline.parseGuardFieldNames("workHistory,skills,experience,licences");
      expect(result).toContain("workHistory");
      expect(result).toContain("skills");
      expect(result).toContain("licences");
    });

    it("ignores invalid field names", () => {
      const pipeline = createExtractionPipeline(createMockDeps());
      const result = pipeline.parseGuardFieldNames("workHistory,invalidField,skills");
      expect(result).toContain("workHistory");
      expect(result).toContain("skills");
      expect(result).not.toContain("invalidField");
    });

    it("deduplicates field names", () => {
      const pipeline = createExtractionPipeline(createMockDeps());
      const result = pipeline.parseGuardFieldNames("workHistory,workHistory");
      expect(result).toEqual(["workHistory"]);
    });
  });

  describe("applyCollectionGuards", () => {
    it("returns resume unchanged when no guard fields", () => {
      const pipeline = createExtractionPipeline(createMockDeps());
      const resume = { name: "Alice", experience: "5年" };
      expect(pipeline.applyCollectionGuards(resume, [])).toBe(resume);
    });

    it("clears string fields with empty string", () => {
      const pipeline = createExtractionPipeline(createMockDeps());
      const resume = { name: "Alice", experience: "5年", selfIntro: "Hello" };
      const result = pipeline.applyCollectionGuards(resume, ["experience", "selfIntro"]);
      expect(result.experience).toBe("");
      expect(result.selfIntro).toBe("");
      expect(result.name).toBe("Alice");
    });

    it("clears array fields with empty array", () => {
      const pipeline = createExtractionPipeline(createMockDeps());
      const resume = { name: "Alice", workHistory: ["job1"], skills: ["python"] };
      const result = pipeline.applyCollectionGuards(resume, ["workHistory", "skills"]);
      expect(result.workHistory).toEqual([]);
      expect(result.skills).toEqual([]);
    });

    it("returns resume unchanged when null resume", () => {
      const pipeline = createExtractionPipeline(createMockDeps());
      expect(pipeline.applyCollectionGuards(null, ["experience"])).toBeNull();
    });

    it("does not mutate the original resume", () => {
      const pipeline = createExtractionPipeline(createMockDeps());
      const resume = { experience: "5年" };
      const result = pipeline.applyCollectionGuards(resume, ["experience"]);
      expect(resume.experience).toBe("5年");
      expect(result.experience).toBe("");
    });
  });

  describe("isDisabledPaginationControl", () => {
    it("returns true for null/undefined element", () => {
      const pipeline = createExtractionPipeline(createMockDeps());
      expect(pipeline.isDisabledPaginationControl(null)).toBe(true);
      expect(pipeline.isDisabledPaginationControl(undefined as any)).toBe(true);
    });

    it("returns true for element with disabled attribute", () => {
      const pipeline = createExtractionPipeline(createMockDeps());
      const el = document.createElement("button");
      el.setAttribute("disabled", "");
      expect(pipeline.isDisabledPaginationControl(el)).toBe(true);
    });

    it("returns true for element with 'disabled' class", () => {
      const pipeline = createExtractionPipeline(createMockDeps());
      const el = document.createElement("button");
      el.classList.add("disabled");
      expect(pipeline.isDisabledPaginationControl(el)).toBe(true);
    });

    it("returns true for element with 'is-disabled' class", () => {
      const pipeline = createExtractionPipeline(createMockDeps());
      const el = document.createElement("button");
      el.classList.add("is-disabled");
      expect(pipeline.isDisabledPaginationControl(el)).toBe(true);
    });

    it("returns true for element with aria-disabled='true'", () => {
      const pipeline = createExtractionPipeline(createMockDeps());
      const el = document.createElement("button");
      el.setAttribute("aria-disabled", "true");
      expect(pipeline.isDisabledPaginationControl(el)).toBe(true);
    });

    it("returns false for enabled element", () => {
      const pipeline = createExtractionPipeline(createMockDeps());
      const el = document.createElement("button");
      expect(pipeline.isDisabledPaginationControl(el)).toBe(false);
    });
  });
});
