import { describe, it, expect } from "vitest";
import {
    toStringValue,
    toOptionalStringValue,
    hasNonEmptyArray,
    readRecordArray,
    hasResumeFieldValue,
    hasWorkHistoryDescriptionEntries,
    toRuleScores,
    resolveRuleScoreLookupKeys,
    splitQueryTokens,
    matchesAllTokens,
} from "../convex/resume_helpers.js";

// ---------------------------------------------------------------------------
// toStringValue
// ---------------------------------------------------------------------------

describe("toStringValue", () => {
    it("returns trimmed string for string input", () => {
        expect(toStringValue("  hello  ")).toBe("hello");
    });

    it("returns empty string for null", () => {
        expect(toStringValue(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
        expect(toStringValue(undefined)).toBe("");
    });

    it("converts number to string", () => {
        expect(toStringValue(42)).toBe("42");
    });

    it("converts boolean to string", () => {
        expect(toStringValue(true)).toBe("true");
    });

    it("converts object via String()", () => {
        expect(toStringValue({ a: 1 })).toBe("[object Object]");
    });

    it("trims whitespace from number-to-string conversion", () => {
        // String(NaN) = "NaN" — no whitespace, but test the path
        expect(toStringValue(NaN)).toBe("NaN");
    });
});

// ---------------------------------------------------------------------------
// toOptionalStringValue
// ---------------------------------------------------------------------------

describe("toOptionalStringValue", () => {
    it("returns trimmed string for non-empty input", () => {
        expect(toOptionalStringValue("  hello  ")).toBe("hello");
    });

    it("returns undefined for empty string", () => {
        expect(toOptionalStringValue("")).toBeUndefined();
    });

    it("returns undefined for whitespace-only string", () => {
        expect(toOptionalStringValue("   ")).toBeUndefined();
    });

    it("returns undefined for null", () => {
        expect(toOptionalStringValue(null)).toBeUndefined();
    });

    it("returns undefined for undefined", () => {
        expect(toOptionalStringValue(undefined)).toBeUndefined();
    });

    it("returns string for number input", () => {
        expect(toOptionalStringValue(123)).toBe("123");
    });
});

// ---------------------------------------------------------------------------
// hasNonEmptyArray
// ---------------------------------------------------------------------------

describe("hasNonEmptyArray", () => {
    it("returns true for non-empty array", () => {
        expect(hasNonEmptyArray([1, 2, 3])).toBe(true);
    });

    it("returns false for empty array", () => {
        expect(hasNonEmptyArray([])).toBe(false);
    });

    it("returns false for null", () => {
        expect(hasNonEmptyArray(null)).toBe(false);
    });

    it("returns false for string", () => {
        expect(hasNonEmptyArray("not array")).toBe(false);
    });

    it("returns false for object", () => {
        expect(hasNonEmptyArray({})).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// readRecordArray
// ---------------------------------------------------------------------------

describe("readRecordArray", () => {
    it("filters to record objects", () => {
        const input = [{ a: 1 }, "string", 42, { b: 2 }, null];
        expect(readRecordArray(input)).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it("returns empty array for non-array input", () => {
        expect(readRecordArray("not array")).toEqual([]);
    });

    it("returns empty array for null", () => {
        expect(readRecordArray(null)).toEqual([]);
    });

    it("returns empty array for empty array", () => {
        expect(readRecordArray([])).toEqual([]);
    });

    it("includes arrays inside arrays (isRecord treats arrays as records)", () => {
        // isRecord from @trends/shared returns true for arrays
        const input = [{ a: 1 }, [1, 2]];
        expect(readRecordArray(input)).toEqual([{ a: 1 }, [1, 2]]);
    });
});

// ---------------------------------------------------------------------------
// hasResumeFieldValue
// ---------------------------------------------------------------------------

describe("hasResumeFieldValue", () => {
    it("returns true when at least one key has a value", () => {
        expect(hasResumeFieldValue({ name: "Alice", age: 30 }, ["name"])).toBe(true);
    });

    it("returns true when any of the keys has a value", () => {
        expect(hasResumeFieldValue({ name: "", age: 30 }, ["name", "age"])).toBe(true);
    });

    it("returns false when all keys are empty", () => {
        expect(hasResumeFieldValue({ name: "", age: 0 }, ["name"])).toBe(false);
    });

    it("returns false for missing keys", () => {
        expect(hasResumeFieldValue({ name: "Alice" }, ["title"])).toBe(false);
    });

    it("returns false for empty keys array", () => {
        expect(hasResumeFieldValue({ name: "Alice" }, [])).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// hasWorkHistoryDescriptionEntries
// ---------------------------------------------------------------------------

describe("hasWorkHistoryDescriptionEntries", () => {
    it("returns true when entry has description", () => {
        expect(hasWorkHistoryDescriptionEntries([{ description: "Software dev" }])).toBe(true);
    });

    it("returns false when description is empty", () => {
        expect(hasWorkHistoryDescriptionEntries([{ description: "" }])).toBe(false);
    });

    it("returns false when no description field", () => {
        expect(hasWorkHistoryDescriptionEntries([{ title: "Dev" }])).toBe(false);
    });

    it("returns false for non-array input", () => {
        expect(hasWorkHistoryDescriptionEntries("not array")).toBe(false);
    });

    it("returns false for empty array", () => {
        expect(hasWorkHistoryDescriptionEntries([])).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// toRuleScores
// ---------------------------------------------------------------------------

describe("toRuleScores", () => {
    it("extracts numeric values from record", () => {
        expect(toRuleScores({ a: 10, b: 20.5 })).toEqual({ a: 10, b: 20.5 });
    });

    it("ignores non-number values", () => {
        expect(toRuleScores({ a: 10, b: "high", c: true })).toEqual({ a: 10 });
    });

    it("ignores NaN and Infinity", () => {
        expect(toRuleScores({ a: NaN, b: Infinity, c: -Infinity, d: 5 })).toEqual({ d: 5 });
    });

    it("returns empty object for non-record input", () => {
        expect(toRuleScores("not record")).toEqual({});
    });

    it("returns empty object for null", () => {
        expect(toRuleScores(null)).toEqual({});
    });

    it("returns empty object for undefined", () => {
        expect(toRuleScores(undefined)).toEqual({});
    });

    it("treats array as record with numeric keys", () => {
        // isRecord returns true for arrays; entries become "0": 1, etc. but values aren't finite when checked
        expect(toRuleScores([1, 2, 3])).toEqual({ "0": 1, "1": 2, "2": 3 });
    });
});

// ---------------------------------------------------------------------------
// resolveRuleScoreLookupKeys
// ---------------------------------------------------------------------------

describe("resolveRuleScoreLookupKeys", () => {
    it("returns empty array for undefined", () => {
        expect(resolveRuleScoreLookupKeys(undefined)).toEqual([]);
    });

    it("returns empty array for empty string", () => {
        expect(resolveRuleScoreLookupKeys("")).toEqual([]);
    });

    it("returns key as-is for plain ID", () => {
        expect(resolveRuleScoreLookupKeys("lathe-sales")).toEqual(["lathe-sales", "jd-lathe-sales"]);
    });

    it("strips jd- prefix and provides both forms", () => {
        expect(resolveRuleScoreLookupKeys("jd-lathe-sales")).toEqual(["jd-lathe-sales", "lathe-sales"]);
    });

    it("handles jd- prefix with only slug", () => {
        const result = resolveRuleScoreLookupKeys("jd-");
        // "jd-" → trimmed slug would be "", so only the original key
        expect(result).toEqual(["jd-"]);
    });

    it("returns both forms for non-jd-prefixed key", () => {
        const result = resolveRuleScoreLookupKeys("123");
        expect(result).toContain("123");
        expect(result).toContain("jd-123");
    });
});

// ---------------------------------------------------------------------------
// splitQueryTokens
// ---------------------------------------------------------------------------

describe("splitQueryTokens", () => {
    it("splits on whitespace", () => {
        expect(splitQueryTokens("hello world")).toEqual(["hello", "world"]);
    });

    it("lowercases tokens", () => {
        expect(splitQueryTokens("CNC 操作员")).toEqual(["cnc", "操作员"]);
    });

    it("trims leading/trailing whitespace", () => {
        expect(splitQueryTokens("  hello  ")).toEqual(["hello"]);
    });

    it("returns single token for single word", () => {
        expect(splitQueryTokens("engineer")).toEqual(["engineer"]);
    });

    it("returns empty array for whitespace-only", () => {
        expect(splitQueryTokens("   ")).toEqual([]);
    });

    it("returns empty array for empty string", () => {
        expect(splitQueryTokens("")).toEqual([]);
    });

    it("collapses multiple spaces", () => {
        expect(splitQueryTokens("a   b   c")).toEqual(["a", "b", "c"]);
    });

    it("caps tokens at the Convex 16-term search-expression limit", () => {
        const tokens = splitQueryTokens("t1 t2 t3 t4 t5 t6 t7 t8 t9 t10 t11 t12 t13 t14 t15 t16 t17 t18");
        expect(tokens).toHaveLength(16);
        expect(tokens.at(-1)).toBe("t16");
    });
});

// ---------------------------------------------------------------------------
// matchesAllTokens
// ---------------------------------------------------------------------------

describe("matchesAllTokens", () => {
    it("returns true for single token (always matches)", () => {
        expect(matchesAllTokens("anything", ["only"])).toBe(true);
    });

    it("returns true for empty tokens", () => {
        expect(matchesAllTokens("anything", [])).toBe(true);
    });

    it("returns true when all tokens found", () => {
        expect(matchesAllTokens("CNC operator senior", ["cnc", "senior"])).toBe(true);
    });

    it("returns false when a token is missing", () => {
        expect(matchesAllTokens("CNC operator", ["cnc", "welding"])).toBe(false);
    });

    it("matches case-insensitively", () => {
        expect(matchesAllTokens("CNC OPERATOR", ["cnc", "operator"])).toBe(true);
    });

    it("handles undefined searchText", () => {
        expect(matchesAllTokens(undefined, ["cnc", "operator"])).toBe(false);
    });

    it("handles null searchText with single token (returns true per <=1 guard)", () => {
        // Single token always matches (guard: tokens.length <= 1)
        expect(matchesAllTokens(null as unknown as string, ["cnc"])).toBe(true);
    });

    it("handles null searchText with multiple tokens", () => {
        expect(matchesAllTokens(null as unknown as string, ["cnc", "operator"])).toBe(false);
    });
});
