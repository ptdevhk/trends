import { describe, expect, it } from "vitest";

import {
  formatLocationHierarchyLabel,
  formatLocationHierarchySearchText,
  findLocation,
  getAllDescendants,
  getChildren,
  isLocationMatch,
  normalizeLocationHierarchy,
  normalizeLocationName,
  resolveLocationHierarchy,
} from "../location-tree";

describe("location-tree", () => {
  it("normalizes common administrative suffixes", () => {
    expect(normalizeLocationName("东莞市")).toBe("东莞");
    expect(normalizeLocationName("南城区")).toBe("南城");
    expect(normalizeLocationName("浦东新区")).toBe("浦东");
    expect(normalizeLocationName("中国")).toBe("中国");
  });

  it("finds location by alias and compound text", () => {
    expect(findLocation("东莞市")?.name).toBe("东莞");
    expect(findLocation("东莞南城区")?.name).toBe("南城");
    expect(findLocation("江苏省苏州市昆山市")?.name).toBe("昆山");
  });

  it("returns children and descendants in hierarchy order", () => {
    const children = getChildren("广东").map((node) => node.name);
    expect(children).toContain("东莞");
    expect(children).toContain("深圳");

    const descendants = getAllDescendants("广东").map((node) => node.name);
    expect(descendants).toContain("南城");
    expect(descendants).toContain("长安");
  });

  it("matches exact and suffix variants", () => {
    expect(isLocationMatch("东莞", "东莞")).toBe(true);
    expect(isLocationMatch("东莞市", "东莞")).toBe(true);
  });

  it("matches descendants when filtering by ancestor", () => {
    expect(isLocationMatch("东莞市", "广东")).toBe(true);
    expect(isLocationMatch("东莞南城区", "广东")).toBe(true);
    expect(isLocationMatch("昆山市", "江苏")).toBe(true);
    expect(isLocationMatch("昆山市", "苏州")).toBe(true);
  });

  it("resolves China-rooted hierarchies with city-level canonical labels", () => {
    const hierarchy = resolveLocationHierarchy("东莞长安镇");
    expect(hierarchy).toEqual(expect.objectContaining({
      country: "中国",
      province: "广东",
      city: "东莞",
      confidence: "high",
    }));
    expect(formatLocationHierarchyLabel(hierarchy)).toBe("广东东莞");
    expect(formatLocationHierarchySearchText(hierarchy)).toBe("中国 广东 东莞");
    expect(normalizeLocationHierarchy(hierarchy)).toEqual(hierarchy);
    expect(resolveLocationHierarchy("石碣镇")?.city).toBe("东莞");
  });

  it("rejects conflicting sibling locations", () => {
    expect(resolveLocationHierarchy("东莞深圳")).toBeUndefined();
  });

  it("does not match non-descendant branches", () => {
    expect(isLocationMatch("深圳市", "东莞")).toBe(false);
    expect(isLocationMatch("广东", "东莞")).toBe(false);
  });

  it("supports seeded Malaysia and Kuala Lumpur aliases", () => {
    expect(findLocation("Kuala Lumpur MY")?.name).toBe("Kuala Lumpur");
    expect(findLocation("Kuala Lumpur, Malaysia")?.name).toBe("Kuala Lumpur");
    expect(isLocationMatch("Kuala Lumpur, Malaysia", "Kuala Lumpur MY")).toBe(true);
    expect(isLocationMatch("Kuala Lumpur", "Malaysia")).toBe(true);
  });
});
