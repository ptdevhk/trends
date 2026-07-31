import { afterEach, describe, expect, it } from "vitest";

import {
  createIndustryReviewCursor,
  getCachedIndustryReviewIndex,
  invalidateIndustryReviewIndex,
  paginateIndustryReviewIndex,
  setCachedIndustryReviewIndex,
  type IndustryReviewIndexEntry,
} from "./company-industry-review-index.js";

const entry = (
  proposalId: string,
  overrides: Partial<IndustryReviewIndexEntry> = {},
): IndustryReviewIndexEntry => ({
  proposalId,
  inputFingerprint: `fingerprint-${proposalId}`,
  recommendedAction: "needs_more_evidence",
  confidenceBand: "low",
  riskFlags: [],
  priority: 10,
  updatedAt: 100,
  ...overrides,
});

afterEach(() => {
  invalidateIndustryReviewIndex();
});

describe("industry review index pagination", () => {
  it("returns a bounded stable page and cursor without duplicating items", () => {
    const entries = [
      entry("proposal-3", { priority: 1 }),
      entry("proposal-1", { priority: 20 }),
      entry("proposal-2", { priority: 10 }),
    ];
    const first = paginateIndustryReviewIndex(entries, { limit: 2 });
    expect(first.items.map((item) => item.proposalId)).toEqual([
      "proposal-1",
      "proposal-2",
    ]);
    expect(first.nextCursor).toBeTruthy();

    const second = paginateIndustryReviewIndex(entries, {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((item) => item.proposalId)).toEqual(["proposal-3"]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("does not let a cursor cross an index snapshot", () => {
    const cursor = createIndustryReviewCursor({
      snapshot: "snapshot-a",
      afterProposalId: "proposal-1",
    });
    expect(() =>
      paginateIndustryReviewIndex([entry("proposal-2")], {
        limit: 1,
        cursor,
        snapshot: "snapshot-b",
      }),
    ).toThrow("INDUSTRY_REVIEW_CURSOR_STALE");
  });

  it("keeps the advisory index bounded and invalidatable", () => {
    const first = [entry("proposal-1")];
    setCachedIndustryReviewIndex("dev:ready_for_review", first, "maintenance-a", 100);

    expect(getCachedIndustryReviewIndex("dev:ready_for_review", "maintenance-a", 101)).toEqual(first);
    expect(getCachedIndustryReviewIndex("dev:ready_for_review", "maintenance-b", 101)).toBeUndefined();

    setCachedIndustryReviewIndex("dev:ready_for_review", first, "maintenance-a", 100);
    invalidateIndustryReviewIndex("dev:ready_for_review");
    expect(getCachedIndustryReviewIndex("dev:ready_for_review", "maintenance-a", 101)).toBeUndefined();
  });
});
