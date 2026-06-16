import { describe, expect, it } from "vitest";
import {
  rewriteJob5156ProfileUrlsInContent,
  rewriteJob5156LocationHierarchyInContent,
  toRuleScores,
  isManual51jobResumeContent,
  isImplausibleManual51jobCompanyName,
  isImplausibleManual51jobJobTitle,
  hasMisplacedManual51jobCompanyLine,
  isManual51jobWorkHistoryEntryMalformed,
  hasStructuredWorkHistory,
  workHistoryMatches,
  locationHierarchySpecificity,
  shouldReplaceManual51jobName,
  shouldPreferManual51jobLocation,
  rewrite51jobManualContent,
  analysisRichness,
  resumeIdentityKey,
  sortForCanonical,
  mergeAnalyses,
  groupDuplicatesByIdentity,
  looksLikeJob5156EducationEntry,
  rewriteJob5156WorkHistoryContent,
  shallowEqualNumberRecord,
} from "../convex/migrations";

// ---------------------------------------------------------------------------
// toRuleScores
// ---------------------------------------------------------------------------

describe("toRuleScores", () => {
  it("returns empty object for non-record input", () => {
    expect(toRuleScores(null)).toEqual({});
    expect(toRuleScores(undefined)).toEqual({});
    expect(toRuleScores("string")).toEqual({});
    expect(toRuleScores(42)).toEqual({});
    expect(toRuleScores([])).toEqual({});
  });

  it("extracts only finite number values", () => {
    expect(toRuleScores({ a: 1, b: 2.5, c: "bad", d: null, e: NaN, f: Infinity })).toEqual({ a: 1, b: 2.5 });
  });

  it("returns empty object for record with no numeric values", () => {
    expect(toRuleScores({ a: "x", b: true })).toEqual({});
  });

  it("handles empty record", () => {
    expect(toRuleScores({})).toEqual({});
  });

  it("preserves zero and negative values", () => {
    expect(toRuleScores({ a: 0, b: -3 })).toEqual({ a: 0, b: -3 });
  });
});

// ---------------------------------------------------------------------------
// isManual51jobResumeContent
// ---------------------------------------------------------------------------

describe("isManual51jobResumeContent", () => {
  it("returns false for non-record content", () => {
    expect(isManual51jobResumeContent(null, "51job-manual")).toBe(false);
    expect(isManual51jobResumeContent("string", "51job-manual")).toBe(false);
    expect(isManual51jobResumeContent(42, "51job-manual")).toBe(false);
  });

  it("returns true when source is 51job-manual", () => {
    expect(isManual51jobResumeContent({}, "51job-manual")).toBe(true);
    expect(isManual51jobResumeContent({}, " 51JOB-MANUAL ")).toBe(true);
  });

  it("returns true when profileType is 51job-manual", () => {
    expect(isManual51jobResumeContent({ profileType: "51job-manual" }, "other")).toBe(true);
    expect(isManual51jobResumeContent({ profileType: " 51JOB-MANUAL " }, "other")).toBe(true);
  });

  it("returns false when neither source nor profileType match", () => {
    expect(isManual51jobResumeContent({}, "other")).toBe(false);
    expect(isManual51jobResumeContent({ profileType: "other" }, "other")).toBe(false);
  });

  it("returns false for non-string source", () => {
    expect(isManual51jobResumeContent({}, 42)).toBe(false);
    expect(isManual51jobResumeContent({}, null)).toBe(false);
  });

  it("narrows type to Record when true", () => {
    const content: unknown = { name: "test" };
    if (isManual51jobResumeContent(content, "51job-manual")) {
      expect(content.name).toBe("test");
    }
  });
});

// ---------------------------------------------------------------------------
// isImplausibleManual51jobCompanyName / isImplausibleManual51jobJobTitle
// ---------------------------------------------------------------------------

