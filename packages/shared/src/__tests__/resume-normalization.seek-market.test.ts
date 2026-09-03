import { describe, expect, it } from "vitest";

import { normalizeResumeLocationHierarchy } from "../resume-normalization";

/**
 * Seek source-country location-facet defect (2026-09-02 preview evidence):
 * every seek digest row carries locationText=Malaysia even when content.location
 * is a Thai city. normalizeResumeLocationHierarchy resolves the content
 * hierarchy to Thailand, then the explicit-hierarchy conflict rule replaces it
 * with the source-inferred country (SOURCE_KEY_TO_COUNTRY.seek = "Malaysia",
 * no TH branch). MY must stay unchanged.
 */
describe("normalizeResumeLocationHierarchy seek market-aware source country", () => {
  it("keeps MY seek content-derived country when source implies Malaysia (unchanged)", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "Kuala Lumpur",
      source: "my.employer.seek.com",
    });
    expect(result).toEqual(expect.objectContaining({
      country: "Malaysia",
      matchedFrom: "location",
      confidence: "high",
    }));
  });

  it("keeps TH content-derived Thailand when source host is hk.employer.seek.com", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "Rayong, TH",
      source: "hk.employer.seek.com",
    });
    expect(result).toEqual(expect.objectContaining({
      country: "Thailand",
      matchedFrom: "location",
      confidence: "high",
    }));
  });

  it("keeps TH content-derived Thailand when source host is seek without explicit market (default MY not applied)", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "Mueang Chonburi, Chon Buri, TH",
      source: "seek",
    });
    expect(result).toEqual(expect.objectContaining({
      country: "Thailand",
      matchedFrom: "location",
      confidence: "high",
    }));
  });

  it("does not override a content hierarchy with Thailand when source implies MY (content wins over low source fallback)", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "Bangkok, TH",
      locationHierarchy: { country: "Thailand", province: "Bangkok", matchedFrom: "location", confidence: "high" },
      source: "hk.employer.seek.com",
    });
    expect(result).toEqual(expect.objectContaining({
      country: "Thailand",
      province: "Bangkok",
      matchedFrom: "location",
      confidence: "high",
    }));
  });

  it("falls back to Malaysia from MY seek hostname when location empty (unchanged)", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "",
      source: "my.employer.seek.com",
    });
    expect(result).toEqual(expect.objectContaining({
      country: "Malaysia",
      matchedFrom: "source",
      confidence: "low",
    }));
  });

  it("falls back to Thailand from a TH-market seek profile URL when location empty", () => {
    // The TH talentsearch lane runs on the hk.employer.seek.com host with a
    // market=TH name-search profileUrl. A TH row with no parseable content
    // location must not fall back to Malaysia.
    const result = normalizeResumeLocationHierarchy({
      location: "",
      source: "hk.employer.seek.com",
      profileUrl: "https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=John&market=TH&pageNumber=1",
    });
    expect(result).toEqual(expect.objectContaining({
      country: "Thailand",
      matchedFrom: "source",
      confidence: "low",
    }));
  });

  it("keeps Malaysia fallback for a MY-market seek host with no content location", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "",
      source: "my.employer.seek.com",
    });
    expect(result).toEqual(expect.objectContaining({
      country: "Malaysia",
      matchedFrom: "source",
      confidence: "low",
    }));
  });
});
