import { describe, expect, it } from "vitest";

import { appendMissingSearchTokens, buildIngestSearchTokens, buildSearchText, deriveProseSearchTokens, mergeSearchTextWithIngestData, segmentChineseRuns } from "../convex/search_text";

describe("buildIngestSearchTokens", () => {
    it("normalizes and deduplicates ingest metadata tokens", () => {
        expect(buildIngestSearchTokens({
            industryTags: [" Machinery ", "machinery"],
            synonymHits: ["CNC", "sales engineer"],
            brandHits: [
                { brand: " 三菱 " },
                { brand: "三菱" },
                { brand: "MITSUBISHI" },
            ],
            companyHits: ["FANUC", "fanuc"],
            companyPatternAliasTokens: "  Fanuc 发那科 Mitsubishi 三菱  ",
        })).toEqual([
            "machinery",
            "cnc",
            "sales engineer",
            "三菱",
            "mitsubishi",
            "fanuc",
            "发那科",
        ]);
    });
});

describe("appendMissingSearchTokens", () => {
    it("adds only tokens that are not already present", () => {
        expect(appendMissingSearchTokens("sales cnc", ["cnc", "machinery", "sales engineer"])).toBe(
            "sales cnc machinery sales engineer"
        );
    });
});

describe("mergeSearchTextWithIngestData", () => {
    it("augments search text with industry tags, brands, companies, synonyms, and aliases", () => {
        expect(mergeSearchTextWithIngestData("销售 cnc 三菱", {
            industryTags: ["machinery", "sales"],
            synonymHits: ["sales engineer", "cnc"],
            brandHits: [
                { brand: "三菱" },
                { brand: "MITSUBISHI" },
            ],
            companyHits: ["fanuc"],
            companyPatternAliasTokens: "fanuc 发那科 mitsubishi 三菱",
        })).toBe("销售 cnc 三菱 machinery sales sales engineer mitsubishi fanuc 发那科");
    });
});

describe("buildSearchText", () => {
    it("uses only the latest three work history entries", () => {
        expect(buildSearchText({
            name: "Alice",
            workHistory: [
                { raw: "2018-01 ~ 2019-01 Oldest Co Old Role", startDate: "2018-01", endDate: "2019-01", companyName: "Oldest Co", jobTitle: "Old Role" },
                { raw: "2023-01 ~ 2024-01 Recent Co Recent Role", startDate: "2023-01", endDate: "2024-01", companyName: "Recent Co", jobTitle: "Recent Role" },
                { raw: "2024-02 ~ 至今 Current Co Current Role", startDate: "2024-02", endDate: "至今", companyName: "Current Co", jobTitle: "Current Role" },
                { raw: "2021-01 ~ 2022-01 Middle Co Middle Role", startDate: "2021-01", endDate: "2022-01", companyName: "Middle Co", jobTitle: "Middle Role" },
            ],
        })).toBe("alice 2024-02 ~ 至今 current co current role 2023-01 ~ 2024-01 recent co recent role 2021-01 ~ 2022-01 middle co middle role");
    });

    it("excludes raw resume snippet content from search text", () => {
        expect(buildSearchText({
            name: "Alice",
            summary: "Precision machine tool sales background",
            resumeSnippet: {
                text: "FULL RAW RESUME HEADER WITH PRIVATE CONTACT BLOCK",
            },
        })).toBe("alice precision machine tool sales background");
    });

    it("segments contiguous Chinese compounds into space-separated words while preserving original tokens", () => {
        const result = buildSearchText({ desiredPosition: "数控车床操作工" });
        // Original compound is preserved as a token
        expect(result).toContain("数控车床操作工");
        // Intl.Segmenter splits recognized word boundaries
        expect(result).toContain("车床");
        expect(result).toContain("操作");
    });

    it("preserves non-CJK text unchanged", () => {
        expect(buildSearchText({ name: "John Smith" })).toBe("john smith");
    });

    it("handles mixed CJK and ASCII text", () => {
        const result = buildSearchText({ skills: ["CNC编程", "机械设计"] });
        // ASCII boundary separated by addScriptBoundarySpaces
        expect(result).toContain("cnc");
        // Original CJK tokens preserved
        expect(result).toContain("编程");
        expect(result).toContain("机械设计");
        // Segmenter splits recognized sub-words
        expect(result).toContain("机械");
        expect(result).toContain("设计");
    });

    it("handles empty and null content without error", () => {
        expect(buildSearchText({})).toBe("");
        expect(buildSearchText(null as never)).toBe("");
    });

    it("preserves single Chinese characters", () => {
        const result = buildSearchText({ name: "张" });
        expect(result).toContain("张");
    });

    it("keeps Intl.Segmenter CJK segmentation and adds CNC/数控 domain aliases", () => {
        const result = buildSearchText({
            desiredPosition: "CNC销售工程师",
            skills: ["数控设备销售", "机床渠道开发"],
        });

        expect(result).toContain("cnc");
        expect(result).toContain("销售");
        expect(result).toContain("工程师");
        expect(result).toContain("数控");
        expect(result).toContain("机床");
    });

    it("matches CNC sales vocabulary without requiring a new tokenizer dependency", () => {
        const result = buildSearchText({
            desiredPosition: "数控销售工程师",
            summary: "负责CNC机床代理渠道和客户开发",
        });

        for (const token of ["cnc", "数控", "销售", "机床", "渠道"]) {
            expect(result).toContain(token);
        }
    });
});

