import { describe, it, expect } from "vitest";

import {
  JOB51_SAFE_LIMIT,
  JOB51_SAFE_MAX_PAGES,
  JOB51_DETAIL_FETCH_DELAY_MS,
  JOB51_DETAIL_FETCH_UNSAFE_DELAY_MS,
  hasJob51UnsafeLimitsOverride,
  resolveJob51CollectionLimits,
  resolveJob51DetailFetchDelayMs,
  resolveJob51AutoSyncDetailWaitMode,
} from "../job51-collection-config";

describe("job51-collection-config", () => {
  describe("constants", () => {
    it("exports safe limit as 50", () => {
      expect(JOB51_SAFE_LIMIT).toBe(50);
    });

    it("exports safe max pages as 1", () => {
      expect(JOB51_SAFE_MAX_PAGES).toBe(1);
    });

    it("exports detail fetch delay as 5000ms", () => {
      expect(JOB51_DETAIL_FETCH_DELAY_MS).toBe(5000);
    });

    it("exports unsafe detail fetch delay as 1000ms", () => {
      expect(JOB51_DETAIL_FETCH_UNSAFE_DELAY_MS).toBe(1000);
    });
  });

  describe("hasJob51UnsafeLimitsOverride", () => {
    it("returns true when tr_unsafe_limits=1", () => {
      expect(hasJob51UnsafeLimitsOverride("tr_unsafe_limits=1")).toBe(true);
    });

    it("returns false when tr_unsafe_limits is not 1", () => {
      expect(hasJob51UnsafeLimitsOverride("tr_unsafe_limits=0")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(hasJob51UnsafeLimitsOverride("")).toBe(false);
    });

    it("returns false for unrelated params", () => {
      expect(hasJob51UnsafeLimitsOverride("keyword=python")).toBe(false);
    });
  });

  describe("resolveJob51CollectionLimits", () => {
    it("clamps limit to safe default without override", () => {
      const result = resolveJob51CollectionLimits(0, 0, "");
      expect(result.limit).toBe(JOB51_SAFE_LIMIT);
      expect(result.maxPages).toBe(JOB51_SAFE_MAX_PAGES);
    });

    it("clamps large limit to safe max without override", () => {
      const result = resolveJob51CollectionLimits(200, 10, "");
      expect(result.limit).toBe(JOB51_SAFE_LIMIT);
      expect(result.maxPages).toBe(JOB51_SAFE_MAX_PAGES);
    });

    it("allows requested limit with unsafe override", () => {
      const result = resolveJob51CollectionLimits(200, 10, "tr_unsafe_limits=1");
      expect(result.limit).toBe(200);
      expect(result.maxPages).toBe(10);
    });

    it("uses safe defaults when limit is 0 even with unsafe override", () => {
      const result = resolveJob51CollectionLimits(0, 0, "tr_unsafe_limits=1");
      expect(result.limit).toBe(JOB51_SAFE_LIMIT);
      expect(result.maxPages).toBe(JOB51_SAFE_MAX_PAGES);
    });

    it("clamps small limit to safe max without override", () => {
      const result = resolveJob51CollectionLimits(30, 1, "");
      expect(result.limit).toBe(30);
      expect(result.maxPages).toBe(1);
    });
  });

  describe("resolveJob51DetailFetchDelayMs", () => {
    it("returns safe delay without override", () => {
      expect(resolveJob51DetailFetchDelayMs("")).toBe(JOB51_DETAIL_FETCH_DELAY_MS);
    });

    it("returns unsafe delay with override", () => {
      expect(resolveJob51DetailFetchDelayMs("tr_unsafe_limits=1")).toBe(
        JOB51_DETAIL_FETCH_UNSAFE_DELAY_MS,
      );
    });
  });

  describe("resolveJob51AutoSyncDetailWaitMode", () => {
    it('returns "background" by default', () => {
      expect(resolveJob51AutoSyncDetailWaitMode("")).toBe("background");
    });

    it('returns "page1" when tr_job51_detail_wait=page1', () => {
      expect(resolveJob51AutoSyncDetailWaitMode("tr_job51_detail_wait=page1")).toBe("page1");
    });

    it('returns "all" when tr_job51_detail_wait=all', () => {
      expect(resolveJob51AutoSyncDetailWaitMode("tr_job51_detail_wait=all")).toBe("all");
    });

    it('returns "background" for unknown mode', () => {
      expect(resolveJob51AutoSyncDetailWaitMode("tr_job51_detail_wait=unknown")).toBe("background");
    });

    it("handles whitespace in mode value", () => {
      expect(resolveJob51AutoSyncDetailWaitMode("tr_job51_detail_wait= page1 ")).toBe("page1");
    });
  });
});
