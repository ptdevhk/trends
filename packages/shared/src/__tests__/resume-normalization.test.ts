import { describe, expect, it } from "vitest";

import { normalizeResumeLocationHierarchy } from "../resume-normalization";

describe("normalizeResumeLocationHierarchy with source fallback", () => {
  it("returns explicit location hierarchy when present", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "Kuala Lumpur",
      source: "seek",
    });
    expect(result?.country).toBe("Malaysia");
    expect(result?.confidence).toBe("high");
  });

  it("falls back to Malaysia from seek source when location is empty", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "",
      source: "seek",
    });
    expect(result).toEqual(
      expect.objectContaining({
        country: "Malaysia",
        matchedFrom: "source",
        confidence: "low",
      }),
    );
  });

  it("falls back to Malaysia from seek hostname when location is empty", () => {
    const result = normalizeResumeLocationHierarchy(
      { location: "", source: "my.employer.seek.com" },
    );
    expect(result).toEqual(
      expect.objectContaining({
        country: "Malaysia",
        matchedFrom: "source",
        confidence: "low",
      }),
    );
  });

  it("falls back to Malaysia via explicit source param", () => {
    const result = normalizeResumeLocationHierarchy(
      { name: "Test Resume", location: "" },
      "my.employer.seek.com",
    );
    expect(result).toEqual(
      expect.objectContaining({
        country: "Malaysia",
        matchedFrom: "source",
      }),
    );
  });

  it("falls back to 中国 from job5156 hostname when location is empty", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "",
      source: "hr.job5156.com",
    });
    expect(result).toEqual(
      expect.objectContaining({
        country: "中国",
        matchedFrom: "source",
      }),
    );
  });

  it("falls back to 中国 from 51job source when location is empty", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "",
      source: "51job",
    });
    expect(result).toEqual(
      expect.objectContaining({
        country: "中国",
        matchedFrom: "source",
      }),
    );
  });

  it("returns undefined when no candidates and no known source", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "",
      source: "unknown-source",
    });
    expect(result).toBeUndefined();
  });
});