describe("deriveProseSearchTokens (A3)", () => {
    it("derives jieba word tokens from selfIntro prose plus domain aliases", () => {
        const tokens = deriveProseSearchTokens(
            "十年数控车床加工中心操作经验，负责高精密零件批量生产制造，主导工艺优化与设备维护，熟悉机床操作调试与数控编程，参与五金冲压模具设计改进。",
        );

        for (const token of ["数控车床", "加工", "机床", "调试", "数控", "编程", "五金", "冲压", "模具"]) {
            expect(tokens).toContain(token);
        }
        // Domain aliases derived from the prose
        expect(tokens).toContain("cnc");
        expect(tokens).toContain("machine tool");
        // Punctuation / single-char tokens are dropped
        expect(tokens.some((token) => /[，。、]/.test(token))).toBe(false);
        expect(tokens.includes("与")).toBe(false);
    });

    it("keeps ASCII/alnum tokens from mixed prose", () => {
        const tokens = deriveProseSearchTokens("ISO9001品质管理经验");
        expect(tokens).toContain("iso");
        expect(tokens).toContain("9001");
        expect(tokens).toContain("品质");
    });

    it("returns [] for empty and undefined input", () => {
        expect(deriveProseSearchTokens(undefined)).toEqual([]);
        expect(deriveProseSearchTokens("")).toEqual([]);
    });

    it("bounds dense-overlap prose (工程师×20) sub-second", () => {
        const startedAt = Date.now();
        const tokens = deriveProseSearchTokens("工程师".repeat(20));
        expect(Date.now() - startedAt).toBeLessThan(1000);
        expect(tokens).toContain("工程师");
    });
});

describe("segmentChineseRuns (A4 jieba augmentation)", () => {
    it("adds jieba word tokens that Intl.Segmenter fragments into single chars", () => {
        const tokens = segmentChineseRuns("数控编程").split(/\s+/g);
        // Full run token preserved
        expect(tokens).toContain("数控编程");
        // Jieba words that Intl splits into single chars
        expect(tokens).toContain("数控");
        expect(tokens).toContain("编程");
    });

    it("bounds dense-overlap runs so doSegment stays sub-second (chunked)", () => {
        // DictTokenizer.getChunks enumerates all chunkings; 60 chars of
        // overlapping dict matches took ~5 s unchunked. Chunking must keep
        // this fast while preserving the word tokens.
        const startedAt = Date.now();
        const tokens = segmentChineseRuns("工程师".repeat(20)).split(/\s+/g);
        expect(Date.now() - startedAt).toBeLessThan(1000);
        expect(tokens).toContain("工程师");
    });
});
