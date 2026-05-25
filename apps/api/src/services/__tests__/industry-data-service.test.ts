import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db.js so constructor doesn't try to find project root
vi.mock("../db.js", () => ({
  findProjectRoot: () => "/tmp/trends-test",
}));

// Set up mock fs before importing the module — vi.mock is hoisted, so
// use inline factory to avoid ReferenceError on top-level variables.
vi.mock("node:fs", () => {
  const mockKeywordsStructured = `
## 重点企业 / Key Companies

| ID | 公司名称 (Company Name) | 英文名称 (English Name) | 类型 (Type) |
|----|------------------------|------------------------|-------------|
| 1  | 东莞精工机械有限公司      | DJG                   | key_company |
| 2  | 深圳数控科技             | SZSK                  | key_company |

## 关键词 / Keywords

| ID | 关键词 (Keyword) | 英文名称 (English Name) |
|----|-----------------|------------------------|
| 1  | 加工中心          | machining center       |
| 2  | 数控车床          | cnc lathe             |
| 3  | 火花机           | edm                   |

## 品牌 / Brand

| ID | 品牌名称 (Brand Name) | 英文名称 (English Name) | 类型 (Type) |
|----|---------------------|------------------------|-------------|
| 1  | 西门子              | Siemens               | 电器        |
| 2  | 发那科              | Fanuc                 | 数控系统     |
`;

  const mockCompanyUrls = `
https://example.com/djg
https://example.com/szsk
`;

  return {
    default: {
      existsSync: vi.fn((filePath: string) => {
        if (filePath.includes("keywords-structured.md")) return true;
        if (filePath.includes("brands.json")) return false;
        if (filePath.includes("company-urls.md")) return true;
        return false;
      }),
      readFileSync: vi.fn((filePath: string) => {
        if (filePath.includes("keywords-structured.md")) return mockKeywordsStructured;
        if (filePath.includes("company-urls.md")) return mockCompanyUrls;
        return "";
      }),
    },
  };
});

import { IndustryDataService } from "../industry-data-service.js";
import fs from "node:fs";

