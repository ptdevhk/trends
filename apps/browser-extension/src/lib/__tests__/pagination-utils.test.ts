/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { createPaginationUtils, type PaginationUtilsDeps } from "../pagination-utils.js";

const SOURCE_KEYS = { JOB5156: "job5156", JOB51: "51job", SEEK: "seek", UNKNOWN: "unknown" };

function createMockDeps(overrides: Partial<PaginationUtilsDeps> = {}): PaginationUtilsDeps {
  return {
    getCurrentSourceKey: vi.fn(() => SOURCE_KEYS.JOB5156),
    SOURCE_KEYS,
    isJob51DetailPage: vi.fn(() => false),
    isJob5156DetailPage: vi.fn(() => false),
    isJob51DetailReady: vi.fn(() => false),
    isJob5156DetailReady: vi.fn(() => false),
    getSeekPaginationInfo: vi.fn(() => ({
      currentPage: 1,
      totalPages: 1,
      totalItems: 0,
      hasNextPage: false,
    })),
    getSeekNextPageLinkForMode: vi.fn(() => null),
    getCurrentSeekMode: vi.fn(() => "recommended"),
    apiSnapshot: {},
    normalizeOptionalPositiveInt: vi.fn((v: any) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    }),
    doc: document,
    win: window as unknown as Window,
    SELECTORS: {
      pagination: ".el-pagination",
      nextPageBtn: ".el-pagination .btn-next",
      seekPagination: 'nav[aria-label="Pagination of results"]',
      seekTalentSearchPagination: 'nav[aria-label="PAGINATION_OF_RESULTS"]',
    } as any,
    ...overrides,
  };
}

describe("pagination-utils", () => {
  describe("createPaginationUtils", () => {
    it("returns an object with all expected methods", () => {
      const utils = createPaginationUtils(createMockDeps());
      expect(utils).toHaveProperty("getPaginationInfo");
      expect(utils).toHaveProperty("getNextPageButtonState");
      expect(utils).toHaveProperty("waitForPagination");
    });
  });

  describe("getPaginationInfo", () => {
    it("returns seek pagination info for SEEK source", () => {
      const seekInfo = { currentPage: 2, totalPages: 5, totalItems: 100, hasNextPage: true };
      const utils = createPaginationUtils(createMockDeps({
        getCurrentSourceKey: vi.fn(() => SOURCE_KEYS.SEEK),
        getSeekPaginationInfo: vi.fn(() => seekInfo),
      }));
      expect(utils.getPaginationInfo()).toEqual(seekInfo);
    });

    it("returns single-page info for 51job detail page", () => {
      const utils = createPaginationUtils(createMockDeps({
        getCurrentSourceKey: vi.fn(() => SOURCE_KEYS.JOB51),
        isJob51DetailPage: vi.fn(() => true),
        isJob51DetailReady: vi.fn(() => true),
      }));
      const info = utils.getPaginationInfo();
      expect(info.currentPage).toBe(1);
      expect(info.totalPages).toBe(1);
      expect(info.totalItems).toBe(1);
      expect(info.hasNextPage).toBe(false);
    });

    it("returns zero items for 51job detail page when not ready", () => {
      const utils = createPaginationUtils(createMockDeps({
        getCurrentSourceKey: vi.fn(() => SOURCE_KEYS.SEEK),
        isJob51DetailPage: vi.fn(() => true),
        isJob51DetailReady: vi.fn(() => false),
      }));
      const info = utils.getPaginationInfo();
      expect(info.totalItems).toBe(0);
    });

    it("returns single-page info for job5156 detail page", () => {
      const utils = createPaginationUtils(createMockDeps({
        isJob5156DetailPage: vi.fn(() => true),
        isJob5156DetailReady: vi.fn(() => true),
      }));
      const info = utils.getPaginationInfo();
      expect(info.currentPage).toBe(1);
      expect(info.hasNextPage).toBe(false);
    });

    it("computes 51job pagination from API snapshot", () => {
      const utils = createPaginationUtils(createMockDeps({
        getCurrentSourceKey: vi.fn(() => SOURCE_KEYS.JOB51),
        apiSnapshot: {
          job51LastSearchRequest: { page_index: 2, page_size: 50 },
          job51Total: 200,
          job51SearchRows: Array(50).fill({}),
        },
      }));
      const info = utils.getPaginationInfo();
      expect(info.currentPage).toBe(2);
      expect(info.totalPages).toBe(4);
      expect(info.totalItems).toBe(200);
      expect(info.hasNextPage).toBe(true);
    });

    it("defaults to page 1 when API snapshot is empty", () => {
      const utils = createPaginationUtils(createMockDeps({
        getCurrentSourceKey: vi.fn(() => SOURCE_KEYS.JOB51),
        apiSnapshot: {},
      }));
      const info = utils.getPaginationInfo();
      expect(info.currentPage).toBe(1);
    });

    it("returns default info when no pagination element exists", () => {
      const utils = createPaginationUtils(createMockDeps());
      const info = utils.getPaginationInfo();
      expect(info.currentPage).toBe(1);
      expect(info.hasNextPage).toBe(false);
    });
  });

  describe("getNextPageButtonState", () => {
    it("returns exists:false when seek has no next button", () => {
      const utils = createPaginationUtils(createMockDeps({
        getCurrentSourceKey: vi.fn(() => SOURCE_KEYS.SEEK),
        getSeekNextPageLinkForMode: vi.fn(() => null),
      }));
      const state = utils.getNextPageButtonState();
      expect(state.exists).toBe(false);
    });

    it("returns 51job API-based next button state", () => {
      const utils = createPaginationUtils(createMockDeps({
        getCurrentSourceKey: vi.fn(() => SOURCE_KEYS.JOB51),
        apiSnapshot: {
          job51LastSearchRequest: { page_index: 1, page_size: 50 },
          job51Total: 200,
          job51SearchRows: Array(50).fill({}),
        },
      }));
      const state = utils.getNextPageButtonState();
      expect(state.exists).toBe(true);
      expect(state.source).toBe("51job-api");
    });

    it("returns exists:false when no next button element exists", () => {
      const utils = createPaginationUtils(createMockDeps());
      const state = utils.getNextPageButtonState();
      expect(state.exists).toBe(false);
    });
  });

  describe("waitForPagination", () => {
    it("resolves immediately for 51job (infinite scroll)", async () => {
      const utils = createPaginationUtils(createMockDeps({
        getCurrentSourceKey: vi.fn(() => SOURCE_KEYS.JOB51),
      }));
      const result = await utils.waitForPagination();
      expect(result).toBe(true);
    });
  });
});
