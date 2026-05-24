import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DEFAULT_COLLECTION_GUARDS,
  GUARD_FIELD_NAMES,
  GUARD_ARRAY_FIELD_NAMES,
  loadCollectionGuards,
  parseGuardFieldNames,
  applyCollectionGuards,
} from "../collection-guards.js";

describe("collection-guards", () => {
  describe("DEFAULT_COLLECTION_GUARDS", () => {
    it("has guards for all three source sites", () => {
      expect(DEFAULT_COLLECTION_GUARDS).toHaveProperty("job5156");
      expect(DEFAULT_COLLECTION_GUARDS).toHaveProperty("51job");
      expect(DEFAULT_COLLECTION_GUARDS).toHaveProperty("seek");
    });

    it("uses comma-separated field names as values", () => {
      for (const value of Object.values(DEFAULT_COLLECTION_GUARDS)) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    });
  });

  describe("GUARD_FIELD_NAMES", () => {
    it("contains expected guard fields", () => {
      expect(GUARD_FIELD_NAMES.has("experience")).toBe(true);
      expect(GUARD_FIELD_NAMES.has("jobIntention")).toBe(true);
      expect(GUARD_FIELD_NAMES.has("selfIntro")).toBe(true);
      expect(GUARD_FIELD_NAMES.has("workHistory")).toBe(true);
      expect(GUARD_FIELD_NAMES.has("expectedSalary")).toBe(true);
    });

    it("is a Set", () => {
      expect(GUARD_FIELD_NAMES).toBeInstanceOf(Set);
    });
  });

  describe("GUARD_ARRAY_FIELD_NAMES", () => {
    it("contains array-type fields", () => {
      expect(GUARD_ARRAY_FIELD_NAMES.has("workHistory")).toBe(true);
      expect(GUARD_ARRAY_FIELD_NAMES.has("profileEducation")).toBe(true);
      expect(GUARD_ARRAY_FIELD_NAMES.has("projectExperience")).toBe(true);
      expect(GUARD_ARRAY_FIELD_NAMES.has("skills")).toBe(true);
      expect(GUARD_ARRAY_FIELD_NAMES.has("licences")).toBe(true);
    });

    it("is a subset of GUARD_FIELD_NAMES", () => {
      for (const field of GUARD_ARRAY_FIELD_NAMES) {
        expect(GUARD_FIELD_NAMES.has(field)).toBe(true);
      }
    });
  });

  describe("parseGuardFieldNames", () => {
    it("parses comma-separated valid field names", () => {
      const result = parseGuardFieldNames("experience,jobIntention,selfIntro");
      expect(result).toEqual(["experience", "jobIntention", "selfIntro"]);
    });

    it("trims whitespace around field names", () => {
      const result = parseGuardFieldNames(" experience , jobIntention ");
      expect(result).toEqual(["experience", "jobIntention"]);
    });

    it("filters out invalid field names", () => {
      const result = parseGuardFieldNames("experience,invalidField,selfIntro");
      expect(result).toEqual(["experience", "selfIntro"]);
    });

    it("deduplicates field names", () => {
      const result = parseGuardFieldNames("experience,experience,jobIntention");
      expect(result).toEqual(["experience", "jobIntention"]);
    });

    it("returns empty array for empty string", () => {
      expect(parseGuardFieldNames("")).toEqual([]);
    });

    it("returns empty array for null", () => {
      expect(parseGuardFieldNames(null as any)).toEqual([]);
    });

    it("returns empty array for undefined", () => {
      expect(parseGuardFieldNames(undefined as any)).toEqual([]);
    });

    it("returns empty array for non-string input", () => {
      expect(parseGuardFieldNames(42 as any)).toEqual([]);
    });

    it("returns empty array when all fields are invalid", () => {
      expect(parseGuardFieldNames("foo,bar,baz")).toEqual([]);
    });
  });

  describe("applyCollectionGuards", () => {
    it("replaces string fields with empty string", () => {
      const resume = { experience: "5 years", name: "Test" };
      const result = applyCollectionGuards(resume, ["experience"]);
      expect(result.experience).toBe("");
      expect(result.name).toBe("Test");
    });

    it("replaces array fields with empty array", () => {
      const resume = { workHistory: ["job1"], name: "Test" };
      const result = applyCollectionGuards(resume, ["workHistory"]);
      expect(result.workHistory).toEqual([]);
      expect(result.name).toBe("Test");
    });

    it("does not modify the original object", () => {
      const resume = { experience: "5 years", name: "Test" };
      applyCollectionGuards(resume, ["experience"]);
      expect(resume.experience).toBe("5 years");
    });

    it("returns resume unchanged when guardFieldNames is empty", () => {
      const resume = { experience: "5 years" };
      expect(applyCollectionGuards(resume, [])).toEqual(resume);
    });

    it("returns resume unchanged when guardFieldNames is not an array", () => {
      const resume = { experience: "5 years" };
      expect(applyCollectionGuards(resume, "experience" as any)).toEqual(resume);
    });

    it("returns null for null resume", () => {
      expect(applyCollectionGuards(null, ["experience"])).toBeNull();
    });

    it("returns undefined for undefined resume", () => {
      expect(applyCollectionGuards(undefined, ["experience"])).toBeUndefined();
    });

    it("applies multiple guards at once", () => {
      const resume = {
        experience: "5 years",
        workHistory: ["job1"],
        selfIntro: "Hello",
        skills: ["JS"],
        name: "Test",
      };
      const result = applyCollectionGuards(resume, [
        "experience",
        "workHistory",
        "selfIntro",
        "skills",
      ]);
      expect(result.experience).toBe("");
      expect(result.workHistory).toEqual([]);
      expect(result.selfIntro).toBe("");
      expect(result.skills).toEqual([]);
      expect(result.name).toBe("Test");
    });
  });

  describe("loadCollectionGuards", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "chrome",
        {
          storage: {
            local: {
              get: vi.fn((defaults, callback) => {
                callback(defaults);
              }),
            },
          },
        },
      );
    });

    it("resolves with stored guards from chrome.storage", async () => {
      const guards = await loadCollectionGuards();
      expect(guards).toBeDefined();
    });

    it("falls back to DEFAULT_COLLECTION_GUARDS when storage is empty", async () => {
      vi.stubGlobal(
        "chrome",
        {
          storage: {
            local: {
              get: vi.fn((defaults, callback) => {
                callback({ collectionGuards: defaults.collectionGuards });
              }),
            },
          },
        },
      );
      const guards = await loadCollectionGuards();
      expect(guards).toEqual(DEFAULT_COLLECTION_GUARDS);
    });
  });
});
