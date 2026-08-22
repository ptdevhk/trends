import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  MachineOriginClassifier,
  fetchVerifiedCompanyProfiles,
  mapBrandOriginToMachineOrigin,
} from "./machine-origin-classifier.js";
import { IndustryDataService } from "./industry-data-service.js";
import * as convexUtils from "./convex-utils.js";

const fixtureMarkdown = `
# Industry Data

## 1. Key Companies (Key Companies)

| ID | 公司名称 (Company Name) | 英文名称 (English Name) | 类型 (Type) |
|----|------------------------|------------------------|-------------|
| 1 | 宝力机械有限公司 | | key_company |

## 2. ITES Shenzhen Industrial Exhibition Exhibitors

### 2.1 Metal Cutting Machine Tools

| ID | 公司名称 (Company Name) | 英文名称 (English Name) | 类型 (Type) |
|----|------------------------|------------------------|-------------|
| 1 | Test Exhibitor Co | | Metal Cutting |
`;

const fixtureBrands = [
  {
    id: 1,
    nameCn: "润星科技",
    nameEn: "RUNXING",
    type: "加工中心",
    origin: "domestic",
    aliases: ["润星", "广东润星"],
  },
  {
    id: 2,
    nameCn: "唯思凌科",
    nameEn: "WSLK",
    type: "加工中心",
    origin: "domestic",
    aliases: ["唯思凌科数控", "唯思凌科机床"],
  },
  {
    id: 3,
    nameCn: "丰田工机",
    nameEn: "TOYODA",
    type: "加工中心",
    origin: "international",
    familyId: "jtekt-toyoda",
    aliases: ["捷太格特", "JTEKT"],
  },
  {
    id: 4,
    nameCn: "津上",
    nameEn: "TSUGAMI",
    type: "车床",
    origin: "international",
  },
  {
    id: 5,
    nameCn: "冈本",
    nameEn: "OKAMOTO",
    type: "磨床",
    origin: "international",
  },
  {
    id: 6,
    nameCn: "三菱",
    nameEn: "MITSUBISHI",
    type: "数控系统",
    origin: "international",
  },
  {
    id: 7,
    nameCn: "测试代理商",
    nameEn: "TEST_AGENT",
    type: "代理",
    origin: "agent",
    aliases: ["测试代理"],
  },
];

const createFixtureRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "machine-origin-classifier-"));
  const dataDir = path.join(root, "config", "industry-data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "keywords-structured.md"), fixtureMarkdown);
  fs.writeFileSync(path.join(dataDir, "brands.json"), JSON.stringify(fixtureBrands, null, 2));
  return root;
};

const cleanupFixtureRoot = (root: string): void => {
  fs.rmSync(root, { recursive: true, force: true });
};

