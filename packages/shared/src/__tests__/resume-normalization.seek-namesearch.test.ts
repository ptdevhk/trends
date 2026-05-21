import { describe, expect, it } from "vitest";
import { buildSeekNameSearchUrl, inferSeekMarket } from "../resume-normalization";

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
