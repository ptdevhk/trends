import { describe, expect, it } from "vitest";

import { appendMissingSearchTokens, buildIngestSearchTokens, buildSearchText, mergeSearchTextWithIngestData } from "../search_text";

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
});
