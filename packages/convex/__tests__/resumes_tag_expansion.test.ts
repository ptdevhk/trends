/**
 * Unit tests for lib/resumes_tag_expansion.ts
 */
import { describe, expect, it } from "vitest";
import {
    normalizeTagExpansionKeywordGroups,
    dedupeProvenance,
    buildTagExpansionSearchQuery,
    matchesTagExpansionSearchText,
    collectSearchTextProvenance,
    selectTagExpansionAnchorGroup,
    collectExpandedTerms,
} from "../convex/lib/resumes_tag_expansion.js";

// ---------------------------------------------------------------------------
// normalizeTagExpansionKeywordGroups
// ---------------------------------------------------------------------------
describe("normalizeTagExpansionKeywordGroups", () => {
    it("normalizes and deduplicates keyword groups", () => {
        const result = normalizeTagExpansionKeywordGroups([
            { original: "CNC", variants: ["cnc", "CNC", "cnc milling"] },
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].original).toBe("cnc");
        expect(result[0].variants).toContain("cnc");
        expect(result[0].variants).toContain("cnc milling");
        // Deduplicated: only one "cnc"
        expect(result[0].variants.filter((v) => v === "cnc")).toHaveLength(1);
    });

    it("filters out short variants (< 2 chars)", () => {
        const result = normalizeTagExpansionKeywordGroups([
            { original: "AI", variants: ["ai", "a"] },
        ]);
        expect(result[0].variants).not.toContain("a");
    });

    it("filters out groups with no remaining variants", () => {
        const result = normalizeTagExpansionKeywordGroups([
            { original: "X", variants: ["x"] }, // "x" is < 2 chars
        ]);
        expect(result).toHaveLength(0);
    });

    it("filters out groups with empty original", () => {
        const result = normalizeTagExpansionKeywordGroups([
            { original: "  ", variants: ["cnc"] },
        ]);
        expect(result).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// dedupeProvenance
// ---------------------------------------------------------------------------
describe("dedupeProvenance", () => {
    it("removes duplicate provenance entries", () => {
        const items = [
            { term: "cnc", source: "searchText" as const },
            { term: "cnc", source: "searchText" as const },
            { term: "milling", source: "searchText" as const },
        ];
        const result = dedupeProvenance(items);
        expect(result).toHaveLength(2);
    });

    it("keeps entries with same term but different source", () => {
        const items = [
            { term: "cnc", source: "searchText" as const },
            { term: "cnc", source: "industryTags" as const },
        ];
        const result = dedupeProvenance(items);
        expect(result).toHaveLength(2);
    });

    it("keeps entries with same term and source but different expandedFrom", () => {
        const items = [
            { term: "cnc", source: "searchText" as const, expandedFrom: "machining" },
            { term: "cnc", source: "searchText" as const, expandedFrom: "lathe" },
        ];
        const result = dedupeProvenance(items);
        expect(result).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// selectTagExpansionAnchorGroup
// ---------------------------------------------------------------------------
describe("selectTagExpansionAnchorGroup", () => {
    it("selects group with fewest variants", () => {
        const groups = [
            { original: "cnc", variants: ["cnc", "cnc milling", "cnc lathe"] },
            { original: "machining", variants: ["machining"] },
        ];
        const result = selectTagExpansionAnchorGroup(groups);
        expect(result.original).toBe("machining");
    });

    it("breaks ties by longest original name", () => {
        const groups = [
            { original: "cnc", variants: ["cnc"] },
            { original: "cnc machining", variants: ["cnc machining"] },
        ];
        const result = selectTagExpansionAnchorGroup(groups);
        expect(result.original).toBe("cnc machining");
    });

    it("throws for empty groups", () => {
        expect(() => selectTagExpansionAnchorGroup([])).toThrow("Keyword groups are required");
    });
});

// ---------------------------------------------------------------------------
// collectExpandedTerms
// ---------------------------------------------------------------------------
describe("collectExpandedTerms", () => {
    it("collects and deduplicates all variants", () => {
        const groups = [
            { original: "cnc", variants: ["cnc", "cnc milling"] },
            { original: "machining", variants: ["machining", "cnc milling"] },
        ];
        const result = collectExpandedTerms(groups);
        expect(result).toHaveLength(3);
        expect(result).toContain("cnc");
        expect(result).toContain("cnc milling");
        expect(result).toContain("machining");
    });
});

// ---------------------------------------------------------------------------
// buildTagExpansionSearchQuery
// ---------------------------------------------------------------------------
describe("buildTagExpansionSearchQuery", () => {
    it("returns empty for empty groups", () => {
        expect(buildTagExpansionSearchQuery([], "AND")).toBe("");
        expect(buildTagExpansionSearchQuery([], "OR")).toBe("");
    });

    it("AND mode uses anchor group variants", () => {
        const groups = [
            { original: "cnc", variants: ["cnc", "cnc milling"] },
            { original: "machining", variants: ["machining"] },
        ];
        const result = buildTagExpansionSearchQuery(groups, "AND");
        // Anchor group is "machining" (fewest variants)
        expect(result).toBe("machining");
    });

    it("OR mode uses all expanded terms", () => {
        const groups = [
            { original: "cnc", variants: ["cnc", "cnc milling"] },
            { original: "machining", variants: ["machining"] },
        ];
        const result = buildTagExpansionSearchQuery(groups, "OR");
        expect(result).toContain("cnc");
        expect(result).toContain("machining");
    });

    it("caps AND-mode anchor variants at the Convex 16-term limit", () => {
        const groups = [{
            original: "cnc",
            variants: Array.from({ length: 20 }, (_, i) => `variant-${i + 1}`),
        }];
        const result = buildTagExpansionSearchQuery(groups, "AND");
        expect(result.split(" ")).toHaveLength(16);
        expect(result).toBe(Array.from({ length: 16 }, (_, i) => `variant-${i + 1}`).join(" "));
    });

    it("caps OR-mode expanded terms at the Convex 16-term limit", () => {
        const groups = [{
            original: "cnc",
            variants: Array.from({ length: 20 }, (_, i) => `variant-${i + 1}`),
        }];
        const result = buildTagExpansionSearchQuery(groups, "OR");
        expect(result.split(" ")).toHaveLength(16);
    });
});

// ---------------------------------------------------------------------------
// matchesTagExpansionSearchText
// ---------------------------------------------------------------------------
describe("matchesTagExpansionSearchText", () => {
    const groups = [
        { original: "cnc", variants: ["cnc", "cnc milling"] },
        { original: "machining", variants: ["machining"] },
    ];

    it("AND mode requires all groups to match", () => {
        expect(matchesTagExpansionSearchText("cnc machining expert", groups, "AND")).toBe(true);
        expect(matchesTagExpansionSearchText("cnc expert", groups, "AND")).toBe(false);
    });

    it("OR mode requires at least one group to match", () => {
        expect(matchesTagExpansionSearchText("cnc expert", groups, "OR")).toBe(true);
        expect(matchesTagExpansionSearchText("welding expert", groups, "OR")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// collectSearchTextProvenance
// ---------------------------------------------------------------------------
describe("collectSearchTextProvenance", () => {
    it("collects provenance for matched terms", () => {
        const groups = [
            { original: "cnc", variants: ["cnc", "cnc milling"] },
            { original: "machining", variants: ["machining"] },
        ];
        const sourceMapping = { cnc: "keyword", "cnc milling": "synonym" };
        const result = collectSearchTextProvenance("cnc machining expert", groups, sourceMapping);
        expect(result.length).toBeGreaterThanOrEqual(2);
        expect(result.some((p) => p.term === "cnc")).toBe(true);
        expect(result.some((p) => p.term === "machining")).toBe(true);
    });

    it("skips terms not in search text", () => {
        const groups = [
            { original: "cnc", variants: ["cnc"] },
        ];
        const result = collectSearchTextProvenance("welding expert", groups, {});
        expect(result).toHaveLength(0);
    });

    it("deduplicates terms across groups", () => {
        const groups = [
            { original: "cnc", variants: ["cnc"] },
            { original: "cnc advanced", variants: ["cnc"] },
        ];
        const result = collectSearchTextProvenance("cnc", groups, {});
        expect(result).toHaveLength(1);
    });
});