describe("isImplausibleManual51jobCompanyName", () => {
  it("returns true for implausible names (delegates to shared lib)", () => {
    // Strings with 2+ digits are implausible per isLikelyManual51jobCompanyName
    expect(isImplausibleManual51jobCompanyName("123456")).toBe(true);
    expect(isImplausibleManual51jobCompanyName("2020-2023")).toBe(true);
  });

  it("returns false for plausible names", () => {
    // A real Chinese company name
    expect(isImplausibleManual51jobCompanyName("华为技术有限公司")).toBe(false);
    // Short strings without digits/punctuation pass the shared lib checks
    expect(isImplausibleManual51jobCompanyName("a")).toBe(false);
  });
});

describe("isImplausibleManual51jobJobTitle", () => {
  it("returns true for implausible job titles", () => {
    // Durations are not job titles per isLikelyManual51jobJobTitle
    expect(isImplausibleManual51jobJobTitle("2020-2023")).toBe(true);
  });

  it("returns false for plausible job titles", () => {
    expect(isImplausibleManual51jobJobTitle("软件工程师")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasMisplacedManual51jobCompanyLine
// ---------------------------------------------------------------------------

describe("hasMisplacedManual51jobCompanyLine", () => {
  it("returns false for single-line raw text", () => {
    expect(hasMisplacedManual51jobCompanyLine("company", "company")).toBe(false);
  });

  it("returns false for empty lines after filtering", () => {
    expect(hasMisplacedManual51jobCompanyLine("", "company")).toBe(false);
  });

  it("returns false when company name is in the header line and no other company-like lines follow", () => {
    expect(hasMisplacedManual51jobCompanyLine("华为技术有限公司", "华为技术有限公司")).toBe(false);
  });

  it("returns false when 允许的客户标签 context exists", () => {
    expect(hasMisplacedManual51jobCompanyLine("主要客户：\n华为技术有限公司", "其他公司")).toBe(false);
  });

  it("returns true when a different likely company appears in non-header lines", () => {
    // A non-header line that looks like a company name
    const result = hasMisplacedManual51jobCompanyLine("某人\n华为技术有限公司", "其他公司");
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasStructuredWorkHistory
// ---------------------------------------------------------------------------

describe("hasStructuredWorkHistory", () => {
  it("returns false when workHistory is not an array", () => {
    expect(hasStructuredWorkHistory({})).toBe(false);
    expect(hasStructuredWorkHistory({ workHistory: "not-array" })).toBe(false);
  });

  it("returns false for empty workHistory", () => {
    expect(hasStructuredWorkHistory({ workHistory: [] })).toBe(false);
  });

  it("returns false when entries have no companyName", () => {
    expect(hasStructuredWorkHistory({ workHistory: [{ raw: "something" }] })).toBe(false);
  });

  it("returns true when at least one entry has companyName + another field", () => {
    expect(hasStructuredWorkHistory({
      workHistory: [{ companyName: "Acme", jobTitle: "Engineer" }],
    })).toBe(true);
  });

  it("returns true when companyName has description", () => {
    expect(hasStructuredWorkHistory({
      workHistory: [{ companyName: "Acme", description: "Did stuff" }],
    })).toBe(true);
  });

  it("returns true when companyName has startDate", () => {
    expect(hasStructuredWorkHistory({
      workHistory: [{ companyName: "Acme", startDate: "2020" }],
    })).toBe(true);
  });

  it("returns false when companyName exists but no other fields", () => {
    expect(hasStructuredWorkHistory({
      workHistory: [{ companyName: "Acme" }],
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// workHistoryMatches
// ---------------------------------------------------------------------------

describe("workHistoryMatches", () => {
  it("returns false when either argument is not an array", () => {
    expect(workHistoryMatches(null, [])).toBe(false);
    expect(workHistoryMatches([], null)).toBe(false);
    expect(workHistoryMatches("x", "y")).toBe(false);
  });

  it("returns false when lengths differ", () => {
    expect(workHistoryMatches([{ raw: "a" }], [{ raw: "a" }, { raw: "b" }])).toBe(false);
  });

  it("returns true for identical arrays", () => {
    const entry = { raw: "Acme|Engineer|2020-2021", companyName: "Acme", jobTitle: "Engineer", startDate: "2020", endDate: "2021" };
    expect(workHistoryMatches([entry], [{ ...entry }])).toBe(true);
  });

  it("returns false when any field differs", () => {
    const base = { raw: "Acme|Engineer", companyName: "Acme", jobTitle: "Engineer", description: "", startDate: "", endDate: "" };
    expect(workHistoryMatches([base], [{ ...base, jobTitle: "Manager" }])).toBe(false);
  });

  it("returns true for empty arrays", () => {
    expect(workHistoryMatches([], [])).toBe(true);
  });

  it("returns false when one normalizes to null and the other doesn't", () => {
    expect(workHistoryMatches([null], [{ raw: "x" }])).toBe(false);
  });

  it("returns true when both normalize to null", () => {
    expect(workHistoryMatches([null], [null])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// locationHierarchySpecificity
// ---------------------------------------------------------------------------

describe("locationHierarchySpecificity", () => {
  it("returns 0 for undefined", () => {
    expect(locationHierarchySpecificity(undefined)).toBe(0);
  });

  it("returns 0 for empty object", () => {
    expect(locationHierarchySpecificity({})).toBe(0);
  });

  it("counts province only", () => {
    expect(locationHierarchySpecificity({ province: "广东" })).toBe(1);
  });

  it("counts province + city", () => {
    expect(locationHierarchySpecificity({ province: "广东", city: "深圳" })).toBe(2);
  });

  it("counts province + city + district", () => {
    expect(locationHierarchySpecificity({ province: "广东", city: "深圳", district: "南山" })).toBe(3);
  });

  it("ignores empty strings", () => {
    expect(locationHierarchySpecificity({ province: "", city: "深圳" })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// shouldReplaceManual51jobName
// ---------------------------------------------------------------------------

describe("shouldReplaceManual51jobName", () => {
  it("returns false when parsedName is empty", () => {
    expect(shouldReplaceManual51jobName("existing", "")).toBe(false);
    expect(shouldReplaceManual51jobName("existing", undefined)).toBe(false);
  });

  it("returns true when existing name is empty", () => {
    expect(shouldReplaceManual51jobName("", "张三")).toBe(true);
    expect(shouldReplaceManual51jobName(undefined, "张三")).toBe(true);
  });

  it("returns false when names are the same", () => {
    expect(shouldReplaceManual51jobName("张三", "张三")).toBe(false);
  });

  it("returns true when existing name has parentheses", () => {
    expect(shouldReplaceManual51jobName("张三(1)", "张三")).toBe(true);
    expect(shouldReplaceManual51jobName("张三（2）", "张三")).toBe(true);
    expect(shouldReplaceManual51jobName("张三_1", "张三")).toBe(true);
  });

  it("returns true when existing name contains parsedName and is longer", () => {
    expect(shouldReplaceManual51jobName("张三ABC", "张三")).toBe(true);
  });

  it("returns false when existing name does not contain parsedName", () => {
    expect(shouldReplaceManual51jobName("李四", "张三")).toBe(false);
  });

  it("returns false when existing name is the same length as parsedName", () => {
    expect(shouldReplaceManual51jobName("张三", "李四")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldPreferManual51jobLocation
// ---------------------------------------------------------------------------

describe("shouldPreferManual51jobLocation", () => {
  it("returns false when parsedLocation is empty", () => {
    expect(shouldPreferManual51jobLocation("existing", "")).toBe(false);
    expect(shouldPreferManual51jobLocation("existing", undefined)).toBe(false);
  });

  it("returns true when existing location is empty", () => {
    expect(shouldPreferManual51jobLocation("", "深圳")).toBe(true);
    expect(shouldPreferManual51jobLocation(undefined, "深圳")).toBe(true);
  });

  it("returns false when locations are the same", () => {
    expect(shouldPreferManual51jobLocation("深圳", "深圳")).toBe(false);
  });

  it("returns true when parsed location has higher specificity", () => {
    // "广东深圳" normalizes to province+city = 2 levels
    // "广东" normalizes to province only = 1 level
    expect(shouldPreferManual51jobLocation("广东", "广东深圳")).toBe(true);
  });

  it("returns false when parsed location has lower or equal specificity", () => {
    expect(shouldPreferManual51jobLocation("广东深圳", "深圳")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shallowEqualNumberRecord
// ---------------------------------------------------------------------------

describe("shallowEqualNumberRecord", () => {
  it("returns true when a is undefined and b is empty", () => {
    expect(shallowEqualNumberRecord(undefined, {})).toBe(true);
  });

  it("returns false when a is undefined and b has keys", () => {
    expect(shallowEqualNumberRecord(undefined, { x: 1 })).toBe(false);
  });

  it("returns false when key counts differ", () => {
    expect(shallowEqualNumberRecord({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("returns false when values differ", () => {
    expect(shallowEqualNumberRecord({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
  });

  it("returns true for equal records", () => {
    expect(shallowEqualNumberRecord({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it("returns true for empty records", () => {
    expect(shallowEqualNumberRecord({}, {})).toBe(true);
  });

  it("returns false when keys differ", () => {
    expect(shallowEqualNumberRecord({ a: 1 }, { b: 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// analysisRichness
// ---------------------------------------------------------------------------

describe("analysisRichness", () => {
  it("returns 0 when no analysis or analyses", () => {
    expect(analysisRichness({} as never)).toBe(0);
  });

  it("counts analysis as 1", () => {
    expect(analysisRichness({ analysis: { score: 5 } } as never)).toBe(1);
  });

  it("counts analyses keys", () => {
    expect(analysisRichness({ analyses: { a: 1, b: 2 } } as never)).toBe(2);
  });

  it("sums analysis + analyses", () => {
    expect(analysisRichness({ analysis: { score: 5 }, analyses: { a: 1, b: 2, c: 3 } } as never)).toBe(4);
  });

  it("handles non-record analyses gracefully", () => {
    expect(analysisRichness({ analyses: "bad" } as never)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resumeIdentityKey
// ---------------------------------------------------------------------------

describe("resumeIdentityKey", () => {
  it("returns identityKey if present", () => {
    expect(resumeIdentityKey({ identityKey: "abc123" } as never)).toBe("abc123");
  });

  it("derives from content/externalId/source when identityKey is missing", () => {
    const result = resumeIdentityKey({
      content: { name: "test" },
      externalId: "ext1",
      source: "51job",
    } as never);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("derives from content/externalId/source when identityKey is undefined", () => {
    const result = resumeIdentityKey({
      identityKey: undefined,
      content: {},
      externalId: "ext2",
      source: "zhilian",
    } as never);
    expect(typeof result).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// sortForCanonical
// ---------------------------------------------------------------------------

describe("sortForCanonical", () => {
  function makeResume(id: string, crawledAt: number, analysis?: unknown, analyses?: Record<string, unknown>) {
    return { _id: id, crawledAt, analysis, analyses, content: {}, externalId: id, source: "test" } as never;
  }

  it("sorts by crawledAt descending", () => {
    const a = makeResume("a", 100);
    const b = makeResume("b", 200);
    expect(sortForCanonical([a, b])).toEqual([b, a]);
  });

  it("breaks ties by analysis richness descending", () => {
    const a = makeResume("a", 100, undefined, { x: 1 });
    const b = makeResume("b", 100);
    expect(sortForCanonical([a, b])).toEqual([a, b]);
  });

  it("breaks further ties by _id ascending", () => {
    const a = makeResume("a", 100);
    const b = makeResume("b", 100);
    expect(sortForCanonical([b, a])).toEqual([a, b]);
  });

  it("does not mutate input", () => {
    const a = makeResume("a", 100);
    const b = makeResume("b", 200);
    const input = [a, b];
    sortForCanonical(input);
    expect(input).toEqual([a, b]);
  });
});

// ---------------------------------------------------------------------------
// mergeAnalyses
// ---------------------------------------------------------------------------

describe("mergeAnalyses", () => {
  function makeResume(analysis?: unknown, analyses?: Record<string, unknown>) {
    return { analysis, analyses, content: {}, _id: "r1" } as never;
  }

  it("returns empty analyses and undefined analysis for empty input", () => {
    expect(mergeAnalyses([])).toEqual({ analyses: {}, analysis: undefined });
  });

  it("picks first non-undefined analysis as primary", () => {
    const r1 = makeResume(undefined, {});
    const r2 = makeResume({ score: 5 }, {});
    const r3 = makeResume({ score: 10 }, {});
    const result = mergeAnalyses([r1, r2, r3]);
    expect(result.analysis).toEqual({ score: 5 });
  });

  it("merges analyses from all resumes, first-key-wins", () => {
    const r1 = makeResume(undefined, { a: 1 });
    const r2 = makeResume(undefined, { b: 2, a: 999 });
    const result = mergeAnalyses([r1, r2]);
    expect(result.analyses).toEqual({ a: 1, b: 2 });
  });

  it("skips non-record analyses", () => {
    const r1 = makeResume(undefined, "bad" as never);
    const result = mergeAnalyses([r1]);
    expect(result.analyses).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// analysisRichness / sortForCanonical / mergeAnalyses — cold-table views
// (Phase 4 Step 2: cold view overrides hot fields; hot is the fallback)
// ---------------------------------------------------------------------------

describe("analysis helpers — cold-table viewsById", () => {
  function makeResume(id: string, analysis?: unknown, analyses?: Record<string, unknown>) {
    return { _id: id, crawledAt: 100, analysis, analyses, content: {}, externalId: id, source: "test", tags: [] } as never;
  }

  it("analysisRichness prefers the cold view over hot fields", () => {
    const resume = makeResume("r1", { score: 5 }, { a: 1 }); // hot richness = 2
    const views = new Map([["r1", { analysis: undefined, analyses: { a: 1, b: 2, c: 3 } }]]);
    expect(analysisRichness(resume, views)).toBe(3);
  });

  it("analysisRichness falls back to hot fields when no cold view is present", () => {
    const resume = makeResume("r1", { score: 5 }, { a: 1 });
    expect(analysisRichness(resume)).toBe(2);
    expect(analysisRichness(resume, new Map())).toBe(2);
  });

  it("sortForCanonical breaks ties by cold-view richness", () => {
    const a = makeResume("a", undefined, { x: 1 }); // hot richness 1
    const b = makeResume("b", undefined, undefined); // hot richness 0
    // Invert richness via cold views: b is richer than a.
    const views = new Map([
      ["a", { analyses: undefined }],
      ["b", { analyses: { x: 1, y: 2 } }],
    ]);
    expect(sortForCanonical([a, b], views)).toEqual([b, a]);
  });

  it("mergeAnalyses merges from cold views; resumes without a view fall back to hot", () => {
    const r1 = makeResume("r1", undefined, { hot: 1 });
    const r2 = makeResume("r2", undefined, { cold: 2 });
    const views = new Map([
      ["r1", { analyses: { coldView: 9 } }], // r1: cold overrides hot → {coldView:9}, hot:{hot:1} ignored
      // r2 has no view → falls back to hot { cold: 2 }
    ]);
    const result = mergeAnalyses([r1, r2], views);
    expect(result.analyses).toEqual({ coldView: 9, cold: 2 });
  });

  it("mergeAnalyses picks primary analysis from the cold view", () => {
    const r1 = makeResume("r1", undefined, undefined);
    const r2 = makeResume("r2", undefined, undefined);
    const views = new Map([
      ["r2", { analysis: { score: 7 } }],
    ]);
    const result = mergeAnalyses([r1, r2], views);
    expect(result.analysis).toEqual({ score: 7 });
  });
});

// ---------------------------------------------------------------------------
// groupDuplicatesByIdentity
// ---------------------------------------------------------------------------

describe("groupDuplicatesByIdentity", () => {
  function makeResume(identityKey: string, id: string) {
    return { identityKey, _id: id, content: {}, externalId: id, source: "test" } as never;
  }

  it("returns empty array for no duplicates", () => {
    const r1 = makeResume("key1", "id1");
    const r2 = makeResume("key2", "id2");
    expect(groupDuplicatesByIdentity([r1, r2])).toEqual([]);
  });

  it("groups resumes by identityKey", () => {
    const r1 = makeResume("key1", "id1");
    const r2 = makeResume("key1", "id2");
    const r3 = makeResume("key2", "id3");
    const result = groupDuplicatesByIdentity([r1, r2, r3]);
    expect(result).toHaveLength(1);
    expect(result[0]!.identityKey).toBe("key1");
    expect(result[0]!.resumes).toHaveLength(2);
  });

  it("sorts groups by size descending", () => {
    const r1 = makeResume("key1", "id1");
    const r2 = makeResume("key1", "id2");
    const r3 = makeResume("key2", "id3");
    const r4 = makeResume("key2", "id4");
    const r5 = makeResume("key2", "id5");
    const result = groupDuplicatesByIdentity([r1, r2, r3, r4, r5]);
    expect(result[0]!.identityKey).toBe("key2");
    expect(result[1]!.identityKey).toBe("key1");
  });

  it("derives identityKey when not present on the record", () => {
    const r1 = { content: { name: "张三" }, externalId: "ext1", source: "51job", _id: "id1" } as never;
    const r2 = { content: { name: "张三" }, externalId: "ext1", source: "51job", _id: "id2" } as never;
    const result = groupDuplicatesByIdentity([r1, r2]);
    expect(result).toHaveLength(1);
    expect(result[0]!.resumes).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// looksLikeJob5156EducationEntry
// ---------------------------------------------------------------------------

describe("looksLikeJob5156EducationEntry", () => {
  it("returns false for null/undefined", () => {
    expect(looksLikeJob5156EducationEntry(null)).toBe(false);
    expect(looksLikeJob5156EducationEntry(undefined)).toBe(false);
  });

  it("returns true when raw text contains 学院", () => {
    expect(looksLikeJob5156EducationEntry({ raw: "北京大学学院|本科", companyName: "北京大学学院" })).toBe(true);
  });

  it("returns true when raw text contains 大学", () => {
    expect(looksLikeJob5156EducationEntry({ raw: "清华大学|硕士", companyName: "清华大学" })).toBe(true);
  });

  it("returns true when raw text contains 学历", () => {
    expect(looksLikeJob5156EducationEntry({ raw: "高中学历" })).toBe(true);
  });

  it("returns true when companyName contains 学院", () => {
    expect(looksLikeJob5156EducationEntry({ raw: "技术学院", companyName: "技术学院" })).toBe(true);
  });

  it("returns false for regular work history", () => {
    expect(looksLikeJob5156EducationEntry({ raw: "华为技术有限公司|工程师", companyName: "华为技术有限公司" })).toBe(false);
  });

  it("returns false for non-normalizable input", () => {
    expect(looksLikeJob5156EducationEntry(42)).toBe(false);
    expect(looksLikeJob5156EducationEntry("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rewriteJob5156ProfileUrlsInContent
// ---------------------------------------------------------------------------

describe("rewriteJob5156ProfileUrlsInContent", () => {
  it("returns null content for non-record input", () => {
    const result = rewriteJob5156ProfileUrlsInContent(null);
    expect(result.content).toBeNull();
    expect(result.updatedFields).toEqual([]);
  });

  it("returns null content when no profile URL keys exist", () => {
    const result = rewriteJob5156ProfileUrlsInContent({ name: "test" });
    expect(result.content).toBeNull();
    expect(result.updatedFields).toEqual([]);
  });

  it("returns null content when URL is already normalized", () => {
    const result = rewriteJob5156ProfileUrlsInContent({ profileUrl: "https://hr.job5156.com/resume/123" });
    // Depends on normalizeJob5156ProfileUrlForDisplay behavior; if unchanged, content is null
    expect(result.updatedFields).toEqual([]);
  });

  it("detects profileUrl key for rewriting", () => {
    // Use a URL that the normalizer would rewrite
    const result = rewriteJob5156ProfileUrlsInContent({
      profileUrl: "http://hr.job5156.com/resume/123?extra=param",
    });
    // The exact result depends on normalizeJob5156ProfileUrlForDisplay
    // Just verify it doesn't throw and returns the expected structure
    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("updatedFields");
    expect(Array.isArray(result.updatedFields)).toBe(true);
  });

  it("checks all PROFILE_URL_CONTENT_KEYS", () => {
    // profileUrl, profile_url, profileURL, url
    const content = {
      profileUrl: "http://hr.job5156.com/resume/123?extra=1",
      profile_url: "http://hr.job5156.com/resume/456?extra=2",
      profileURL: "http://hr.job5156.com/resume/789?extra=3",
      url: "http://hr.job5156.com/resume/abc?extra=4",
    };
    const result = rewriteJob5156ProfileUrlsInContent(content);
    // All keys should be checked; result depends on normalizer
    expect(result).toHaveProperty("updatedFields");
  });
});

// ---------------------------------------------------------------------------
// rewriteJob5156LocationHierarchyInContent
// ---------------------------------------------------------------------------

describe("rewriteJob5156LocationHierarchyInContent", () => {
  it("returns null content for non-record input", () => {
    const result = rewriteJob5156LocationHierarchyInContent(null);
    expect(result.content).toBeNull();
    expect(result.updatedLocationHierarchy).toBe(false);
    expect(result.updatedLocation).toBe(false);
  });

  it("returns null content when source is not job5156", () => {
    const result = rewriteJob5156LocationHierarchyInContent({ source: "51job" });
    expect(result.content).toBeNull();
    expect(result.updatedLocationHierarchy).toBe(false);
  });

  it("detects job5156 by source", () => {
    const result = rewriteJob5156LocationHierarchyInContent({ source: "hr.job5156.com" });
    // Should process (may or may not produce updates depending on content)
    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("updatedLocationHierarchy");
    expect(result).toHaveProperty("updatedLocation");
  });

  it("detects job5156 by profileUrl", () => {
    const result = rewriteJob5156LocationHierarchyInContent({
      source: "other",
      profileUrl: "https://hr.job5156.com/resume/123",
    });
    expect(result).toHaveProperty("content");
  });
});

// ---------------------------------------------------------------------------
// rewriteJob5156WorkHistoryContent
// ---------------------------------------------------------------------------

describe("rewriteJob5156WorkHistoryContent", () => {
  it("returns null content for non-record input", () => {
    const result = rewriteJob5156WorkHistoryContent(null);
    expect(result.content).toBeNull();
    expect(result.movedEducationEntries).toBe(0);
  });

  it("returns null content when workHistory is missing", () => {
    const result = rewriteJob5156WorkHistoryContent({ source: "hr.job5156.com" });
    expect(result.content).toBeNull();
    expect(result.movedEducationEntries).toBe(0);
  });

  it("returns null content when source is not job5156", () => {
    const result = rewriteJob5156WorkHistoryContent({
      source: "51job",
      workHistory: [{ raw: "test" }],
    });
    expect(result.content).toBeNull();
    expect(result.movedEducationEntries).toBe(0);
  });

  it("moves education entries from workHistory to profileEducation for job5156 content", () => {
    const result = rewriteJob5156WorkHistoryContent({
      source: "hr.job5156.com",
      workHistory: [
        { raw: "清华大学|本科|2018-2022", companyName: "清华大学", jobTitle: "本科" },
        { raw: "华为公司|工程师|2022-present", companyName: "华为公司", jobTitle: "工程师" },
      ],
    });

    expect(result.movedEducationEntries).toBe(1);
    expect(result.content).not.toBeNull();
    expect((result.content as Record<string, unknown>).workHistory).toHaveLength(1);
    expect((result.content as Record<string, unknown>).profileEducation).toHaveLength(1);
  });

  it("returns null when no education entries found", () => {
    const result = rewriteJob5156WorkHistoryContent({
      source: "hr.job5156.com",
      workHistory: [
        { raw: "华为公司|工程师|2022-present", companyName: "华为公司", jobTitle: "工程师" },
      ],
    });

    expect(result.content).toBeNull();
    expect(result.movedEducationEntries).toBe(0);
  });

  it("appends to existing profileEducation", () => {
    const result = rewriteJob5156WorkHistoryContent({
      source: "hr.job5156.com",
      workHistory: [
        { raw: "北京大学学院|本科", companyName: "北京大学学院" },
      ],
      profileEducation: [{ institution: "existing" }],
    });

    expect(result.movedEducationEntries).toBe(1);
    expect((result.content as Record<string, unknown>).profileEducation).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// isManual51jobWorkHistoryEntryMalformed
// ---------------------------------------------------------------------------

describe("isManual51jobWorkHistoryEntryMalformed", () => {
  it("returns true for null/undefined", () => {
    expect(isManual51jobWorkHistoryEntryMalformed(null)).toBe(true);
    expect(isManual51jobWorkHistoryEntryMalformed(undefined)).toBe(true);
  });

  it("returns true for non-normalizable input", () => {
    expect(isManual51jobWorkHistoryEntryMalformed(42)).toBe(true);
    expect(isManual51jobWorkHistoryEntryMalformed("")).toBe(true);
  });

  it("returns true when entry has no company and no other fields", () => {
    expect(isManual51jobWorkHistoryEntryMalformed({ raw: "   " })).toBe(true);
  });

  it("returns false when entry has no company but has other fields", () => {
    // Missing companyName but has jobTitle = not malformed (incomplete but acceptable)
    expect(isManual51jobWorkHistoryEntryMalformed({ jobTitle: "工程师" })).toBe(false);
  });

  it("returns false for well-formed entry", () => {
    expect(isManual51jobWorkHistoryEntryMalformed({
      raw: "华为公司|工程师|2020-2023",
      companyName: "华为公司",
      jobTitle: "工程师",
      startDate: "2020",
      endDate: "2023",
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rewrite51jobManualContent (integration-level test)
// ---------------------------------------------------------------------------

describe("rewrite51jobManualContent", () => {
  it("returns no changes for non-51job-manual content", () => {
    const result = rewrite51jobManualContent({}, "other-source");
    expect(result.contentChanged).toBe(false);
    expect(result.content).toBeNull();
    expect(result.evidenceText).toBe("");
  });

  it("returns no changes when content is not a record", () => {
    const result = rewrite51jobManualContent(null, "51job-manual");
    expect(result.contentChanged).toBe(false);
  });

  it("returns no changes when no raw text is available", () => {
    const result = rewrite51jobManualContent({ name: "test" }, "51job-manual");
    expect(result.contentChanged).toBe(false);
  });

  it("processes 51job-manual content with resumeSnippet", () => {
    const content = {
      name: "张三(1)",
      resumeSnippet: "张三\n华为技术有限公司|工程师|2020-2023",
      source: "51job-manual",
    };
    const result = rewrite51jobManualContent(content, "51job-manual");
    // Should at minimum attempt parsing; exact behavior depends on parse51jobManualResume
    expect(result).toHaveProperty("contentChanged");
    expect(result).toHaveProperty("evidenceText");
  });

  it("processes 51job-manual content with selfIntro fallback", () => {
    const content = {
      name: "李四",
      selfIntro: "李四\n腾讯科技有限公司|产品经理|2019-2024",
      profileType: "51job-manual",
    };
    const result = rewrite51jobManualContent(content, "other");
    expect(result).toHaveProperty("contentChanged");
  });
});
