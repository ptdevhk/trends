import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { IndustryDataService } from "./industry-data-service.js";
import {
  brandsInFamily,
  resolveEntity,
  type ResolveBrandSource,
} from "./industry-entity-resolve.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("resolveEntity pure", () => {
  const brands: ResolveBrandSource[] = [
    {
      id: 70,
      nameCn: "乔锋",
      nameEn: "QIAOFENG",
      type: "加工中心",
      origin: "domestic",
      aliases: ["乔锋智能"],
    },
    {
      id: 16,
      nameCn: "丰田工机",
      nameEn: "TOYODA",
      type: "加工中心",
      origin: "international",
      familyId: "jtekt-toyoda",
      aliases: ["捷太格特", "JTEKT"],
    },
  ];

  it("resolves exact brand CN", () => {
    const r = resolveEntity("乔锋", brands);
    expect(r.matchTier).toBe("exact");
    expect(r.origin).toBe("domestic");
    expect(r.canonicalKey).toBe("qiaofeng");
  });

  it("resolves alias to same family brand", () => {
    const r = resolveEntity("捷太格特", brands);
    expect(r.matchTier).toBe("alias");
    expect(r.familyId).toBe("jtekt-toyoda");
    expect(r.canonicalKey).toBe("toyoda");
  });

  it("returns miss for unknown surface", () => {
    const r = resolveEntity("完全未知机械厂XYZ", brands);
    expect(r.matchTier).toBe("miss");
  });
});

describe("IndustryDataService.resolveEntity goldens (real config)", () => {
  const service = new IndustryDataService(repoRoot);

  it("loads brands.json from real project root", () => {
    expect(fs.existsSync(path.join(repoRoot, "config/industry-data/brands.json"))).toBe(true);
    expect(service.loadBrands().length).toBeGreaterThan(50);
  });

  const domesticSurfaces = [
    "乔锋",
    "乔锋智能装备股份有限公司",
    "创世纪",
    "蕙勒",
    "唯思凌科",
  ];

  for (const surface of domesticSurfaces) {
    it(`domestic OEM surface "${surface}" → origin=domestic`, () => {
      const r = service.resolveEntity(surface);
      expect(r.matchTier).not.toBe("miss");
      expect(r.origin).toBe("domestic");
    });
  }

  const jtektSurfaces = ["捷太格特", "JTEKT", "丰田工机", "TOYODA", "捷太格特机床"];

  it("JTEKT cluster surfaces share familyId jtekt-toyoda", () => {
    const familyIds = new Set<string>();
    for (const surface of jtektSurfaces) {
      const r = service.resolveEntity(surface);
      expect(r.matchTier).not.toBe("miss");
      expect(r.familyId).toBe("jtekt-toyoda");
      familyIds.add(r.familyId!);
      // international origin for the family
      expect(r.origin).toBe("international");
    }
    expect(familyIds.size).toBe(1);
  });

  it("brandsInFamily returns multiple TOYODA-cluster aliases from config", () => {
    const brands = service.loadBrands();
    const family = brandsInFamily(brands, "jtekt-toyoda");
    expect(family.length).toBeGreaterThanOrEqual(1);
    const surfaces = family.flatMap((b) => [b.nameCn, b.nameEn, ...(b.aliases ?? [])]);
    expect(surfaces.some((s) => s && /捷太格特|JTEKT|TOYODA|丰田工机/i.test(s))).toBe(true);
  });

  const sellSurfaces: Array<{ surface: string; expectKey: string }> = [
    { surface: "BROTHER", expectKey: "brother" },
    { surface: "兄弟", expectKey: "brother" },
    { surface: "STAR", expectKey: "star" },
    { surface: "ZEISS", expectKey: "zeiss" },
    { surface: "蔡司", expectKey: "zeiss" },
    { surface: "SHIBAURA", expectKey: "shibaura" },
    { surface: "芝浦", expectKey: "shibaura" },
    { surface: "Shibaura Machine", expectKey: "shibaura" },
  ];

  for (const { surface, expectKey } of sellSurfaces) {
    it(`sell brand "${surface}" resolves with usable key ~${expectKey}`, () => {
      const r = service.resolveEntity(surface);
      expect(r.matchTier).not.toBe("miss");
      expect(r.canonicalKey.toLowerCase()).toContain(expectKey.slice(0, 4));
      expect(r.origin).toBe("international");
    });
  }

  it("resolveWithUnresolvedHint emits miss event offline", () => {
    const { resolved, unresolved } = service.resolveWithUnresolvedHint(
      "某某未知机床厂12345",
      72
    );
    expect(resolved.matchTier).toBe("miss");
    expect(unresolved).toBeDefined();
    expect(unresolved!.reason).toBe("miss");
    expect(unresolved!.nearbyScore).toBe(72);
    expect(unresolved!.normalizedKey.length).toBeGreaterThan(0);
  });

  it("known hit does not emit unresolved", () => {
    const { resolved, unresolved } = service.resolveWithUnresolvedHint("FANUC");
    expect(resolved.matchTier).toBe("exact");
    expect(unresolved).toBeUndefined();
  });
});
