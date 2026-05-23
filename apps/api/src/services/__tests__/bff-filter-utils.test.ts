import { describe, expect, it } from "vitest";
import {
  bffMatchesResumeFilters,
  isRecord,
  parseAgeFromContentField,
  toOptionalNumber,
  toStringValue,
} from "../bff-filter-utils.js";

describe("bff-filter-utils", () => {
  describe("isRecord", () => {
    it("returns true for plain objects", () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord({ key: "val" })).toBe(true);
    });

    it("returns false for null", () => {
      expect(isRecord(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isRecord(undefined)).toBe(false);
    });

    it("returns true for arrays (source deliberately does not exclude arrays)", () => {
      expect(isRecord([1, 2, 3])).toBe(true);
    });

    it("returns false for primitives", () => {
      expect(isRecord("string")).toBe(false);
      expect(isRecord(42)).toBe(false);
      expect(isRecord(true)).toBe(false);
    });
  });

  describe("toStringValue", () => {
    it("trims string values", () => {
      expect(toStringValue("  hello  ")).toBe("hello");
    });

    it("returns empty string for null", () => {
      expect(toStringValue(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
      expect(toStringValue(undefined)).toBe("");
    });

    it("converts numbers to trimmed strings", () => {
      expect(toStringValue(42)).toBe("42");
    });

    it("converts objects to trimmed strings", () => {
      expect(toStringValue({})).toBe("[object Object]");
    });
  });

  describe("toOptionalNumber", () => {
    it("returns finite numbers as-is", () => {
      expect(toOptionalNumber(5)).toBe(5);
      expect(toOptionalNumber(0)).toBe(0);
      expect(toOptionalNumber(-3)).toBe(-3);
    });

    it("returns undefined for Infinity", () => {
      expect(toOptionalNumber(Infinity)).toBeUndefined();
    });

    it("parses numeric strings", () => {
      expect(toOptionalNumber("10")).toBe(10);
      expect(toOptionalNumber(" 5 ")).toBe(5);
    });

    it("returns undefined for empty string", () => {
      expect(toOptionalNumber("")).toBeUndefined();
    });

    it("returns undefined for non-numeric string", () => {
      expect(toOptionalNumber("abc")).toBeUndefined();
    });

    it("returns undefined for null", () => {
      expect(toOptionalNumber(null)).toBeUndefined();
    });

    it("returns undefined for undefined", () => {
      expect(toOptionalNumber(undefined)).toBeUndefined();
    });
  });

  describe("parseAgeFromContentField", () => {
    it("extracts age from content field", () => {
      expect(parseAgeFromContentField({ age: "25 years" })).toBe(25);
    });

    it("returns null for missing age field", () => {
      expect(parseAgeFromContentField({ name: "John" })).toBeNull();
    });

    it("returns null for empty age string", () => {
      expect(parseAgeFromContentField({ age: "" })).toBeNull();
    });

    it("extracts first number from complex age string", () => {
      expect(parseAgeFromContentField({ age: "30-35" })).toBe(30);
    });
  });

  describe("bffMatchesResumeFilters", () => {
    const baseDoc = {
      content: {
        experience: "5 years",
        education: "Bachelor",
        location: "New York",
        locationHierarchy: { country: "United States", province: "New York", city: "New York" },
        expectedSalary: "80000-100000",
      },
      ingestData: {
        verifiedRoleYears: { engineer: 3 },
        roleSignals: [{ type: "engineer", years: 3 }],
      },
      source: "seek",
      sourceKey: "seek",
    };
    const loweredSearchText = "john doe engineer javascript react 5 years experience";

    it("accepts doc when all filters pass", () => {
      expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, {})).toBe(true);
    });

    describe("archived filter", () => {
      it("excludes archived doc when showArchived is false", () => {
        expect(bffMatchesResumeFilters(
          { ...baseDoc, isArchived: true },
          loweredSearchText,
          {},
        )).toBe(false);
      });

      it("includes archived doc when showArchived is true", () => {
        expect(bffMatchesResumeFilters(
          { ...baseDoc, isArchived: true },
          loweredSearchText,
          { showArchived: true },
        )).toBe(true);
      });
    });

    describe("experience filter", () => {
      const docNoExp = { ...baseDoc, content: { ...baseDoc.content, experience: "" } };

      it("excludes doc below minExperience", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { minExperience: 7 })).toBe(false);
      });

      it("includes doc meeting minExperience", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { minExperience: 3 })).toBe(true);
      });

      it("excludes doc above maxExperience", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { maxExperience: 3 })).toBe(false);
      });

      it("excludes doc with unknown experience when maxExperience is set", () => {
        expect(bffMatchesResumeFilters(docNoExp, loweredSearchText, { maxExperience: 5 })).toBe(false);
      });

      it("includes doc with unknown experience when only minExperience is set", () => {
        expect(bffMatchesResumeFilters(docNoExp, loweredSearchText, { minExperience: 3 })).toBe(true);
      });
    });

    describe("education filter", () => {
      it("excludes doc with non-matching education", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { education: ["Master"] })).toBe(false);
      });

      it("includes doc with matching education", () => {
        // normalizeEducationLevel("Bachelor") returns "bachelor"
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { education: ["bachelor"] })).toBe(true);
      });
    });

    describe("skills filter", () => {
      it("includes doc when loweredSearchText contains skill", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { skills: ["javascript"] })).toBe(true);
      });

      it("excludes doc when loweredSearchText lacks skill", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { skills: ["python"] })).toBe(false);
      });
    });

    describe("requiredKeywords filter", () => {
      it("includes doc when all keywords present", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { requiredKeywords: ["engineer", "react"] })).toBe(true);
      });

      it("excludes doc when any keyword missing", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { requiredKeywords: ["engineer", "rust"] })).toBe(false);
      });
    });

    describe("location filter", () => {
      it("includes doc when location matches", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { locations: ["New York"] })).toBe(true);
      });

      it("excludes doc when location does not match", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { locations: ["London"] })).toBe(false);
      });
    });

    describe("salary filter", () => {
      it("excludes doc below minSalary", () => {
        // Range "80000-100000" has max 100000, so minSalary > 100000 excludes
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { minSalary: 150000 })).toBe(false);
      });

      it("includes doc meeting minSalary", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { minSalary: 70000 })).toBe(true);
      });

      it("excludes doc above maxSalary", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { maxSalary: 70000 })).toBe(false);
      });

      it("excludes doc with unknown salary when maxSalary is set", () => {
        const docNoSal = { ...baseDoc, content: { ...baseDoc.content, expectedSalary: "" } };
        expect(bffMatchesResumeFilters(docNoSal, loweredSearchText, { maxSalary: 50000 })).toBe(false);
      });
    });

    describe("role filter", () => {
      it("excludes doc with non-matching roleFilterType", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { roleFilterType: "manager" })).toBe(false);
      });

      it("includes doc with matching roleFilterType", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { roleFilterType: "engineer" })).toBe(true);
      });
    });

    describe("minRoleYears filter", () => {
      it("excludes doc when verifiedRoleYears below minimum", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { minRoleYears: 5 })).toBe(false);
      });

      it("includes doc when verifiedRoleYears meets minimum", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { minRoleYears: 2 })).toBe(true);
      });
    });

    describe("age filter", () => {
      it("excludes doc below minAge", () => {
        const docWithAge = { ...baseDoc, age: 25 };
        expect(bffMatchesResumeFilters(docWithAge, loweredSearchText, { minAge: 30 })).toBe(false);
      });

      it("includes doc meeting minAge", () => {
        const docWithAge = { ...baseDoc, age: 35 };
        expect(bffMatchesResumeFilters(docWithAge, loweredSearchText, { minAge: 30 })).toBe(true);
      });

      it("excludes doc above maxAge", () => {
        const docWithAge = { ...baseDoc, age: 40 };
        expect(bffMatchesResumeFilters(docWithAge, loweredSearchText, { maxAge: 35 })).toBe(false);
      });
    });

    describe("source filter", () => {
      it("excludes doc with non-matching source", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { sources: ["51job"] })).toBe(false);
      });

      it("includes doc with matching source", () => {
        expect(bffMatchesResumeFilters(baseDoc, loweredSearchText, { sources: ["seek"] })).toBe(true);
      });
    });

    describe("edge cases", () => {
      it("handles empty doc gracefully", () => {
        expect(bffMatchesResumeFilters({}, "", {})).toBe(true);
      });

      it("handles null content gracefully", () => {
        expect(bffMatchesResumeFilters({ content: null }, "", {})).toBe(true);
      });

      it("handles null ingestData gracefully", () => {
        expect(bffMatchesResumeFilters({ ...baseDoc, ingestData: null }, loweredSearchText, {})).toBe(true);
      });
    });
  });
});