describe("MachineOriginClassifier Golden Set Tests", () => {
  it("李铛: employer 廣東潤星科技有限公司 + brandHits [津上, 岡本] (international) → domestic (Tier 2 wins over Tier 3)", () => {
    const root = createFixtureRoot();
    try {
      const industryService = new IndustryDataService(root);
      const classifier = new MachineOriginClassifier(industryService);

      const resume = {
        workHistory: [
          {
            companyName: "广东润星科技有限公司",
            jobTitle: "销售经理",
            raw: "2020-2023 广东润星科技有限公司 销售经理",
          },
        ],
        companyKeyProjection: { companyKeys: ["guangdong-runxing"] },
        ingestData: {
          brandOrigin: "international" as const, // Tier 3 would have output international from 津上, 冈本
          brandHits: [
            { brand: "tsugami", role: "sales", source: "workHistory", context: "equipment", origin: "international" as const },
            { brand: "okamoto", role: "sales", source: "workHistory", context: "equipment", origin: "international" as const },
          ],
        },
      };

      const result = classifier.classify(resume);
      expect(result.machineOrigin).toBe("domestic");
      expect(result.tier).toBe("tier2_surface");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("張武漢 / 張惠州: employer 唯思凌科 → domestic (Tier 2 brand match)", () => {
    const root = createFixtureRoot();
    try {
      const industryService = new IndustryDataService(root);
      const classifier = new MachineOriginClassifier(industryService);

      const resume = {
        workHistory: [
          {
            companyName: "唯思凌科数控设备有限公司",
            jobTitle: "应用工程师",
            raw: "唯思凌科数控设备有限公司",
          },
        ],
        companyKeyProjection: { companyKeys: ["weisi-lingke"] },
        ingestData: {
          brandOrigin: "unknown" as const,
          brandHits: [],
        },
      };

      const result = classifier.classify(resume);
      expect(result.machineOrigin).toBe("domestic");
      expect(result.tier).toBe("tier2_surface");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("謝/向/楊: employer 寶力機械 (pure company name, resolve has no origin) + brandHits [津上, 三菱] → international (Tier 3 fallback)", () => {
    const root = createFixtureRoot();
    try {
      const industryService = new IndustryDataService(root);
      const classifier = new MachineOriginClassifier(industryService);

      const resume = {
        workHistory: [
          {
            companyName: "宝力机械有限公司",
            jobTitle: "销售工程师",
            raw: "宝力机械有限公司 销售",
          },
        ],
        companyKeyProjection: { companyKeys: ["bao-li-ji-xie"] },
        ingestData: {
          brandOrigin: "international" as const,
          brandHits: [
            { brand: "tsugami", role: "sales", source: "workHistory", context: "equipment", origin: "international" as const },
            { brand: "mitsubishi", role: "sales", source: "workHistory", context: "equipment", origin: "international" as const },
          ],
        },
      };

      const result = classifier.classify(resume);
      expect(result.machineOrigin).toBe("international");
      expect(result.tier).toBe("tier3_brand_hits");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("宋: employer 捷太格特 / JTEKT → international (Tier 2 alias → TOYODA family)", () => {
    const root = createFixtureRoot();
    try {
      const industryService = new IndustryDataService(root);
      const classifier = new MachineOriginClassifier(industryService);

      const resume = {
        workHistory: [
          {
            companyName: "捷太格特机床有限公司",
            jobTitle: "技术支持",
            raw: "捷太格特机床有限公司",
          },
        ],
        companyKeyProjection: { companyKeys: ["jtekt"] },
        ingestData: {
          brandOrigin: "unknown" as const,
        },
      };

      const result = classifier.classify(resume);
      expect(result.machineOrigin).toBe("international");
      expect(result.tier).toBe("tier2_surface");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("Tier 1 override: verified profile machineOrigin=domestic + brandHits international → domestic", () => {
    const root = createFixtureRoot();
    try {
      const industryService = new IndustryDataService(root);
      const classifier = new MachineOriginClassifier(industryService);

      const verifiedMap = new Map([
        ["acme-corp", { companyKey: "acme-corp", machineOrigin: "domestic" as const }],
      ]);

      const resume = {
        workHistory: [
          {
            companyName: "捷太格特机床有限公司", // Would resolve to international in Tier 2
            raw: "捷太格特机床有限公司",
          },
        ],
        companyKeyProjection: { companyKeys: ["acme-corp"] },
        ingestData: {
          brandOrigin: "international" as const,
        },
      };

      const result = classifier.classify(resume, verifiedMap);
      expect(result.machineOrigin).toBe("domestic");
      expect(result.tier).toBe("tier1_verified");
      expect(result.matchedKey).toBe("acme-corp");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("Mixed employers (one domestic, one international, neither verified) → unknown", () => {
    const root = createFixtureRoot();
    try {
      const industryService = new IndustryDataService(root);
      const classifier = new MachineOriginClassifier(industryService);

      const resume = {
        workHistory: [
          { companyName: "广东润星科技有限公司", raw: "广东润星科技有限公司" }, // domestic
          { companyName: "捷太格特机床有限公司", raw: "捷太格特机床有限公司" }, // international
        ],
        companyKeyProjection: { companyKeys: [] },
        ingestData: {
          brandOrigin: "international" as const,
        },
      };

      const result = classifier.classify(resume);
      expect(result.machineOrigin).toBe("unknown");
      expect(result.tier).toBe("tier2_surface");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("Agent origin in Tier 2 surface resolve maps to international", () => {
    const root = createFixtureRoot();
    try {
      const industryService = new IndustryDataService(root);
      const classifier = new MachineOriginClassifier(industryService);

      const resume = {
        workHistory: [
          { companyName: "测试代理商有限公司", raw: "测试代理商有限公司" }, // origin: 'agent' -> 'international'
        ],
        companyKeyProjection: { companyKeys: [] },
        ingestData: {
          brandOrigin: "unknown" as const,
        },
      };

      const result = classifier.classify(resume);
      expect(result.machineOrigin).toBe("international");
      expect(result.tier).toBe("tier2_surface");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("fetchVerifiedCompanyProfiles handles Convex query error gracefully by failing open", async () => {
    const spy = vi.spyOn(convexUtils, "callConvexQuery").mockRejectedValueOnce(new Error("Convex query failed"));

    const profiles = await fetchVerifiedCompanyProfiles(["acme-key"]);
    expect(profiles.size).toBe(0);

    spy.mockRestore();
  });

  it("mapBrandOriginToMachineOrigin helper behaves correctly", () => {
    expect(mapBrandOriginToMachineOrigin("agent")).toBe("international");
    expect(mapBrandOriginToMachineOrigin("international")).toBe("international");
    expect(mapBrandOriginToMachineOrigin("domestic")).toBe("domestic");
    expect(mapBrandOriginToMachineOrigin("unknown")).toBeNull();
    expect(mapBrandOriginToMachineOrigin(undefined)).toBeNull();
  });
});
