import { describe, it, expect } from "vitest";
import {
  normalizeWorkspaceSlug,
  belongsToWorkspace,
  asRecord,
  readString,
  readStringArray,
  readProfileId,
  normalizeCriteria,
  areStringArraysEqual,
} from "../search_profiles.js";

// --- normalizeWorkspaceSlug ---

describe("normalizeWorkspaceSlug", () => {
  it("returns trimmed string for valid input", () => {
    expect(normalizeWorkspaceSlug("  my-workspace  ")).toBe("my-workspace");
  });

  it("returns default for undefined", () => {
    expect(normalizeWorkspaceSlug(undefined)).toBe("dev");
  });

  it("returns default for empty string", () => {
    expect(normalizeWorkspaceSlug("")).toBe("dev");
    expect(normalizeWorkspaceSlug("   ")).toBe("dev");
  });
});

// --- belongsToWorkspace ---

describe("belongsToWorkspace", () => {
  it("default workspace ('dev') matches records with no slug", () => {
    expect(belongsToWorkspace(undefined, "dev")).toBe(true);
    expect(belongsToWorkspace("dev", "dev")).toBe(true);
  });

  it("non-default workspace requires exact match", () => {
    expect(belongsToWorkspace("my-ws", "my-ws")).toBe(true);
    expect(belongsToWorkspace("other-ws", "my-ws")).toBe(false);
    expect(belongsToWorkspace(undefined, "my-ws")).toBe(false);
  });
});

// --- asRecord ---

describe("asRecord", () => {
  it("converts plain object to record", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
  });

  it("returns null for null", () => {
    expect(asRecord(null)).toBeNull();
  });

  it("returns null for arrays", () => {
    expect(asRecord([])).toBeNull();
  });

  it("returns null for primitives", () => {
    expect(asRecord("str")).toBeNull();
    expect(asRecord(42)).toBeNull();
  });
});

// --- readString ---

describe("readString", () => {
  it("returns trimmed string for valid input", () => {
    expect(readString("  hello  ")).toBe("hello");
  });

  it("returns undefined for empty/whitespace-only string", () => {
    expect(readString("")).toBeUndefined();
    expect(readString("   ")).toBeUndefined();
  });

  it("returns undefined for non-string input", () => {
    expect(readString(42)).toBeUndefined();
    expect(readString(null)).toBeUndefined();
  });
});

// --- readStringArray ---

describe("readStringArray", () => {
  it("filters, trims, and deduplicates strings (case-sensitive)", () => {
    expect(readStringArray(["  CNC  ", "CNC", "Sales", 42])).toEqual(["CNC", "Sales"]);
  });

  it("returns empty for non-array input", () => {
    expect(readStringArray(null)).toEqual([]);
    expect(readStringArray({})).toEqual([]);
  });

  it("filters out empty strings after trimming", () => {
    expect(readStringArray(["", "  ", "valid"])).toEqual(["valid"]);
  });
});

// --- readProfileId ---

describe("readProfileId", () => {
  it("reads direct profileId", () => {
    expect(readProfileId({ profileId: "sp-123" })).toBe("sp-123");
  });

  it("reads from nested profile.id", () => {
    expect(readProfileId({ profile: { id: "sp-456" } })).toBe("sp-456");
  });

  it("prefers direct profileId over nested", () => {
    expect(readProfileId({ profileId: "direct", profile: { id: "nested" } })).toBe("direct");
  });

  it("returns undefined when no id found", () => {
    expect(readProfileId({})).toBeUndefined();
    expect(readProfileId({ profile: { name: "no-id" } })).toBeUndefined();
  });
});

// --- normalizeCriteria ---

describe("normalizeCriteria", () => {
  it("extracts keywords and locations from profile", () => {
    const result = normalizeCriteria({
      keywords: ["CNC", "sales"],
      location: "Shanghai",
    });
    expect(result.keywords).toEqual(["CNC", "sales"]);
    expect(result.locations).toEqual(["Shanghai"]);
  });

  it("merges location and filters.locations", () => {
    const result = normalizeCriteria({
      location: "Beijing",
      filters: { locations: ["Beijing", "Shanghai"] },
    });
    expect(result.locations).toEqual(["Beijing", "Shanghai"]);
  });

  it("deduplicates locations", () => {
    const result = normalizeCriteria({
      location: "Beijing",
      filters: { locations: ["Beijing"] },
    });
    expect(result.locations).toEqual(["Beijing"]);
  });

  it("returns empty arrays for null/undefined", () => {
    const result = normalizeCriteria(null);
    expect(result.keywords).toEqual([]);
    expect(result.locations).toEqual([]);
  });

  it("returns empty arrays for non-object input", () => {
    const result = normalizeCriteria("string");
    expect(result.keywords).toEqual([]);
    expect(result.locations).toEqual([]);
  });
});

// --- areStringArraysEqual ---

describe("areStringArraysEqual", () => {
  it("returns true for identical arrays", () => {
    expect(areStringArraysEqual(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("returns false for different lengths", () => {
    expect(areStringArraysEqual(["a"], ["a", "b"])).toBe(false);
  });

  it("returns false for different elements", () => {
    expect(areStringArraysEqual(["a", "b"], ["a", "c"])).toBe(false);
  });

  it("returns true for empty arrays", () => {
    expect(areStringArraysEqual([], [])).toBe(true);
  });

  it("order matters", () => {
    expect(areStringArraysEqual(["a", "b"], ["b", "a"])).toBe(false);
  });
});
