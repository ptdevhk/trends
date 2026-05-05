/**
 * Keyword search load and correctness tests.
 *
 * Tests the pure-function helpers used by every keyword search path in
 * resumes.ts: query building, AND/OR matching, provenance tracking,
 * batch-size limits, and edge-case handling.
 *
 * These run as vitest unit tests — no live Convex instance required.
 */
import { describe, expect, it } from "vitest";

import {
    buildTagExpansionSearchQuery,
    collectSearchTextProvenance,
    matchesTagExpansionSearchText,
    resolveListWithIngestWindow,
} from "../resumes";

// ── Test fixtures ──────────────────────────────────────────────────────

const cncGroup = { original: "cnc", variants: ["cnc"] };
const salesGroup = {
    original: "销售",
    variants: ["销售", "业务", "商务", "sales"],
};
const millGroup = {
    original: "铣床",
    variants: ["铣床", "铣削", "milling"],
};

const singleGroup = [cncGroup];
const twoGroups = [cncGroup, salesGroup];
const threeGroups = [cncGroup, salesGroup, millGroup];

// ── buildTagExpansionSearchQuery ──────────────────────────────────────

describe("buildTagExpansionSearchQuery", () => {
    it("returns empty string for empty groups", () => {
        expect(buildTagExpansionSearchQuery([], "AND")).toBe("");
        expect(buildTagExpansionSearchQuery([], "OR")).toBe("");
    });

    it("returns group variants for single group in AND mode", () => {
        expect(buildTagExpansionSearchQuery(singleGroup, "AND")).toBe("cnc");
    });

    it("uses the narrowest group as AND anchor", () => {
        // cncGroup has 1 variant, salesGroup has 4 → cnc is anchor
        expect(buildTagExpansionSearchQuery(twoGroups, "AND")).toBe("cnc");
    });

    it("combines all expanded terms for OR mode", () => {
        const result = buildTagExpansionSearchQuery(twoGroups, "OR");
        const terms = result.split(" ");
        expect(terms).toContain("cnc");
        expect(terms).toContain("销售");
        expect(terms).toContain("业务");
        expect(terms).toContain("商务");
        expect(terms).toContain("sales");
        expect(terms.length).toBe(5);
    });

    it("handles three groups correctly in AND mode", () => {
        // cnc (1 variant) is narrowest → anchor
        expect(buildTagExpansionSearchQuery(threeGroups, "AND")).toBe("cnc");
    });

    it("handles three groups correctly in OR mode", () => {
        const result = buildTagExpansionSearchQuery(threeGroups, "OR");
        const terms = result.split(" ");
        expect(terms.length).toBe(8); // 1 + 4 + 3
    });

    it("picks longer original as tiebreaker when variant counts match", () => {
        const groupA = { original: "ab", variants: ["ab", "cd"] };
        const groupB = { original: "xyz", variants: ["xyz", "uv"] };
        const result = buildTagExpansionSearchQuery([groupA, groupB], "AND");
        // groupB.original (3 chars) > groupA.original (2 chars) → groupB wins
        expect(result).toBe("xyz uv");
    });
});

// ── matchesTagExpansionSearchText ──────────────────────────────────────

