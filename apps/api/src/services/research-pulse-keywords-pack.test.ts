import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import {
  loadResearchPulseKeywordsSeed,
  parseResearchPulseKeywordsSeed,
  PULSE_CATALOG_GROUP_ID,
  type PulseKeywordsSeed,
} from "./research-pulse-keywords-pack.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../");

/**
 * normalizeKey mirrors apps/web normalizeKey + mergePulseKeywords identity:
 * trim + NFKC; Latin lowercased.
 */
function nKey(k: string): string {
  return k.trim().normalize("NFKC").replace(/[A-Za-z]+/g, (m) => m.toLowerCase());
}

/** Exact-token membership (the same identity the default filter uses). */
function hasExact(keywords: string[], token: string): boolean {
  return keywords.some((k) => nKey(k) === nKey(token));
}

describe("research-pulse-keywords-pack new groups", () => {
  it("loads real seed containing the original 3 groups plus the 6 new industry tag groups", () => {
    const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);
    const groupIds = seed.groups.map((g) => g.id);

    // Original 3 groups
    expect(groupIds).toContain("cnc-core");
    expect(groupIds).toContain("brands");
    expect(groupIds).toContain("hiring-sales");

    // 6 new precision-machinery groups
    expect(groupIds).toContain("machining");
    expect(groupIds).toContain("lathe");
    expect(groupIds).toContain("edm");
    expect(groupIds).toContain("measurement");
    expect(groupIds).toContain("smt");
    expect(groupIds).toContain("3d-printing");

    // The 9 YAML groups plus the runtime industry-catalog group. Assert the ids
    // (content) rather than a bare count, which any catalog edit would break.
    expect(groupIds).toContain(PULSE_CATALOG_GROUP_ID);
    expect(seed.groups.length).toBe(groupIds.length);
    expect(new Set(groupIds).size).toBe(groupIds.length);
  });

  it("enables ALL tag categories in defaults (no longer frozen to 3 groups)", () => {
    const rawYaml = readFileSync(resolve(REPO_ROOT, "config/research_pulse_keywords.yaml"), "utf8");
    const doc = parseYaml(rawYaml) as Record<string, unknown>;
    const defaults = doc.defaults as Record<string, unknown>;

    // Every precision-machinery tag category plus the curated cnc-core/brands/hiring-sales
    expect(defaults.enabledGroupIds).toEqual([
      "cnc-core",
      "brands",
      "hiring-sales",
      "machining",
      "lathe",
      "edm",
      "measurement",
      "smt",
      "3d-printing",
    ]);

    // parse-level defaultKeywords must now include terms from the newly-enabled groups
    const parsed = parseResearchPulseKeywordsSeed(doc);
    expect(parsed.defaultKeywords).toContain("三坐标");
    expect(parsed.defaultKeywords).toContain("贴片机");
    expect(parsed.defaultKeywords).toContain("增材制造");

    // load-level defaultKeywords further augments with brand + company surfaces (runtime union)
    const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);
    for (const kw of parsed.defaultKeywords) {
      // every parse-level default keyword is still present at load level
      expect(seed.defaultKeywords).toContain(kw);
    }
  });

  it("load-level defaults include brand + company catalog surfaces (runtime union)", () => {
    const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);

    // A brand surface from brands.json (发那科 is nameCn; also MAZAK-style EN)
    expect(seed.defaultKeywords).toContain("发那科");

    // A company name from keywords-structured.md Key Companies
    expect(seed.defaultKeywords).toContain("大富科技股份有限公司");

    // The union must actually be exercised: the parse-level (YAML-only) defaults
    // do NOT contain catalog-only surfaces, so this fails if the runtime-union
    // code path is deleted or the catalog read silently degrades to empty.
    const parsedOnly = parseResearchPulseKeywordsSeed(
      parseYaml(readFileSync(resolve(REPO_ROOT, "config/research_pulse_keywords.yaml"), "utf8")),
    );
    expect(parsedOnly.defaultKeywords).not.toContain("大富科技股份有限公司");
    expect(seed.defaultKeywords.length).toBeGreaterThan(parsedOnly.defaultKeywords.length * 2);
  });

  it("catalog terms are present and MAX_KEYWORD_LENGTH is honored", () => {
    const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);
    // 三坐标 is industry taxonomy here (measurement), NOT the HR profile query
    expect(seed.defaultKeywords).toContain("三坐标");
    for (const kw of seed.defaultKeywords) {
      expect([...kw].length).toBeLessThanOrEqual(32);
    }
  });

  it("HR search-box terms stay HR-only (not folded into research pulse)", () => {
    const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);
    // The HR CMM combined profile query is 三坐标 / 3D扫描 / 销售. Of those, only
    // 三坐标 is industry taxonomy; 3D扫描 and 销售 must NOT leak into the research catalog.
    expect(seed.defaultKeywords).toContain("三坐标");
    expect(seed.defaultKeywords).not.toContain("3D扫描");
    expect(seed.defaultKeywords).not.toContain("销售");
  });

  describe("owner decision 2026-09-19 exclude_conglomerates_keep_cnc", () => {
    const DROP_TOKENS = [
      "三菱",
      "松下",
      "西门子",
      "东芝",
      "雅马哈",
      "富士",
      "西部",
      "兄弟",
      "山善",
      "海能达",
      "智赢",
      "日东",
      "领方",
      "丰创",
    ];
    // English / alias surfaces attached to the SAME dropped entity in brands.json
    const DROP_ALIASES = [
      "MITSUBISHI",
      "PANASONIC",
      "SIEMENS",
      "TOSHIBA",
      "YAMAHA",
      "FUJI",
      "SEIBU",
      "BROTHER",
      "Brother Industries",
    ];
    const KEEP_TOKENS = [
      "创世纪",
      "台群",
      "思瑞",
      "精雕",
      "台正",
      "汉川",
      "友佳",
      "三坐标",
      "招聘",
      "扩产",
      "中标",
      "采购",
      "订单",
      "签约",
      "发那科",
      "马扎克",
      "牧野",
    ];

    function loadSeed(): PulseKeywordsSeed {
      return loadResearchPulseKeywordsSeed(REPO_ROOT);
    }

    it("drops every conglomerate/short token from defaultKeywords (exact-token, default-only)", () => {
      const seed = loadSeed();
      for (const token of DROP_TOKENS) {
        expect(hasExact(seed.defaultKeywords, token), `${token} must be dropped from defaults`).toBe(
          false,
        );
      }
    });

    it("drops English/alias surfaces of the same dropped entities from defaultKeywords", () => {
      const seed = loadSeed();
      for (const alias of DROP_ALIASES) {
        expect(hasExact(seed.defaultKeywords, alias), `${alias} must be dropped from defaults`).toBe(
          false,
        );
      }
    });

    it("keeps precision CNC / keyword-tags / hiring-sales defaults", () => {
      const seed = loadSeed();
      for (const token of KEEP_TOKENS) {
        expect(hasExact(seed.defaultKeywords, token), `${token} must stay in defaults`).toBe(true);
      }
    });

    it("uses exact-token match only — catalog records that merely contain a drop token survive", () => {
      const seed = loadSeed();
      // 创世纪 survives (shares characters with the dropped set); the long company
      // records for 山善/日东 survive as distinct names (their short forms are dropped).
      for (const record of ["深圳市创世纪机械有限公司", "创世纪机床", "广东创世纪", "浙江台正机床有限公司"]) {
        expect(seed.defaultKeywords).toContain(record);
      }
      // These contain a drop token as a substring but are NOT the dropped token.
      expect(seed.defaultKeywords).toContain("山善（深圳）贸易有限公司");
      expect(seed.defaultKeywords).toContain("日东（上海）机械技术中心有限公司");
    });

    it("keeps every dropped surface in a re-enable source (catalog group + enabled overlay)", () => {
      const seed = loadSeed();
      const catalogGroup = seed.groups.find((g) => g.id === PULSE_CATALOG_GROUP_ID);
      expect(catalogGroup).toBeDefined();
      for (const token of [...DROP_TOKENS, ...DROP_ALIASES]) {
        expect(
          seed.groups.some((g) => hasExact(g.keywords, token)),
          `${token} must remain present in a group (re-enable source)`,
        ).toBe(true);
      }
      // Dropped tokens are absent from defaultKeywords but present in the catalog group.
      for (const token of DROP_TOKENS) {
        expect(hasExact(catalogGroup!.keywords, token)).toBe(true);
      }
    });

    it("does not touch the underlying catalog (brands.json / keyword-tags.json)", () => {
      const brands = JSON.parse(
        readFileSync(resolve(REPO_ROOT, "config/industry-data/brands.json"), "utf8"),
      ) as Array<{ nameCn: string; nameEn?: string; aliases?: string[] }>;
      for (const token of ["三菱", "松下", "西门子", "东芝", "雅马哈", "富士", "西部", "兄弟"]) {
        expect(brands.some((b) => b.nameCn === token), `${token} stays in brands.json`).toBe(true);
      }
      // 兄弟's alias list is intact too (BROTHER / Brother Industries still re-enableable).
      const brother = brands.find((b) => b.nameCn === "兄弟")!;
      expect(brother.nameEn).toBe("BROTHER");
      expect(brother.aliases).toEqual(expect.arrayContaining(["Brother Industries"]));

      // keyword-tags.json categories are untouched: the YAML groups still mirror it 1:1
      // and none of the dropped conglomerate tokens were ever tag-category terms.
      const tagsJson = JSON.parse(
        readFileSync(resolve(REPO_ROOT, "config/industry-data/keyword-tags.json"), "utf8"),
      );
      const tagKeywords = Object.values(tagsJson.tags as Record<string, Array<{ keyword: string }>>)
        .flat()
        .map((e) => e.keyword);
      for (const token of DROP_TOKENS) {
        expect(tagKeywords).not.toContain(token);
      }
      const parsed = parseResearchPulseKeywordsSeed(
        parseYaml(readFileSync(resolve(REPO_ROOT, "config/research_pulse_keywords.yaml"), "utf8")),
      );
      // Every tag-category term is still a default keyword (only the drop list is filtered).
      for (const kw of tagKeywords) {
        expect(parsed.defaultKeywords).toContain(kw);
      }
      // Only defaultKeywords is filtered — excludedKeywords is a separate YAML list.
      expect(parsed.excludedKeywords).toContain("三菱");
    });

    it("surfaces the drop list on the seed so clients can distinguish defaults from exclusions", () => {
      const seed = loadSeed();
      expect(seed.excludedKeywords).toEqual(
        expect.arrayContaining(["三菱", "山善", "Brother Industries"]),
      );
      // Every excluded token is a real catalog surface (not a typo) …
      for (const token of seed.excludedKeywords) {
        expect(hasExact(seed.groups.flatMap((g) => g.keywords), token)).toBe(true);
      }
    });
  });

  it("verifies all keywords in new groups are non-empty strings and within MAX_KEYWORD_LENGTH", () => {
    const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);
    const newGroupIds = ["machining", "lathe", "edm", "measurement", "smt", "3d-printing"];

    for (const gid of newGroupIds) {
      const group = seed.groups.find((g) => g.id === gid);
      expect(group).toBeDefined();
      expect(group!.label.length).toBeGreaterThan(0);
      expect(group!.keywords.length).toBeGreaterThan(0);

      for (const kw of group!.keywords) {
        expect(typeof kw).toBe("string");
        expect(kw.trim().length).toBeGreaterThan(0);
        expect(kw.trim().length).toBeLessThanOrEqual(32);
      }
    }
  });

  it("matches keywords from keyword-tags.json dataset", () => {
    const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);
    const tagsJson = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "config/industry-data/keyword-tags.json"), "utf8"),
    );

    const checkMapping: Array<{ pulseId: string; tagKey: string }> = [
      { pulseId: "machining", tagKey: "machining" },
      { pulseId: "lathe", tagKey: "lathe" },
      { pulseId: "edm", tagKey: "edm" },
      { pulseId: "measurement", tagKey: "measurement" },
      { pulseId: "smt", tagKey: "smt" },
      { pulseId: "3d-printing", tagKey: "3d_printing" },
    ];

    for (const { pulseId, tagKey } of checkMapping) {
      const group = seed.groups.find((g) => g.id === pulseId)!;
      const expectedKeywords = tagsJson.tags[tagKey].map((e: { keyword: string }) => e.keyword);
      expect(group.keywords).toEqual(expectedKeywords);
      // Every tag-category term is now part of the effective default set
      for (const kw of expectedKeywords) {
        expect(seed.defaultKeywords).toContain(kw);
      }
    }
  });
});
