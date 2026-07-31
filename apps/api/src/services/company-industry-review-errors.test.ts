import { describe, expect, it } from "vitest";

import {
  IndustryReviewStaleError,
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
});