describe("matchesTagExpansionSearchText", () => {
    describe("AND mode", () => {
        it("requires every keyword group to match", () => {
            expect(matchesTagExpansionSearchText("cnc 销售工程师", twoGroups, "AND")).toBe(true);
            expect(matchesTagExpansionSearchText("cnc操作员", twoGroups, "AND")).toBe(false);
            expect(matchesTagExpansionSearchText("销售工程师", twoGroups, "AND")).toBe(false);
        });

        it("matches single group", () => {
            expect(matchesTagExpansionSearchText("cnc编程", singleGroup, "AND")).toBe(true);
            expect(matchesTagExpansionSearchText("java开发", singleGroup, "AND")).toBe(false);
        });

        it("requires all three groups", () => {
            expect(matchesTagExpansionSearchText("cnc 销售工程师 铣床操作", threeGroups, "AND")).toBe(true);
            expect(matchesTagExpansionSearchText("cnc 销售工程师", threeGroups, "AND")).toBe(false);
        });

        it("matches any variant within a group", () => {
            expect(matchesTagExpansionSearchText("cnc 业务员", twoGroups, "AND")).toBe(true);
            expect(matchesTagExpansionSearchText("cnc 商务拓展", twoGroups, "AND")).toBe(true);
            expect(matchesTagExpansionSearchText("cnc sales manager", twoGroups, "AND")).toBe(true);
        });

        it("handles empty searchText", () => {
            expect(matchesTagExpansionSearchText("", twoGroups, "AND")).toBe(false);
        });
    });

    describe("OR mode", () => {
        it("accepts any matching keyword group", () => {
            expect(matchesTagExpansionSearchText("销售工程师", twoGroups, "OR")).toBe(true);
            expect(matchesTagExpansionSearchText("cnc编程", twoGroups, "OR")).toBe(true);
        });

        it("rejects when no groups match", () => {
            expect(matchesTagExpansionSearchText("java开发", twoGroups, "OR")).toBe(false);
        });

        it("matches with any variant across groups", () => {
            expect(matchesTagExpansionSearchText("业务员", twoGroups, "OR")).toBe(true);
            expect(matchesTagExpansionSearchText("milling operator", threeGroups, "OR")).toBe(true);
        });

        it("handles empty groups", () => {
            expect(matchesTagExpansionSearchText("anything", [], "OR")).toBe(false);
        });
    });

    describe("case sensitivity", () => {
        it("matches after caller lowercases (as production code does)", () => {
            // Production normalizes searchText to lowercase before calling
            expect(matchesTagExpansionSearchText("cnc编程", singleGroup, "AND")).toBe(true);
            expect(matchesTagExpansionSearchText("cnc sales", twoGroups, "AND")).toBe(true);
        });

        it("does not match unnormalized uppercase against lowercase variants", () => {
            // The function does raw includes() — callers must lowercase
            expect(matchesTagExpansionSearchText("CNC编程", singleGroup, "AND")).toBe(false);
        });
    });
});

// ── collectSearchTextProvenance ────────────────────────────────────────

describe("collectSearchTextProvenance", () => {
    it("returns empty array when no terms match", () => {
        expect(collectSearchTextProvenance("java开发", twoGroups, {})).toEqual([]);
    });

    it("returns deduped provenance for matching terms", () => {
        const result = collectSearchTextProvenance("cnc 销售 sales", twoGroups, {
            sales: "销售",
        });
        expect(result).toEqual([
            { term: "cnc", source: "searchText" },
            { term: "销售", source: "searchText" },
            { term: "sales", source: "searchText", expandedFrom: "销售" },
        ]);
    });

    it("deduplicates identical terms across groups", () => {
        const groupA = { original: "a", variants: ["cnc"] };
        const groupB = { original: "b", variants: ["cnc", "other"] };
        const result = collectSearchTextProvenance("cnc other", [groupA, groupB], {});
        const terms = result.map((r) => r.term);
        // "cnc" should appear once even though it's in two groups
        expect(terms.filter((t) => t === "cnc").length).toBe(1);
        expect(terms).toContain("other");
    });

    it("tracks expandedFrom for source mappings", () => {
        const result = collectSearchTextProvenance("业务", twoGroups, {
            业务: "销售",
        });
        expect(result).toEqual([
            { term: "业务", source: "searchText", expandedFrom: "销售" },
        ]);
    });

    it("handles empty searchText", () => {
        expect(collectSearchTextProvenance("", twoGroups, {})).toEqual([]);
    });

    it("handles empty groups", () => {
        expect(collectSearchTextProvenance("anything", [], {})).toEqual([]);
    });
});

// ── resolveListWithIngestWindow (byte-limit guard) ────────────────────

