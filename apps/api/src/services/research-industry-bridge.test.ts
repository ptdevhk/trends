import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { IndustryDataService } from "./industry-data-service.js";
import {
  displayNameCnFirst,
  listCncBridgeEntities,
  mapSurfaceToResearchCompany,
  projectBrandToBridge,
  type BridgeEntity,
} from "./research-industry-bridge.js";
import type { ResolveBrandSource } from "./industry-entity-resolve.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("research-industry-bridge pure", () => {
  const brands: ResolveBrandSource[] = [
    {
      id: 1,
      nameCn: "发那科",
      nameEn: "FANUC",
      type: "加工中心/数控车床",
      origin: "international",
    },
    {
      id: 58,
      nameCn: "创世纪",
      nameEn: "CGJ",
      type: "加工中心/数控车床",
      origin: "domestic",
    },
    {
      id: 99,
      nameCn: "非机床品牌",
      nameEn: "OTHER",
      type: "SMT/贴片",
      origin: "agent",
    },
  ];

  it("displayName is nameCn-first", () => {
    expect(displayNameCnFirst("发那科", "FANUC")).toBe("发那科 / FANUC");
    expect(displayNameCnFirst("宝力机械")).toBe("宝力机械");
  });

  it("projectBrand uses canonicalKey as companyKey (FANUC → fanuc)", () => {
    const e = projectBrandToBridge(brands[0]!);
    expect(e.companyKey).toBe("fanuc");
    expect(e.nameCn).toBe("发那科");
    expect(e.displayName.startsWith("发那科")).toBe(true);
    expect(e.cnc).toBe(true);
  });

  it("mapSurface: 发那科 / FANUC → fanuc via resolveEntity", () => {
    const a = mapSurfaceToResearchCompany("发那科", brands);
    const b = mapSurfaceToResearchCompany("FANUC", brands);
    expect(a?.companyKey).toBe("fanuc");
    expect(b?.companyKey).toBe("fanuc");
    expect(a?.source).toBe("resolveEntity");
    expect(a?.nameCn).toBe("发那科");
  });

  it("mapSurface: 宝力机械 → pro-technic-machinery (legacy override, not rename)", () => {
    const hit = mapSurfaceToResearchCompany("宝力机械", brands);
    expect(hit?.companyKey).toBe("pro-technic-machinery");
    expect(hit?.source).toBe("override");
    expect(hit?.nameCn).toBe("宝力机械");
  });

  it("mapSurface: Pro-Technic Machinery → pro-technic-machinery", () => {
    const hit = mapSurfaceToResearchCompany("Pro-Technic Machinery", brands);
    expect(hit?.companyKey).toBe("pro-technic-machinery");
  });

  it("mapSurface: 宝惠 → polywell", () => {
    const hit = mapSurfaceToResearchCompany("宝惠", brands);
    expect(hit?.companyKey).toBe("polywell");
  });

  it("mapSurface: miss returns null (no invented key)", () => {
    expect(mapSurfaceToResearchCompany("完全未知机械厂XYZ999", brands)).toBeNull();
  });

  it("listCncBridgeEntities is CNC-first and nameCn-first; includes overrides", () => {
    const list = listCncBridgeEntities(brands);
    const keys = list.map((e) => e.companyKey);
    expect(keys).toContain("pro-technic-machinery");
    expect(keys).toContain("polywell");
    expect(keys).toContain("fanuc");
    expect(keys).toContain("cgj");
    expect(keys).not.toContain("other"); // SMT excluded
    for (const e of list) {
      expect(e.nameCn.length).toBeGreaterThan(0);
      expect(e.displayName.includes(e.nameCn) || e.displayName === e.nameCn).toBe(true);
    }
  });
});

describe("research-industry-bridge with real industry-data", () => {
  const service = new IndustryDataService(repoRoot);

  it("loads real brands.json", () => {
    expect(fs.existsSync(path.join(repoRoot, "config/industry-data/brands.json"))).toBe(true);
    expect(service.loadBrands().length).toBeGreaterThan(50);
  });

  it("list CNC browse from real config includes 发那科 and 创世纪", () => {
    const brands = service.loadBrands();
    const list = listCncBridgeEntities(brands, service.loadAll().companies, { limit: 80 });
    const byKey = new Map(list.map((e: BridgeEntity) => [e.companyKey, e]));
    expect(byKey.get("fanuc")?.nameCn).toBe("发那科");
    expect(byKey.get("fanuc")?.displayName.startsWith("发那科")).toBe(true);
    expect(byKey.get("pro-technic-machinery")?.nameCn).toBe("宝力机械");
    // 创世纪
    const cgj = list.find((e) => e.nameCn.includes("创世纪"));
    expect(cgj).toBeTruthy();
    expect(cgj!.companyKey).toBeTruthy();
  });

  it("real resolve 发那科 → fanuc; 宝力机械 → pro-technic-machinery", () => {
    const brands = service.loadBrands();
    const companies = service.loadAll().companies;
    expect(mapSurfaceToResearchCompany("发那科", brands, companies)?.companyKey).toBe("fanuc");
    expect(mapSurfaceToResearchCompany("FANUC", brands, companies)?.companyKey).toBe("fanuc");
    expect(mapSurfaceToResearchCompany("宝力机械", brands, companies)?.companyKey).toBe(
      "pro-technic-machinery",
    );
  });
});
