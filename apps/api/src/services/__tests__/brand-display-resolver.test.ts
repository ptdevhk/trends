import { describe, it, expect } from "vitest";
import {
  hasChinese,
  pickPreferredZhHansFromAliases,
  brandEntryToDisplay,
} from "../brand-display-resolver.js";
import type { BrandEntry } from "../industry-data-service.js";

describe("hasChinese", () => {
  it("returns true for Chinese characters", () => {
    expect(hasChinese("精雕")).toBe(true);
    expect(hasChinese("德马吉森精机")).toBe(true);
  });

  it("returns true for mixed Chinese and ASCII", () => {
    expect(hasChinese("北京精雕 BJJD")).toBe(true);
  });

  it("returns false for ASCII only", () => {
    expect(hasChinese("DMG MORI")).toBe(false);
    expect(hasChinese("hello")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(hasChinese("")).toBe(false);
  });

  it("returns false for Japanese katakana only", () => {
    expect(hasChinese("カタカナ")).toBe(false);
  });

  it("returns false for numbers and symbols", () => {
    expect(hasChinese("123!@#")).toBe(false);
  });
});

describe("pickPreferredZhHansFromAliases", () => {
  it("returns the shortest Chinese alias", () => {
    const result = pickPreferredZhHansFromAliases(["北京精雕", "精雕"]);
    expect(result).toBe("精雕");
  });

  it("returns the only Chinese alias", () => {
    const result = pickPreferredZhHansFromAliases(["DMG", "德马吉"]);
    expect(result).toBe("德马吉");
  });

  it("returns null when no Chinese aliases", () => {
    const result = pickPreferredZhHansFromAliases(["DMG", "MORI"]);
    expect(result).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(pickPreferredZhHansFromAliases([])).toBeNull();
  });

  it("trims whitespace from aliases", () => {
    const result = pickPreferredZhHansFromAliases(["  精雕  "]);
    expect(result).toBe("精雕");
  });

  it("filters out empty/whitespace-only aliases", () => {
    const result = pickPreferredZhHansFromAliases(["", "  ", "精雕"]);
    expect(result).toBe("精雕");
  });

  it("prefers shorter Chinese alias even when longer appears first", () => {
    const result = pickPreferredZhHansFromAliases(["德马吉森精机", "德马吉"]);
    expect(result).toBe("德马吉");
  });
});

describe("brandEntryToDisplay", () => {
  it("uses nameEn as displayName when present", () => {
    const brand: BrandEntry = { id: 1, nameCn: "精雕", nameEn: "JingDiao", type: "default", origin: "international" };
    const result = brandEntryToDisplay(brand);
    expect(result.displayName).toBe("JingDiao");
    expect(result.zhHans).toBe("精雕");
  });

  it("falls back to nameCn when nameEn is empty", () => {
    const brand: BrandEntry = { id: 1, nameCn: "精雕", nameEn: "", type: "default", origin: "international" };
    const result = brandEntryToDisplay(brand);
    expect(result.displayName).toBe("精雕");
    expect(result.zhHans).toBe("精雕");
  });

  it("falls back to nameCn when nameEn is whitespace", () => {
    const brand: BrandEntry = { id: 1, nameCn: "精雕", nameEn: "  ", type: "default", origin: "international" };
    const result = brandEntryToDisplay(brand);
    expect(result.displayName).toBe("精雕");
  });

  it("trims nameCn for zhHans", () => {
    const brand: BrandEntry = { id: 1, nameCn: "  精雕  ", nameEn: "JingDiao", type: "default", origin: "international" };
    const result = brandEntryToDisplay(brand);
    expect(result.zhHans).toBe("精雕");
  });
});
