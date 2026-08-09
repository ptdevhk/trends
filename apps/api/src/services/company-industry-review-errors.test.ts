import { describe, expect, it } from "vitest";

import {
  IndustryReviewNotOpenError,
  IndustryReviewStaleError,
  industryReviewNotOpenReason,
  industryReviewStaleReason,
  isIndustryReviewNotOpenError,
  isIndustryReviewStaleError,
} from "./company-industry-review-errors.js";

describe("industry review stale errors", () => {
  it("recognizes the stable stale code without matching mutable prose", () => {
    const error = new IndustryReviewStaleError("source changed during review");
    expect(error.code).toBe("INDUSTRY_REVIEW_STALE");
    expect(isIndustryReviewStaleError(error)).toBe(true);
    expect(
      isIndustryReviewStaleError(
        new Error("INDUSTRY_REVIEW_STALE: proposal changed"),
      ),
    ).toBe(true);
    expect(isIndustryReviewStaleError(new Error("proposal changed during review"))).toBe(
      false,
    );
  });

  it("recognizes the stale code inside the convex local-backend transport wrapper", () => {
    // The local backend prefixes function errors with a request id and a
    // stack trace; a leading-prefix check misses the code entirely.
    const wrapped = new Error(
      "[Request ID: df43104bb5d07519] Server Error\n"
      + "Uncaught Error: INDUSTRY_REVIEW_STALE: proposal changed during review\n"
      + "    at assertExpectedIndustryProposalUpdatedAt (../convex/companies.ts:1828:0)\n"
      + "    at handler (../convex/companies.ts:5168:4)",
    );
    expect(isIndustryReviewStaleError(wrapped)).toBe(true);
    expect(industryReviewStaleReason(wrapped)).toBe("proposal changed during review");
  });

  it("extracts the reason from wrapped and unwrapped messages", () => {
    expect(industryReviewStaleReason(new Error("INDUSTRY_REVIEW_STALE: packet moved"))).toBe(
      "packet moved",
    );
    expect(industryReviewStaleReason(new IndustryReviewStaleError("fresh packet expected"))).toBe(
      "fresh packet expected",
    );
    expect(industryReviewStaleReason(new Error("unrelated failure"))).toBe("unrelated failure");
  });
});

describe("industry review not-open errors", () => {
  it("recognizes the typed error and the convex not-open message", () => {
    const typed = new IndustryReviewNotOpenError("identity resolution is closed");
    expect(typed.code).toBe("INDUSTRY_REVIEW_NOT_OPEN");
    expect(isIndustryReviewNotOpenError(typed)).toBe(true);
    expect(
      isIndustryReviewNotOpenError(
        new Error("Proposal is not open for identity resolution: approved"),
      ),
    ).toBe(true);
    expect(
      isIndustryReviewNotOpenError(
        new Error("[Request ID: 8f3c1d2e] Server Error\n"
          + "Uncaught Error: Proposal is not open: rejected\n"
          + "    at resolveIndustryProposal (../convex/companies.ts:5401:4)"),
      ),
    ).toBe(true);
    expect(isIndustryReviewNotOpenError(new Error("Proposal changed during review"))).toBe(false);
    expect(isIndustryReviewStaleError(typed)).toBe(false);
  });

  it("extracts the not-open reason from wrapped and unwrapped messages", () => {
    expect(
      industryReviewNotOpenReason(new Error("Proposal is not open for identity resolution: approved")),
    ).toBe("Proposal is not open for identity resolution: approved");
    expect(
      industryReviewNotOpenReason(new IndustryReviewNotOpenError("closed")),
    ).toBe("closed");
  });
});
