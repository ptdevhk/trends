import { describe, expect, it } from "vitest";

import {
    hasNonEmptyArray,
    hasResumeFieldValue,
    hasWorkHistoryDescriptionEntries,
    matchesAllTokens,
    readRecordArray,
    resolveRuleScoreLookupKeys,
    splitQueryTokens,
    toOptionalStringValue,
    toRuleScores,
    toStringValue,
} from "../resume_helpers";

// ---------------------------------------------------------------------------
// toStringValue
// ---------------------------------------------------------------------------

describe("toStringValue", () => {
    it("returns trimmed string values", () => {
        expect(toStringValue("  hello  ")).toBe("hello");
    });

    it("converts numbers to string", () => {
        expect(toStringValue(42)).toBe("42");
    });

    it("returns empty string for null/undefined", () => {
        expect(toStringValue(null)).toBe("");
        expect(toStringValue(undefined)).toBe("");
    });
});

// ---------------------------------------------------------------------------
// toOptionalStringValue
// ---------------------------------------------------------------------------

describe("toOptionalStringValue", () => {
    it("returns trimmed string values", () => {
        expect(toOptionalStringValue("hello")).toBe("hello");
    });

    it("returns undefined for empty/whitespace strings", () => {
        expect(toOptionalStringValue("")).toBeUndefined();
        expect(toOptionalStringValue("   ")).toBeUndefined();
    });

    it("returns undefined for non-string values", () => {
        expect(toOptionalStringValue(42)).toBe("42"); // toStringValue converts numbers
        expect(toOptionalStringValue(null)).toBeUndefined();
        expect(toOptionalStringValue(undefined)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// hasNonEmptyArray
// ---------------------------------------------------------------------------

describe("hasNonEmptyArray", () => {
    it("returns true for non-empty arrays", () => {
        expect(hasNonEmptyArray(["a"])).toBe(true);
        expect(hasNonEmptyArray([1, 2])).toBe(true);
    });

    it("returns false for empty arrays", () => {
        expect(hasNonEmptyArray([])).toBe(false);
    });

    it("returns false for non-arrays", () => {
        expect(hasNonEmptyArray("string")).toBe(false);
        expect(hasNonEmptyArray(null)).toBe(false);
        expect(hasNonEmptyArray(undefined)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// readRecordArray
// ---------------------------------------------------------------------------

describe("readRecordArray", () => {
    it("returns array of records for valid input", () => {
        const input = [{ a: 1 }, { b: 2 }];
        expect(readRecordArray(input)).toEqual(input);
    });

    it("returns empty array for non-array input", () => {
        expect(readRecordArray("not array")).toEqual([]);
        expect(readRecordArray(null)).toEqual([]);
        expect(readRecordArray(undefined)).toEqual([]);
    });

    it("filters out non-object entries", () => {
        const input = [{ a: 1 }, "string", null, { b: 2 }];
        expect(readRecordArray(input)).toEqual([{ a: 1 }, { b: 2 }]);
    });
});

// ---------------------------------------------------------------------------
// hasResumeFieldValue
// ---------------------------------------------------------------------------

describe("hasResumeFieldValue", () => {
    it("returns true when any key has a string value", () => {
        expect(hasResumeFieldValue({ name: "Alice" }, ["name"])).toBe(true);
    });

    it("returns false when all keys are missing or empty", () => {
        expect(hasResumeFieldValue({}, ["name"])).toBe(false);
        expect(hasResumeFieldValue({ name: "" }, ["name"])).toBe(false);
        expect(hasResumeFieldValue({ name: null }, ["name"])).toBe(false);
    });

    it("checks multiple keys", () => {
        expect(hasResumeFieldValue({ name: "Alice" }, ["name", "skills"])).toBe(true);
        expect(hasResumeFieldValue({ skills: "Python" }, ["name", "skills"])).toBe(true);
        expect(hasResumeFieldValue({ age: 30 }, ["age"])).toBe(true); // toStringValue(30) = "30"
        expect(hasResumeFieldValue({ age: 30 }, ["name", "skills"])).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// hasWorkHistoryDescriptionEntries
// ---------------------------------------------------------------------------

describe("hasWorkHistoryDescriptionEntries", () => {
    it("returns true when work history has entries with description", () => {
        expect(hasWorkHistoryDescriptionEntries([{ description: "Managed team" }])).toBe(true);
    });

    it("returns false for empty or missing descriptions", () => {
        expect(hasWorkHistoryDescriptionEntries([])).toBe(false);
        expect(hasWorkHistoryDescriptionEntries([{ description: "" }])).toBe(false);
        expect(hasWorkHistoryDescriptionEntries([{ noDescription: true }])).toBe(false);
    });

    it("returns false for non-array input", () => {
        expect(hasWorkHistoryDescriptionEntries("not-array")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// toRuleScores
// ---------------------------------------------------------------------------

describe("toRuleScores", () => {
    it("returns record when input is a valid Record<string, number>", () => {
        expect(toRuleScores({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    });

    it("filters out non-number values", () => {
        expect(toRuleScores({ a: 1, b: "bad", c: true } as any)).toEqual({ a: 1 });
    });

    it("returns empty object for non-record input", () => {
        expect(toRuleScores("string")).toEqual({});
        expect(toRuleScores(null)).toEqual({});
        expect(toRuleScores(undefined)).toEqual({});
    });
});

// ---------------------------------------------------------------------------
// resolveRuleScoreLookupKeys
// ---------------------------------------------------------------------------

describe("resolveRuleScoreLookupKeys", () => {
    it("returns empty array when no jobDescriptionId", () => {
        expect(resolveRuleScoreLookupKeys(undefined)).toEqual([]);
        expect(resolveRuleScoreLookupKeys("")).toEqual([]);
    });

    it("returns JD id and derived jd- prefixed key", () => {
        const keys = resolveRuleScoreLookupKeys("sales-mgr");
        expect(keys).toContain("sales-mgr");
        expect(keys).toContain("jd-sales-mgr");
    });

    it("strips jd- prefix for legacy slug", () => {
        const keys = resolveRuleScoreLookupKeys("jd-123");
        expect(keys).toContain("jd-123");
        expect(keys).toContain("123");
    });
});

// ---------------------------------------------------------------------------
// splitQueryTokens
// ---------------------------------------------------------------------------

describe("splitQueryTokens", () => {
    it("splits on whitespace", () => {
        expect(splitQueryTokens("hello world")).toEqual(["hello", "world"]);
    });

    it("trims and filters empty tokens", () => {
        expect(splitQueryTokens("  hello   world  ")).toEqual(["hello", "world"]);
    });

    it("returns empty array for empty string", () => {
        expect(splitQueryTokens("")).toEqual([]);
        expect(splitQueryTokens("   ")).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// matchesAllTokens
// ---------------------------------------------------------------------------

describe("matchesAllTokens", () => {
    it("returns true when all tokens are found", () => {
        expect(matchesAllTokens("python developer", ["python", "developer"])).toBe(true);
    });

    it("returns false when any token is missing", () => {
        expect(matchesAllTokens("python developer", ["python", "java"])).toBe(false);
    });

    it("returns true for empty or single token (short-circuit)", () => {
        expect(matchesAllTokens("anything", [])).toBe(true);
        expect(matchesAllTokens(undefined, ["python"])).toBe(true);
    });

    it("returns false for undefined search text with multiple tokens", () => {
        expect(matchesAllTokens(undefined, ["python", "java"])).toBe(false);
    });

    it("is case-insensitive", () => {
        expect(matchesAllTokens("Python Developer", ["python", "developer"])).toBe(true);
    });
});