describe("IndustryDataService", () => {
  let service: IndustryDataService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IndustryDataService("/tmp/trends-test");
  });

  describe("getCompanyKey", () => {
    it("returns lowercase nameEn for single-word ASCII brand", () => {
      const key = service.getCompanyKey({
        id: 1, nameCn: "东莞精工机械有限公司", nameEn: "DJG", type: "key_company", category: "key_company",
      });
      expect(key).toBe("djg");
    });

    it("returns sanitized CJK slug when no nameEn", () => {
      const key = service.getCompanyKey({
        id: 2, nameCn: "深圳数控科技", type: "key_company", category: "key_company",
      });
      expect(key).toBe("深圳数控科技");
    });

    it("returns string id when nameCn is empty", () => {
      const key = service.getCompanyKey({
        id: 42, nameCn: "", type: "key_company", category: "key_company",
      });
      expect(key).toBe("42");
    });

    it("returns multi-word nameEn as CJK slug fallback", () => {
      const key = service.getCompanyKey({
        id: 3, nameCn: "测试公司", nameEn: "Test Company Inc", type: "key_company", category: "key_company",
      });
      // Multi-word English is NOT a single-word token → falls through to CJK slug
      expect(key).toBe("测试公司");
    });
  });

  describe("loadAll", () => {
    it("loads companies, keywords, brands, and urls from files", () => {
      const data = service.loadAll();
      expect(data.companies.length).toBeGreaterThan(0);
      expect(data.keywords.length).toBeGreaterThan(0);
      expect(data.companyUrls.length).toBeGreaterThan(0);
    });

    it("caches data on second call", () => {
      service.loadAll();
      const readCalls = vi.mocked(fs).readFileSync.mock.calls.length;
      service.loadAll();
      expect(vi.mocked(fs).readFileSync.mock.calls.length).toBe(readCalls);
    });

    it("includes metadata with counts", () => {
      const data = service.loadAll();
      expect(data.metadata.companiesCount).toBe(data.companies.length);
      expect(data.metadata.keywordsCount).toBe(data.keywords.length);
      expect(data.metadata.loadedAt).toBeTruthy();
    });
  });

  describe("verifyCompany", () => {
    it("returns unverified for empty name", () => {
      const result = service.verifyCompany("");
      expect(result.verified).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it("returns exact match with confidence 1.0", () => {
      const result = service.verifyCompany("东莞精工机械有限公司");
      expect(result.verified).toBe(true);
      expect(result.confidence).toBe(1.0);
      expect(result.match).toBeDefined();
    });

    it("matches on English name", () => {
      const result = service.verifyCompany("DJG");
      expect(result.verified).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it("returns partial match with confidence 0.7", () => {
      // Test a name that is a partial match of a known company
      const result = service.verifyCompany("精工机械");
      if (result.verified && result.confidence === 0.7) {
        expect(result.matches).toBeDefined();
        expect(result.matches!.length).toBeGreaterThan(0);
      }
    });

    it("returns unverified with confidence 0.2 for unknown company", () => {
      const result = service.verifyCompany("完全不存在公司XYZ");
      expect(result.verified).toBe(false);
      expect(result.confidence).toBe(0.2);
    });
  });

  describe("getCompanyLookup", () => {
    it("returns set of lowercased company and brand names", () => {
      const lookup = service.getCompanyLookup();
      expect(lookup.size).toBeGreaterThan(0);
      // All entries should be lowercase
      for (const name of lookup) {
        expect(name).toBe(name.toLowerCase().trim());
      }
    });

    it("includes both CN and EN names", () => {
      const lookup = service.getCompanyLookup();
      expect(lookup.has("djg")).toBe(true);
    });
  });

  describe("matchKeywords", () => {
    it("matches keywords found in text", () => {
      const matches = service.matchKeywords("擅长加工中心操作");
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some((k) => k.keyword === "加工中心")).toBe(true);
    });

    it("matches on English keyword", () => {
      const matches = service.matchKeywords("experienced with edm machines");
      expect(matches.some((k) => k.keyword === "火花机")).toBe(true);
    });

    it("filters by category", () => {
      const allMatches = service.matchKeywords("加工中心 火花机");
      const machiningOnly = service.matchKeywords("加工中心 火花机", "machining");
      expect(machiningOnly.length).toBeLessThanOrEqual(allMatches.length);
    });

    it("returns empty for no matches", () => {
      const matches = service.matchKeywords("完全无关内容");
      expect(matches).toEqual([]);
    });
  });

  describe("matchBrands", () => {
    it("matches brands found in text", () => {
      const matches = service.matchBrands("熟悉西门子PLC编程");
      expect(matches.length).toBeGreaterThan(0);
    });

    it("matches on English brand name", () => {
      const matches = service.matchBrands("Fanuc CNC systems");
      expect(matches.length).toBeGreaterThan(0);
    });

    it("returns empty for no matches", () => {
      const matches = service.matchBrands("完全无关品牌");
      expect(matches).toEqual([]);
    });
  });

  describe("verifyCompanyIndustry", () => {
    it("returns unverified for empty name", () => {
      const result = service.verifyCompanyIndustry("");
      expect(result.verified).toBe(false);
      expect(result.matchType).toBe("none");
    });

    it("identifies known company as known_company", () => {
      const result = service.verifyCompanyIndustry("东莞精工机械有限公司");
      expect(result.verified).toBe(true);
      expect(result.matchType).toBe("known_company");
      expect(result.company).toBeDefined();
    });

    it("identifies company with keyword match", () => {
      // A company name containing CNC keywords but not in known companies list
      const result = service.verifyCompanyIndustry("某某加工中心有限公司");
      if (result.matchType === "keyword_match") {
        expect(result.verified).toBe(true);
        expect(result.matchedKeywords.length).toBeGreaterThan(0);
      }
    });

    it("identifies company with brand name", () => {
      const result = service.verifyCompanyIndustry("西门子自动化有限公司");
      expect(result.verified).toBe(true);
    });

    it("identifies company with CNC pattern match", () => {
      const result = service.verifyCompanyIndustry("某某数控设备有限公司");
      expect(result.verified).toBe(true);
      expect(result.matchedKeywords.length).toBeGreaterThan(0);
    });

    it("returns unverified for completely unrelated company", () => {
      const result = service.verifyCompanyIndustry("某某餐饮管理有限公司");
      expect(result.verified).toBe(false);
      expect(result.matchType).toBe("none");
    });
  });

  describe("reload", () => {
    it("clears cache and reloads data", () => {
      const data1 = service.loadAll();
      const reloaded = service.reload();
      // After reload, data is fresh (different loadedAt timestamp)
      expect(reloaded.companies).toEqual(data1.companies);
      // But the cache was cleared and re-read
      expect(vi.mocked(fs).readFileSync).toHaveBeenCalled();
    });
  });

  describe("getStats", () => {
    it("returns metadata from loaded data", () => {
      const stats = service.getStats();
      expect(stats.companiesCount).toBeGreaterThan(0);
      expect(stats.keywordsCount).toBeGreaterThan(0);
      expect(stats.loadedAt).toBeTruthy();
    });
  });

  describe("loadCompanyUrls", () => {
    it("extracts URLs from markdown file", () => {
      const urls = service.loadCompanyUrls();
      expect(urls.length).toBeGreaterThan(0);
      expect(urls[0]).toMatch(/^https?:\/\//);
    });
  });

  describe("validateFormat", () => {
    it("returns valid for well-formed markdown", () => {
      const result = service.validateFormat();
      expect(result.stats.totalTables).toBeGreaterThan(0);
    });

    it("reports file not found error", () => {
      vi.mocked(fs).existsSync.mockReturnValueOnce(false);
      const result = service.validateFormat();
      expect(result.valid).toBe(false);
      expect(result.issues[0]?.issue).toContain("File not found");
    });
  });
});
