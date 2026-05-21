import { describe, expect, it } from "vitest";

import { normalizeEducationLevel, parseExperienceYears } from "../resume-filter-helpers.js";

describe("normalizeEducationLevel", () => {
  it("normalizes Chinese education terms", () => {
    expect(normalizeEducationLevel("博士")).toBe("phd");
    expect(normalizeEducationLevel("硕士")).toBe("master");
    expect(normalizeEducationLevel("研究生")).toBe("master");
    expect(normalizeEducationLevel("本科")).toBe("bachelor");
    expect(normalizeEducationLevel("大专")).toBe("associate");
    expect(normalizeEducationLevel("专科")).toBe("associate");
    expect(normalizeEducationLevel("中专")).toBe("high_school");
    expect(normalizeEducationLevel("高中")).toBe("high_school");
    expect(normalizeEducationLevel("中技")).toBe("high_school");
  });

  it("normalizes English education terms (Seek MY market)", () => {
    expect(normalizeEducationLevel("PhD")).toBe("phd");
    expect(normalizeEducationLevel("Ph.D.")).toBe("phd");
    expect(normalizeEducationLevel("Doctorate")).toBe("phd");
    expect(normalizeEducationLevel("Master of Engineering")).toBe("master");
    expect(normalizeEducationLevel("M.S.")).toBe("master");
    expect(normalizeEducationLevel("MBA")).toBe("master");
    expect(normalizeEducationLevel("Bachelor of Engineering")).toBe("bachelor");
    expect(normalizeEducationLevel("B.S.")).toBe("bachelor");
    expect(normalizeEducationLevel("Diploma in IT")).toBe("associate");
    expect(normalizeEducationLevel("Associate Degree")).toBe("associate");
    expect(normalizeEducationLevel("High School")).toBe("high_school");
    expect(normalizeEducationLevel("SPM")).toBe("high_school");
    expect(normalizeEducationLevel("STPM")).toBe("high_school");
  });

  it("returns null for unrecognized values", () => {
    expect(normalizeEducationLevel("")).toBeNull();
    expect(normalizeEducationLevel(null)).toBeNull();
    expect(normalizeEducationLevel(undefined)).toBeNull();
    expect(normalizeEducationLevel("Certification")).toBeNull();
    expect(normalizeEducationLevel("GCE O-Level")).toBeNull();
  });
});

describe("parseExperienceYears", () => {
  it("parses Chinese experience terms", () => {
    expect(parseExperienceYears("应届")).toBe(0);
    expect(parseExperienceYears("无经验")).toBe(0);
  });

  it("parses English zero-experience terms (Seek EN)", () => {
    expect(parseExperienceYears("fresh graduate")).toBe(0);
    expect(parseExperienceYears("Fresh Grad")).toBe(0);
    expect(parseExperienceYears("entry level")).toBe(0);
    expect(parseExperienceYears("Entry Level")).toBe(0);
    expect(parseExperienceYears("no experience")).toBe(0);
  });

  it("parses numeric ranges", () => {
    expect(parseExperienceYears("5")).toBe(5);
    expect(parseExperienceYears("3-5")).toBe(5);
    expect(parseExperienceYears("2~3")).toBe(3);
    expect(parseExperienceYears("1到3")).toBe(3);
  });

  it("returns null for unparseable values", () => {
    expect(parseExperienceYears("")).toBeNull();
    expect(parseExperienceYears(null)).toBeNull();
    expect(parseExperienceYears(undefined)).toBeNull();
    expect(parseExperienceYears("?")).toBeNull();
  });
});
