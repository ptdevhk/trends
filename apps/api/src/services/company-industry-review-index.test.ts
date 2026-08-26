import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createIndustryReviewCursor,
  getCachedIndustryReviewIndex,
  getIndustryReviewCorpusOrLoad,
  invalidateIndustryReviewIndex,
  paginateIndustryReviewIndex,
  setCachedIndustryReviewIndex,
  type IndustryReviewCorpus,
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

describe("industry review corpus cache", () => {
  const corpus = (): IndustryReviewCorpus => ({
    sources: [
      {
        _id: "source-row",
        sourceId: "source-1",
        proposalId: "proposal-1",
        url: "https://example.com",
        sourceDomain: "example.com",
        sourceType: "official_site",
        trustTier: "primary",
        fetchStatus: "fetched",
        reviewStatus: "approved",
        sourceState: "active",
        createdAt: 100,
        updatedAt: 100,
      },
    ],
    profiles: [
      {
        _id: "profile-row",
        companyKey: "polywell",
        industryClass: "cnc",
        verificationLevel: "verified",
        evidenceSource: "seed",
        updatedAt: 100,
      },
    ],
  });

  it("loads once and reuses across calls within the freshness window", async () => {
    const loader = vi.fn(async () => corpus());
    const first = await getIndustryReviewCorpusOrLoad("maintenance-a", loader);
    const second = await getIndustryReviewCorpusOrLoad("maintenance-a", loader);
    expect(first).toEqual(corpus());
    expect(second).toEqual(corpus());
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("forces a reload when the maintenance fingerprint changes", async () => {
    const loader = vi.fn(async () => corpus());
    await getIndustryReviewCorpusOrLoad("maintenance-a", loader);
    await getIndustryReviewCorpusOrLoad("maintenance-b", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent loads through the in-flight guard", async () => {
    let resolveLoad: (value: IndustryReviewCorpus) => void = () => {};
    const loader = vi.fn(
      () =>
        new Promise<IndustryReviewCorpus>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const first = getIndustryReviewCorpusOrLoad("maintenance-a", loader);
    const second = getIndustryReviewCorpusOrLoad("maintenance-a", loader);
    resolveLoad(corpus());
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual(corpus());
    expect(secondResult).toEqual(corpus());
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed load and retries on the next call", async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("convex down"))
      .mockResolvedValueOnce(corpus());
    await expect(
      getIndustryReviewCorpusOrLoad("maintenance-a", loader),
    ).rejects.toThrow("convex down");
    const result = await getIndustryReviewCorpusOrLoad("maintenance-a", loader);
    expect(result).toEqual(corpus());
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("is cleared by a full index invalidation", async () => {
    const loader = vi.fn(async () => corpus());
    await getIndustryReviewCorpusOrLoad("maintenance-a", loader);
    invalidateIndustryReviewIndex();
    await getIndustryReviewCorpusOrLoad("maintenance-a", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
