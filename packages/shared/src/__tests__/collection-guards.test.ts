import { describe, expect, it } from "vitest";

import {
  applyCollectionGuards,
  COLLECTION_GUARD_ARRAY_FIELD_NAMES,
  COLLECTION_GUARDS,
} from "../collection-guards";

const PII_FIELDS = ["experience", "jobIntention", "selfIntro"] as const;

describe("COLLECTION_GUARDS configuration", () => {
  it("registers a redaction list for every known collection source", () => {
    expect(Object.keys(COLLECTION_GUARDS).sort()).toEqual(["51job", "job5156", "seek"]);
  });

  it.each(Object.keys(COLLECTION_GUARDS))(
    "blanks all 3 PII fields for source %s",
    (sourceKey) => {
      expect(COLLECTION_GUARDS[sourceKey]).toEqual([...PII_FIELDS]);
    },
  );

  it("classifies the array-shaped collection fields", () => {
    expect(COLLECTION_GUARD_ARRAY_FIELD_NAMES.has("workHistory")).toBe(true);
    expect(COLLECTION_GUARD_ARRAY_FIELD_NAMES.has("profileEducation")).toBe(true);
    expect(COLLECTION_GUARD_ARRAY_FIELD_NAMES.has("projectExperience")).toBe(true);
    expect(COLLECTION_GUARD_ARRAY_FIELD_NAMES.has("skills")).toBe(true);
    expect(COLLECTION_GUARD_ARRAY_FIELD_NAMES.has("licences")).toBe(true);
    // PII string fields are NOT array-shaped
    for (const field of PII_FIELDS) {
      expect(COLLECTION_GUARD_ARRAY_FIELD_NAMES.has(field)).toBe(false);
    }
  });
});

describe("applyCollectionGuards", () => {
  it("returns the same object reference and blanks nothing when guardFields is empty", () => {
    const resume = { experience: "5y", jobIntention: "找销售", selfIntro: "hi" };
    const result = applyCollectionGuards(resume, []);
    expect(result).toBe(resume);
    expect(result).toEqual(resume);
  });

  it.each(Object.keys(COLLECTION_GUARDS))(
    "blanks all 3 PII string fields for source %s",
    (sourceKey) => {
      const resume = {
        name: "Alice",
        experience: "5 years in B2B sales",
        jobIntention: "期望城市：上海",
        selfIntro: "我叫 Alice，电话 13800000000",
      };
      const result = applyCollectionGuards(resume, COLLECTION_GUARDS[sourceKey]);
      for (const field of PII_FIELDS) {
        expect(result[field]).toBe("");
      }
    },
  );

  it("preserves non-guarded fields (unknown-key fallthrough)", () => {
    const resume = {
      name: "Bob",
      phone: "13800000000",
      experience: "secret PII",
      jobIntention: "secret",
      selfIntro: "secret",
    };
    const result = applyCollectionGuards(resume, COLLECTION_GUARDS.job5156);
    expect(result.name).toBe("Bob");
    expect(result.phone).toBe("13800000000");
  });

  it("uses [] for array-shaped fields and \"\" for string fields", () => {
    const resume = {
      workHistory: [{ company: "Acme" }],
      profileEducation: [{ school: "MIT" }],
      projectExperience: [{ name: "P" }],
      skills: ["python"],
      licences: ["PMP"],
      experience: "x",
      jobIntention: "x",
      selfIntro: "x",
    };
    const result = applyCollectionGuards(resume, [
      "workHistory",
      "profileEducation",
      "projectExperience",
      "skills",
      "licences",
      "experience",
      "jobIntention",
      "selfIntro",
    ]);
    expect(result.workHistory).toEqual([]);
    expect(result.profileEducation).toEqual([]);
    expect(result.projectExperience).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.licences).toEqual([]);
    expect(result.experience).toBe("");
    expect(result.jobIntention).toBe("");
    expect(result.selfIntro).toBe("");
  });

  it("sets a guard field to \"\" even when the resume does not carry it", () => {
    const result = applyCollectionGuards({ name: "Cara" }, COLLECTION_GUARDS["51job"]);
    expect(result.experience).toBe("");
    expect(result.jobIntention).toBe("");
    expect(result.selfIntro).toBe("");
  });

  it("returns a new object reference and never mutates the input", () => {
    const resume = {
      experience: "5y",
      jobIntention: "找销售",
      selfIntro: "hi",
      nested: { keep: "me" },
    };
    const result = applyCollectionGuards(resume, COLLECTION_GUARDS.seek);
    expect(result).not.toBe(resume);
    // input is untouched
    expect(resume.experience).toBe("5y");
    expect(resume.jobIntention).toBe("找销售");
    expect(resume.selfIntro).toBe("hi");
    // shallow copy: shared nested refs pass through unchanged
    expect(result.nested).toBe(resume.nested);
  });
});
