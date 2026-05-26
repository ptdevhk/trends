import { describe, it, expect } from "vitest";
import {
  mergeTags,
  normalizeOptionalPositiveInt,
  shallowEqualNumberRecord,
  shouldScheduleIngest,
} from "../convex/resume_tasks.js";

// --- mergeTags ---

describe("mergeTags", () => {
  it("merges and deduplicates tags", () => {
    expect(mergeTags(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("handles empty existing", () => {
    expect(mergeTags([], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("handles empty incoming", () => {
    expect(mergeTags(["a", "b"], [])).toEqual(["a", "b"]);
  });

  it("handles both empty", () => {
    expect(mergeTags([], [])).toEqual([]);
  });

  it("preserves order (existing first, then new)", () => {
    expect(mergeTags(["a"], ["b"])).toEqual(["a", "b"]);
  });
});

// --- normalizeOptionalPositiveInt ---

describe("normalizeOptionalPositiveInt", () => {
  it("returns truncated positive integer", () => {
    expect(normalizeOptionalPositiveInt(5)).toBe(5);
    expect(normalizeOptionalPositiveInt(5.9)).toBe(5);
  });

  it("returns undefined for non-positive values", () => {
    expect(normalizeOptionalPositiveInt(0)).toBeUndefined();
    expect(normalizeOptionalPositiveInt(-1)).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(normalizeOptionalPositiveInt(undefined)).toBeUndefined();
  });

  it("returns undefined for non-finite values", () => {
    expect(normalizeOptionalPositiveInt(NaN)).toBeUndefined();
    expect(normalizeOptionalPositiveInt(Infinity)).toBeUndefined();
  });
});

// --- shallowEqualNumberRecord ---

describe("shallowEqualNumberRecord", () => {
  it("returns true for equal records", () => {
    expect(shallowEqualNumberRecord({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it("returns true for undefined a when b is empty", () => {
    expect(shallowEqualNumberRecord(undefined, {})).toBe(true);
  });

  it("returns false for undefined a when b is non-empty", () => {
    expect(shallowEqualNumberRecord(undefined, { a: 1 })).toBe(false);
  });

  it("returns false for different values", () => {
    expect(shallowEqualNumberRecord({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("returns false for different keys", () => {
    expect(shallowEqualNumberRecord({ a: 1 }, { b: 1 })).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(shallowEqualNumberRecord({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

// --- shouldScheduleIngest ---

describe("shouldScheduleIngest", () => {
  it("returns true when no restore state", () => {
    expect(shouldScheduleIngest(undefined)).toBe(true);
  });

  it("returns true when ingestData is undefined", () => {
    expect(shouldScheduleIngest({})).toBe(true);
  });

  it("returns false when ingestData exists", () => {
    expect(shouldScheduleIngest({ ingestData: {} as any })).toBe(false);
  });

  it("returns false when ingestData is null (falsy but defined)", () => {
    expect(shouldScheduleIngest({ ingestData: null as any })).toBe(false);
  });

  it("returns true when restoreState has other fields but no ingestData", () => {
    expect(shouldScheduleIngest({ isArchived: true, archivedAt: 1000 })).toBe(true);
  });
});

// --- Additional edge cases for existing functions ---

describe("mergeTags edge cases", () => {
  it("preserves string values as-is (no normalization)", () => {
    expect(mergeTags(["CNC"], ["cnc"])).toEqual(["CNC", "cnc"]);
  });

  it("handles tags with special characters", () => {
    expect(mergeTags(["CNC/车床"], ["CNC/车床", "5-axis"])).toEqual(["CNC/车床", "5-axis"]);
  });
});

describe("normalizeOptionalPositiveInt edge cases", () => {
  it("handles very large numbers", () => {
    expect(normalizeOptionalPositiveInt(1_000_000)).toBe(1_000_000);
  });

  it("handles Number.MIN_VALUE (positive but truncated to 0)", () => {
    expect(normalizeOptionalPositiveInt(Number.MIN_VALUE)).toBeUndefined();
  });

  it("handles -0 (truncated to 0, which is non-positive)", () => {
    expect(normalizeOptionalPositiveInt(-0)).toBeUndefined();
  });
});

describe("shallowEqualNumberRecord edge cases", () => {
  it("returns true for empty records", () => {
    expect(shallowEqualNumberRecord({}, {})).toBe(true);
  });

  it("compares zero values correctly", () => {
    expect(shallowEqualNumberRecord({ a: 0 }, { a: 0 })).toBe(true);
  });

  it("returns false when one has zero and other has different value", () => {
    expect(shallowEqualNumberRecord({ a: 0 }, { a: 1 })).toBe(false);
  });
});
