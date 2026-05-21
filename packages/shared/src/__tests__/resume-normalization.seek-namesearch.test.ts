import { describe, expect, it } from "vitest";
import { buildSeekNameSearchUrl, inferSeekMarket, normalizeSeekProfileUrlForDisplay, normalizeProfileUrlForDisplay } from "../resume-normalization";

describe("buildSeekNameSearchUrl", () => {
  it("builds name-search URL with name and market", () => {
    expect(buildSeekNameSearchUrl("Cyan Yap Kin Sun", "MY"))
      .toBe("https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=Cyan%20Yap%20Kin%20Sun&market=MY&pageNumber=1");
  });

  it("encodes special characters in name", () => {
    expect(buildSeekNameSearchUrl("Tan & Associates", "HK"))
      .toBe("https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=Tan%20%26%20Associates&market=HK&pageNumber=1");
  });

  it("returns empty string when name is empty", () => {
    expect(buildSeekNameSearchUrl("", "MY")).toBe("");
  });

  it("returns empty string when name is whitespace only", () => {
    expect(buildSeekNameSearchUrl("  ", "MY")).toBe("");
  });

  it("handles CJK characters in name", () => {
    expect(buildSeekNameSearchUrl("陈大文", "MY"))
      .toBe("https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=%E9%99%88%E5%A4%A7%E6%96%87&market=MY&pageNumber=1");
  });

  it("defaults market to MY when not provided", () => {
    expect(buildSeekNameSearchUrl("John Doe"))
      .toBe("https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=John%20Doe&market=MY&pageNumber=1");
  });

  it("appends roleTitles parameter when provided", () => {
    expect(buildSeekNameSearchUrl("Kenny Low", "MY", "Sales Manager"))
      .toBe("https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=Kenny%20Low&market=MY&pageNumber=1&roleTitles=Sales%20Manager");
  });

  it("encodes special characters in roleTitles", () => {
    expect(buildSeekNameSearchUrl("John Doe", "MY", "Software Engineer & Architect"))
      .toBe("https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=John%20Doe&market=MY&pageNumber=1&roleTitles=Software%20Engineer%20%26%20Architect");
  });

  it("skips roleTitles when empty string", () => {
    expect(buildSeekNameSearchUrl("John Doe", "MY", ""))
      .toBe("https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=John%20Doe&market=MY&pageNumber=1");
  });

  it("skips roleTitles when whitespace only", () => {
    expect(buildSeekNameSearchUrl("John Doe", "MY", "  "))
      .toBe("https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=John%20Doe&market=MY&pageNumber=1");
  });
});

describe("inferSeekMarket", () => {
  it("returns MY for seek source", () => {
    expect(inferSeekMarket("hk.employer.seek.com")).toBe("MY");
  });

  it("returns MY for my.employer.seek.com host", () => {
    expect(inferSeekMarket("my.employer.seek.com")).toBe("MY");
  });

  it("returns HK for hk.employer.seek.com with HK indicators", () => {
    expect(inferSeekMarket("hk.employer.seek.com", "HK")).toBe("HK");
  });

  it("returns MY by default", () => {
    expect(inferSeekMarket("unknown")).toBe("MY");
  });
});

describe("normalizeSeekProfileUrlForDisplay with name-search upgrade", () => {
  it("upgrades UUID URL to name-search when name is provided", () => {
    const uuidUrl = "https://hk.employer.seek.com/candidates/82a5d7c6-6fb3-4960-aa78-58159b0c62d1";
    expect(normalizeSeekProfileUrlForDisplay(uuidUrl, "Cyan Yap Kin Sun", "MY"))
      .toBe("https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=Cyan%20Yap%20Kin%20Sun&market=MY&pageNumber=1");
  });

  it("passes UUID URL through unchanged when name is not provided", () => {
    const uuidUrl = "https://hk.employer.seek.com/candidates/82a5d7c6-6fb3-4960-aa78-58159b0c62d1";
    expect(normalizeSeekProfileUrlForDisplay(uuidUrl)).toBe(uuidUrl);
  });

  it("passes UUID URL through unchanged when name is empty", () => {
    const uuidUrl = "https://hk.employer.seek.com/candidates/82a5d7c6-6fb3-4960-aa78-58159b0c62d1";
    expect(normalizeSeekProfileUrlForDisplay(uuidUrl, "", "MY")).toBe(uuidUrl);
  });

  it("keeps recommended URL unchanged even when name is provided", () => {
    const recUrl = "https://hk.employer.seek.com/candidates/recommended?jobId=123&openProfileId=456";
    expect(normalizeSeekProfileUrlForDisplay(recUrl, "John Doe", "MY")).toBe(recUrl);
  });

  it("keeps numeric direct-path URL unchanged", () => {
    const numUrl = "https://hk.employer.seek.com/candidates/12345";
    expect(normalizeSeekProfileUrlForDisplay(numUrl, "John Doe", "MY")).toBe(numUrl);
  });

  it("includes roleTitles when upgrading UUID URL", () => {
    const uuidUrl = "https://hk.employer.seek.com/candidates/82a5d7c6-6fb3-4960-aa78-58159b0c62d1";
    expect(normalizeSeekProfileUrlForDisplay(uuidUrl, "Kenny Low", "MY", "Sales Manager"))
      .toBe("https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=Kenny%20Low&market=MY&pageNumber=1&roleTitles=Sales%20Manager");
  });

  it("omits roleTitles when not provided", () => {
    const uuidUrl = "https://hk.employer.seek.com/candidates/82a5d7c6-6fb3-4960-aa78-58159b0c62d1";
    expect(normalizeSeekProfileUrlForDisplay(uuidUrl, "Kenny Low", "MY"))
      .toBe("https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=Kenny%20Low&market=MY&pageNumber=1");
  });
});

describe("normalizeProfileUrlForDisplay with name param", () => {
  it("passes name and market to seek normalizer for seek source", () => {
    const uuidUrl = "https://hk.employer.seek.com/candidates/82a5d7c6-6fb3-4960-aa78-58159b0c62d1";
    expect(normalizeProfileUrlForDisplay(uuidUrl, "hk.employer.seek.com", { name: "Cyan Yap", market: "MY" }))
      .toBe("https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=Cyan%20Yap&market=MY&pageNumber=1");
  });

  it("works without name/market options (backward compatible)", () => {
    const numUrl = "https://hk.employer.seek.com/candidates/12345";
    expect(normalizeProfileUrlForDisplay(numUrl, "hk.employer.seek.com"))
      .toBe("https://hk.employer.seek.com/candidates/12345");
  });

  it("passes roleTitles through normalizeProfileUrlForDisplay options", () => {
    const uuidUrl = "https://hk.employer.seek.com/candidates/82a5d7c6-6fb3-4960-aa78-58159b0c62d1";
    expect(normalizeProfileUrlForDisplay(uuidUrl, "hk.employer.seek.com", { name: "Kenny Low", market: "MY", roleTitles: "Sales Manager" }))
      .toBe("https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=Kenny%20Low&market=MY&pageNumber=1&roleTitles=Sales%20Manager");
  });
});
