import { describe, expect, it } from "vitest";

import { appendMissingSearchTokens, buildIngestSearchTokens, mergeSearchTextWithIngestData } from "../search_text";

describe("buildIngestSearchTokens", () => {
    it("normalizes and deduplicates ingest metadata tokens", () => {
        expect(buildIngestSearchTokens({
            industryTags: [" Machinery ", "machinery"],
            synonymHits: ["CNC", "sales engineer"],
            companyHits: ["FANUC", "fanuc"],
            companyAliasTokens: "  Fanuc 发那科  ",
        })).toEqual([
            "machinery",
            "cnc",
            "sales engineer",
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
    it("augments search text with industry tags, companies, synonyms, and aliases", () => {
        expect(mergeSearchTextWithIngestData("销售 cnc", {
            industryTags: ["machinery", "sales"],
            synonymHits: ["sales engineer", "cnc"],
            companyHits: ["fanuc"],
            companyAliasTokens: "fanuc 发那科",
        })).toBe("销售 cnc machinery sales sales engineer fanuc 发那科");
    });
});
