// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  getExternalAccessorStatus,
  installExternalAccessor,
} from "../external-accessor";

function createMockDeps(overrides = {}) {
  return {
    getExtensionVersion: vi.fn(() => "1.2.3"),
    getPaginationInfo: vi.fn(() => ({
      currentPage: 1,
      totalPages: 5,
      totalItems: 50,
      hasNextPage: true,
    })),
    getCurrentAgeRange: vi.fn(() => ({ enabled: true, minAge: 25, maxAge: 40 })),
    getCurrentSourceKey: vi.fn(() => "job51"),
    getApiSnapshotCount: vi.fn(() => 10),
    getSeekCardCount: vi.fn(() => 0),
    SOURCE_KEYS: { JOB51: "job51", JOB5156: "job5156", SEEK: "seek" },
    isExtractionReady: vi.fn(() => true),
    isLoggedIn: vi.fn(() => true),
    apiSnapshot: { lastOperationName: "searchResumes" },
    SELECTORS: { resumeCard: ".resume-card" },
    isJob5156DetailPage: vi.fn(() => false),
    isJob5156DetailReady: vi.fn(() => false),
    ...overrides,
  };
}

describe("external-accessor", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-tr-auto-search");
    document.documentElement.removeAttribute("data-tr-auto-location");
    document.documentElement.removeAttribute("data-tr-auto-age");
    document.documentElement.removeAttribute("data-tr-auto-export");
    document.documentElement.removeAttribute("data-tr-auto-sync");
    document.documentElement.removeAttribute("data-tr-auto-sync-count");
    document.documentElement.removeAttribute("data-tr-auto-sync-pages");
    document.documentElement.removeAttribute("data-tr-auto-sync-target-start");
    document.documentElement.removeAttribute("data-tr-auto-sync-target-end");
    document.documentElement.removeAttribute(
      "data-tr-auto-sync-effective-page-size",
    );
    document.documentElement.removeAttribute(
      "data-tr-auto-sync-selected-count",
    );
    document.documentElement.removeAttribute(
      "data-tr-auto-sync-remaining-capacity",
    );
    document.documentElement.removeAttribute("data-tr-auto-sync-stop-reason");
  });

  describe("getExternalAccessorStatus", () => {
    it("returns extensionLoaded true", () => {
      const status = getExternalAccessorStatus(createMockDeps());
      expect(status.extensionLoaded).toBe(true);
    });

    it("returns extensionVersion from deps", () => {
      const status = getExternalAccessorStatus(createMockDeps());
      expect(status.extensionVersion).toBe("1.2.3");
    });

    it("returns sourceKey from deps", () => {
      const status = getExternalAccessorStatus(createMockDeps());
      expect(status.sourceKey).toBe("job51");
    });

    it("returns apiSnapshotCount from deps", () => {
      const status = getExternalAccessorStatus(createMockDeps());
      expect(status.apiSnapshotCount).toBe(10);
    });

    it("returns domReady from isExtractionReady", () => {
      const status = getExternalAccessorStatus(createMockDeps());
      expect(status.domReady).toBe(true);
    });

    it("returns loggedIn from isLoggedIn", () => {
      const status = getExternalAccessorStatus(createMockDeps());
      expect(status.loggedIn).toBe(true);
    });

    it("returns ageRange when enabled", () => {
      const status = getExternalAccessorStatus(createMockDeps());
      expect(status.ageRange).toEqual({ minAge: 25, maxAge: 40 });
    });

    it("returns ageRange null when disabled", () => {
      const status = getExternalAccessorStatus(
        createMockDeps({
          getCurrentAgeRange: vi.fn(() => ({ enabled: false })),
        }),
      );
      expect(status.ageRange).toBeNull();
    });

    it("returns cardCount from apiSnapshotCount for job51", () => {
      const status = getExternalAccessorStatus(createMockDeps());
      expect(status.cardCount).toBe(10);
    });

    it("returns max of apiSnapshotCount and seekCardCount for seek source", () => {
      const status = getExternalAccessorStatus(
        createMockDeps({
          getCurrentSourceKey: vi.fn(() => "seek"),
          getApiSnapshotCount: vi.fn(() => 8),
          getSeekCardCount: vi.fn(() => 12),
        }),
      );
      expect(status.cardCount).toBe(12);
    });

    it("returns 1 for job5156 detail page when ready", () => {
      const status = getExternalAccessorStatus(
        createMockDeps({
          getCurrentSourceKey: vi.fn(() => "job5156"),
          isJob5156DetailPage: vi.fn(() => true),
          isJob5156DetailReady: vi.fn(() => true),
        }),
      );
      expect(status.cardCount).toBe(1);
    });

    it("returns 0 for job5156 detail page when not ready", () => {
      const status = getExternalAccessorStatus(
        createMockDeps({
          getCurrentSourceKey: vi.fn(() => "job5156"),
          isJob5156DetailPage: vi.fn(() => true),
          isJob5156DetailReady: vi.fn(() => false),
        }),
      );
      expect(status.cardCount).toBe(0);
    });

    it("reads auto-sync attributes from DOM", () => {
      document.documentElement.setAttribute("data-tr-auto-sync", "running");
      document.documentElement.setAttribute("data-tr-auto-sync-count", "5");
      document.documentElement.setAttribute("data-tr-auto-sync-pages", "2");
      document.documentElement.setAttribute(
        "data-tr-auto-sync-stop-reason",
        "completed",
      );
      const status = getExternalAccessorStatus(createMockDeps());
      expect(status.autoSync).toBe("running");
      expect(status.autoSyncCount).toBe(5);
      expect(status.autoSyncPages).toBe(2);
      expect(status.autoSyncStopReason).toBe("completed");
    });

    it("returns 0 for non-numeric auto-sync attributes", () => {
      document.documentElement.setAttribute("data-tr-auto-sync-count", "abc");
      const status = getExternalAccessorStatus(createMockDeps());
      expect(status.autoSyncCount).toBe(0);
    });

    it("returns null for missing numeric auto-sync attributes", () => {
      const status = getExternalAccessorStatus(createMockDeps());
      expect(status.autoSyncTargetPageStart).toBeNull();
      expect(status.autoSyncTargetPageEnd).toBeNull();
    });

    it("includes pagination info", () => {
      const status = getExternalAccessorStatus(createMockDeps());
      expect(status.pagination).toEqual({
        currentPage: 1,
        totalPages: 5,
        totalItems: 50,
        hasNextPage: true,
      });
    });

    it("includes lastOperationName from apiSnapshot", () => {
      const status = getExternalAccessorStatus(createMockDeps());
      expect(status.lastOperationName).toBe("searchResumes");
    });

    it("includes timestamp as ISO string", () => {
      const status = getExternalAccessorStatus(createMockDeps());
      expect(typeof status.timestamp).toBe("string");
      expect(() => new Date(status.timestamp)).not.toThrow();
    });
  });

  describe("installExternalAccessor", () => {
    it("installs accessor on window with expected methods", () => {
      const key = "__TR_RESUME_DATA__";
      const mockDeps = {
        extractResumes: vi.fn(() => ["resume1"]),
        extractResumesRaw: vi.fn(() => ({ raw: true })),
        collectSnapshotPayload: vi.fn(() => Promise.resolve({})),
        apiSnapshot: { data: "test" },
        getPaginationInfo: vi.fn(() => ({ currentPage: 1 })),
        isExtractionReady: vi.fn(() => true),
        isLoggedIn: vi.fn(() => true),
        getExternalAccessorStatus: vi.fn(() => ({ loaded: true })),
        syncToServer: vi.fn(() => Promise.resolve()),
        goToNextPageInternal: vi.fn(() => true),
        version: "1.0.0",
      };

      installExternalAccessor(key, mockDeps);

      expect((window as unknown as Record<string, unknown>)[key]).toBeDefined();
      const accessor = (window as unknown as Record<string, unknown>)[key] as Record<
        string,
        unknown
      >;
      expect(typeof accessor.extract).toBe("function");
      expect(typeof accessor.extractRaw).toBe("function");
      expect(typeof accessor.collect).toBe("function");
      expect(typeof accessor.getApiSnapshot).toBe("function");
      expect(typeof accessor.getPaginationInfo).toBe("function");
      expect(typeof accessor.isReady).toBe("function");
      expect(typeof accessor.isLoggedIn).toBe("function");
      expect(typeof accessor.status).toBe("function");
      expect(typeof accessor.syncToServer).toBe("function");
      expect(typeof accessor.goToNextPage).toBe("function");
      expect(accessor.version).toBe("1.0.0");
    });

    it("extract method calls extractResumes", () => {
      const key = "__TR_TEST_ACCESSOR__";
      const extractResumes = vi.fn(() => ["resume1"]);
      installExternalAccessor(key, {
        extractResumes,
        extractResumesRaw: vi.fn(),
        collectSnapshotPayload: vi.fn(),
        apiSnapshot: {},
        getPaginationInfo: vi.fn(),
        isExtractionReady: vi.fn(),
        isLoggedIn: vi.fn(),
        getExternalAccessorStatus: vi.fn(),
        syncToServer: vi.fn(),
        goToNextPageInternal: vi.fn(),
        version: "1.0.0",
      });

      const accessor = (window as unknown as Record<string, unknown>)[key] as Record<
        string,
        () => unknown
      >;
      const result = accessor.extract();
      expect(extractResumes).toHaveBeenCalled();
      expect(result).toEqual(["resume1"]);
    });
  });
});
