import { describe, expect, it } from "vitest";

import { appendMissingSearchTokens, buildIngestSearchTokens, mergeSearchTextWithIngestData } from "../search_text";

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
