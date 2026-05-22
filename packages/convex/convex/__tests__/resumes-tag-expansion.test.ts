import { describe, expect, it } from "vitest";

import {
    buildTagExpansionSearchQuery,
    collectSearchTextProvenance,
    matchesTagExpansionSearchText,
} from "../resumes";

const keywordGroups = [
    {
        original: "销售",
        variants: ["销售", "业务", "商务", "sales"],
    },
    {
        original: "cnc",
        variants: ["cnc"],
    },
];

describe("buildTagExpansionSearchQuery", () => {
    it("uses the narrowest keyword group as the AND anchor query", () => {
        expect(buildTagExpansionSearchQuery(keywordGroups, "AND")).toBe("cnc");
    });

    it("combines expanded terms for OR searches", () => {
        expect(buildTagExpansionSearchQuery(keywordGroups, "OR")).toBe("销售 业务 商务 sales cnc");
    });

    it("returns empty string for empty keyword groups", () => {
        expect(buildTagExpansionSearchQuery([], "AND")).toBe("");
        expect(buildTagExpansionSearchQuery([], "OR")).toBe("");
    });
});

describe("matchesTagExpansionSearchText", () => {
    it("requires every keyword group in AND mode", () => {
        expect(matchesTagExpansionSearchText("cnc 销售工程师", keywordGroups, "AND")).toBe(true);
        expect(matchesTagExpansionSearchText("销售工程师", keywordGroups, "AND")).toBe(false);
    });

    it("accepts any matching keyword group in OR mode", () => {
        expect(matchesTagExpansionSearchText("销售工程师", keywordGroups, "OR")).toBe(true);
        expect(matchesTagExpansionSearchText("数控编程", keywordGroups, "OR")).toBe(false);
    });
});

describe("collectSearchTextProvenance", () => {
    it("returns deduped searchText provenance with source mappings", () => {
        expect(collectSearchTextProvenance("销售 sales cnc sales", keywordGroups, {
            sales: "销售",
        })).toEqual([
            {
                term: "销售",
                source: "searchText",
                expandedFrom: undefined,
            },
            {
                term: "sales",
                source: "searchText",
                expandedFrom: "销售",
            },
            {
                term: "cnc",
                source: "searchText",
                expandedFrom: undefined,
            },
        ]);
    });

    it("returns empty array when no matches", () => {
        expect(collectSearchTextProvenance("marketing director", keywordGroups, {})).toEqual([]);
    });

    it("returns empty array for empty keyword groups", () => {
        expect(collectSearchTextProvenance("any text", [], {})).toEqual([]);
    });
});