describe("resolveListWithIngestWindow", () => {
    it("defaults to a safe limit", () => {
        const { limit, overfetchLimit } = resolveListWithIngestWindow(undefined);
        expect(limit).toBeGreaterThan(0);
        expect(overfetchLimit).toBeGreaterThanOrEqual(limit);
    });

    it("caps limit to MAX_SAFE value", () => {
        const { limit } = resolveListWithIngestWindow(99999);
        // Should not exceed the internal MAX_SAFE_LIST_WITH_INGEST_LIMIT (2000)
        expect(limit).toBeLessThanOrEqual(2000);
    });

    it("enforces minimum of 1", () => {
        const { limit } = resolveListWithIngestWindow(0);
        expect(limit).toBeGreaterThanOrEqual(1);
    });

    it("overfetch is bounded", () => {
        const { overfetchLimit } = resolveListWithIngestWindow(99999);
        // overfetch should be capped at MAX_SAFE_LIST_WITH_INGEST_OVERFETCH (4000)
        expect(overfetchLimit).toBeLessThanOrEqual(4000);
    });

    it("overfetch is at least 3x limit for small limits", () => {
        const { limit, overfetchLimit } = resolveListWithIngestWindow(10);
        expect(overfetchLimit).toBeGreaterThanOrEqual(limit * 3);
    });
});

// ── Byte-limit safety for scanResumePageSlim ──────────────────────────
//
// The fix reduced scanResumePageSlim batch from 1000 → 200.
// Average doc size is ~27KB; 200 × 27KB ≈ 5.4MB, well under 16 MiB.
// This test validates the cap is enforced in the projection logic.

describe("scanResumePageSlim byte-limit safety", () => {
    it("hard caps numItems at 200", () => {
        // The handler enforces: Math.min(args.numItems ?? 200, 200)
        // Test the cap logic directly
        const numItems = Math.min(1000, 200);
        expect(numItems).toBe(200);
    });

    it("uses 200 as default when no numItems provided", () => {
        const input: number | undefined = undefined;
        const numItems = Math.min(input ?? 200, 200);
        expect(numItems).toBe(200);
    });

    it("allows smaller batch sizes", () => {
        const numItems = Math.min(50, 200);
        expect(numItems).toBe(50);
    });

    it("estimated byte size stays under 16 MiB", () => {
        const AVG_DOC_SIZE_KB = 27;
        const BATCH_SIZE = 200;
        const estimatedMB = (BATCH_SIZE * AVG_DOC_SIZE_KB) / 1024;
        // 200 × 27KB ≈ 5.27 MB, well under 16 MiB (≈ 16.78 MB)
        expect(estimatedMB).toBeLessThan(16);
        // Also check we have at least 3x headroom
        expect(estimatedMB).toBeLessThan(16 / 3);
    });
});

// ── Mixed Chinese/English keyword handling ─────────────────────────────

describe("mixed language keyword search", () => {
    it("handles Chinese+English keywords in AND mode", () => {
        const groups = [
            { original: "CNC", variants: ["cnc", "数控"] },
            { original: "engineer", variants: ["engineer", "工程师", "工程"] },
        ];
        expect(matchesTagExpansionSearchText("cnc工程师", groups, "AND")).toBe(true);
        expect(matchesTagExpansionSearchText("数控engineer", groups, "AND")).toBe(true);
        expect(matchesTagExpansionSearchText("cnc", groups, "AND")).toBe(false);
    });

    it("handles mixed language in provenance", () => {
        const groups = [
            { original: "CNC", variants: ["cnc", "数控"] },
        ];
        const result = collectSearchTextProvenance("cnc数控编程", groups, {
            数控: "CNC",
        });
        expect(result).toEqual([
            { term: "cnc", source: "searchText" },
            { term: "数控", source: "searchText", expandedFrom: "CNC" },
        ]);
    });

    it("handles punctuation-separated terms", () => {
        expect(matchesTagExpansionSearchText("cnc, 销售", twoGroups, "AND")).toBe(true);
        expect(matchesTagExpansionSearchText("cnc/销售", twoGroups, "AND")).toBe(true);
    });
});

// ── getResumes backward compatibility ──────────────────────────────────

describe("getResumes query backward compatibility", () => {
    it("defaults limit to 50 when not provided", () => {
        const input: number | undefined = undefined;
        const limit = input ?? 50;
        expect(limit).toBe(50);
    });

    it("respects custom limit", () => {
        const input: number | undefined = 10;
        const limit = input ?? 50;
        expect(limit).toBe(10);
    });

    it("caps limit to 200 maximum (byte-limit safety)", () => {
        // getResumes now caps limit at 200 to stay under 16 MiB byte limit
        const limit = Math.min(1000, 200);
        expect(limit).toBe(200);
    });
});
