import { describe, expect, it } from "vitest";

import type { ResumeItem } from "../types/resume";
import type { StoredReviewPacketRun, ReviewPacketItemSnapshot } from "../services/review-packet-storage";

import {
  toExportResumePayload,
  normalizeExportResumePayload,
  toExportEntryFields,
  toExportEntry,
  applyStoredUserRatings,
  buildExportEntriesFromResolvedResumes,
  buildReviewPacketIdentityKey,
  toReviewPacketItemSnapshot,
  buildReviewPacketEntriesFromResolvedRecords,
  buildReviewPacketDownloadPath,
  buildReviewPacketSessionId,
  buildReviewPacketFilename,
  toPublicReviewPacketRun,
  toReviewPacketStatusListItem,
} from "./resumes_packets.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResumeItem(overrides: Partial<ResumeItem> = {}): ResumeItem {
  return {
    resumeId: "r-1",
    name: "Alice",
    profileUrl: "https://example.com/alice",
    activityStatus: "Active",
    age: "30",
    experience: "5 years",
    education: "Bachelor",
    location: "Shenzhen",
    selfIntro: "Test intro",
    jobIntention: "Engineer",
    expectedSalary: "15k-25k",
    workHistory: [{ raw: "Worked at Corp" }],
    extractedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeExportResumePayload() {
  return {
    externalId: "ext-1",
    name: "Alice",
    jobIntention: "Engineer",
    location: "Shenzhen",
    age: "30",
    experience: "5 years",
    education: "Bachelor",
    expectedSalary: "15k-25k",
    profileUrl: "https://example.com/alice",
    source: undefined as string | undefined,
    selfIntro: "Test intro",
    workHistory: [{ raw: "Worked at Corp" }],
    ingestData: undefined,
  };
}

function makeEntryContext(overrides: Record<string, unknown> = {}) {
  return {
    resumeId: "r-1",
    match: { score: 0.85, recommendation: "strong_match" as const },
    action: "shortlist" as const,
    status: "contacted" as const,
    ruleScore: 0.7,
    userComment: "Good fit",
    referenceNote: "Ref note",
    ...overrides,
  };
}

function makeResolvedRecord(overrides: Partial<{
  resumeId: string;
  resume: ReturnType<typeof makeExportResumePayload>;
  identityKey: string;
  profileUrl?: string;
  name?: string;
  source?: string;
}> = {}): {
  resumeId: string;
  resume: ReturnType<typeof makeExportResumePayload>;
  identityKey: string;
  profileUrl?: string;
  name?: string;
  source?: string;
} {
  return {
    resumeId: "r-1",
    resume: makeExportResumePayload(),
    identityKey: "id-key-1",
    profileUrl: "https://example.com/alice",
    name: "Alice",
    source: undefined,
    ...overrides,
  };
}

function makeStoredRun(overrides: Partial<StoredReviewPacketRun> = {}): StoredReviewPacketRun {
  return {
    id: "run-1",
    workspaceSlug: "hr",
    source: "convex",
    format: "xlsx",
    status: "exported",
    totalCount: 5,
    exportedAt: "2024-01-01T00:00:00Z",
    items: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// toExportResumePayload
// ---------------------------------------------------------------------------

describe("toExportResumePayload", () => {
  it("maps a ResumeItem to ExportResumePayload", () => {
    const result = toExportResumePayload(makeResumeItem());
    expect(result.name).toBe("Alice");
    expect(result.jobIntention).toBe("Engineer");
    expect(result.location).toBe("Shenzhen");
    expect(result.source).toBeUndefined();
  });

  it("maps workHistory from input", () => {
    const result = toExportResumePayload(makeResumeItem({
      workHistory: [{ raw: "Company A" }, { raw: "Company B" }],
    }));
    expect(result.workHistory).toHaveLength(2);
  });

  it("sets source to undefined regardless of input", () => {
    const result = toExportResumePayload(makeResumeItem());
    expect(result.source).toBeUndefined();
  });

  it("preserves ingestData as undefined when absent", () => {
    const result = toExportResumePayload(makeResumeItem());
    expect(result.ingestData).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeExportResumePayload
// ---------------------------------------------------------------------------

describe("normalizeExportResumePayload", () => {
  it("normalizes a schema-validated resume with source", () => {
    const result = normalizeExportResumePayload({
      externalId: "ext-1",
      name: "Bob",
      jobIntention: "Manager",
      location: "Beijing",
      age: "35",
      experience: "10 years",
      education: "Master",
      expectedSalary: "30k-50k",
      profileUrl: "https://example.com/bob",
      source: "hr.job5156.com",
      selfIntro: "Experienced",
      workHistory: [],
      ingestData: undefined,
    });
    expect(result.source).toBe("hr.job5156.com");
    expect(result.name).toBe("Bob");
  });

  it("preserves undefined source", () => {
    const result = normalizeExportResumePayload({
      externalId: "ext-2",
      name: "Carol",
      jobIntention: "Designer",
      location: "Shanghai",
      age: "28",
      experience: "3 years",
      education: "Bachelor",
      expectedSalary: "10k-20k",
      profileUrl: undefined,
      source: undefined,
      selfIntro: "",
      workHistory: [],
      ingestData: undefined,
    });
    expect(result.source).toBeUndefined();
    expect(result.profileUrl).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// toExportEntryFields
// ---------------------------------------------------------------------------

describe("toExportEntryFields", () => {
  it("extracts entry fields from context", () => {
    const result = toExportEntryFields(makeEntryContext());
    expect(result.match?.score).toBe(0.85);
    expect(result.action).toBe("shortlist");
    expect(result.status).toBe("contacted");
    expect(result.ruleScore).toBe(0.7);
    expect(result.userComment).toBe("Good fit");
    expect(result.referenceNote).toBe("Ref note");
  });

  it("handles undefined optional fields", () => {
    const result = toExportEntryFields(makeEntryContext({
      userComment: undefined,
      referenceNote: undefined,
    }));
    expect(result.userComment).toBeUndefined();
    expect(result.referenceNote).toBeUndefined();
  });

  it("preserves userRating from entry context", () => {
    const result = toExportEntryFields(makeEntryContext({ userRating: 4 }));
    expect(result.userRating).toBe(4);
  });

  it("omits userRating when not provided", () => {
    const result = toExportEntryFields(makeEntryContext());
    expect(result.userRating).toBeUndefined();
  });

  it("propagates userRating through toExportEntry", () => {
    const resume = makeExportResumePayload();
    const fields = toExportEntryFields(makeEntryContext({ userRating: 3 }));
    const entry = toExportEntry("r-1", resume, fields);
    expect(entry.userRating).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// toExportEntry
// ---------------------------------------------------------------------------

describe("toExportEntry", () => {
  it("builds a ResumeExportEntry from components", () => {
    const resume = makeExportResumePayload();
    const fields = toExportEntryFields(makeEntryContext());
    const result = toExportEntry("r-1", resume, fields);
    expect(result.key).toBe("r-1");
    expect(result.resume).toBe(resume);
    expect(result.match?.score).toBe(0.85);
    expect(result.action).toBe("shortlist");
  });

  it("trims the key", () => {
    const result = toExportEntry("  r-1  ", makeExportResumePayload(), toExportEntryFields(makeEntryContext()));
    expect(result.key).toBe("r-1");
  });
});

// ---------------------------------------------------------------------------
// applyStoredUserRatings
// ---------------------------------------------------------------------------

describe("applyStoredUserRatings", () => {
  it("fills missing userRating from stored session ratings", () => {
    const entry = toExportEntry("r-1", makeExportResumePayload(), toExportEntryFields(makeEntryContext()));

    const result = applyStoredUserRatings([entry], new Map([["r-1", 5]]));

    expect(result[0]?.userRating).toBe(5);
  });

  it("keeps an explicitly provided userRating over the stored fallback", () => {
    const fields = toExportEntryFields(makeEntryContext({ userRating: 3 }));
    const entry = toExportEntry("r-1", makeExportResumePayload(), fields);

    const result = applyStoredUserRatings([entry], new Map([["r-1", 5]]));

    expect(result[0]?.userRating).toBe(3);
  });

  it("returns original entries when no stored rating exists", () => {
    const entry = toExportEntry("r-1", makeExportResumePayload(), toExportEntryFields(makeEntryContext()));

    const result = applyStoredUserRatings([entry], new Map());

    expect(result[0]).toBe(entry);
  });
});

// ---------------------------------------------------------------------------
// buildExportEntriesFromResolvedResumes
// ---------------------------------------------------------------------------

describe("buildExportEntriesFromResolvedResumes", () => {
  it("builds entries from a resolved map", () => {
    const entries = [makeEntryContext({ resumeId: "r-1" })];
    const resolved = new Map([["r-1", makeExportResumePayload()]]);
    const result = buildExportEntriesFromResolvedResumes(entries, resolved);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("r-1");
    expect(result[0].resume.name).toBe("Alice");
  });

  it("throws DataNotFoundError for missing resume IDs", () => {
    const entries = [makeEntryContext({ resumeId: "missing-id" })];
    const resolved = new Map();
    expect(() => buildExportEntriesFromResolvedResumes(entries, resolved)).toThrow(/missing-id/);
  });

  it("returns empty array for empty entries", () => {
    const result = buildExportEntriesFromResolvedResumes([], new Map());
    expect(result).toEqual([]);
  });

  it("handles multiple entries", () => {
    const entries = [
      makeEntryContext({ resumeId: "r-1" }),
      makeEntryContext({ resumeId: "r-2", match: 0.6 }),
    ];
    const resolved = new Map([
      ["r-1", makeExportResumePayload()],
      ["r-2", { ...makeExportResumePayload(), name: "Bob" }],
    ]);
    const result = buildExportEntriesFromResolvedResumes(entries, resolved);
    expect(result).toHaveLength(2);
    expect(result[0].resume.name).toBe("Alice");
    expect(result[1].resume.name).toBe("Bob");
  });
});

// ---------------------------------------------------------------------------
// buildReviewPacketIdentityKey
// ---------------------------------------------------------------------------

describe("buildReviewPacketIdentityKey", () => {
  it("uses profile identity key when available", () => {
    const result = buildReviewPacketIdentityKey({
      resumeId: "r-1",
      profileUrl: "https://my.employer.seek.com/candidates/503033454",
      source: "my.employer.seek.com",
    });
    expect(result).toContain("seek.com");
  });

  it("falls back to resumeId-based key when no profile identity", () => {
    const result = buildReviewPacketIdentityKey({
      resumeId: "r-1",
    });
    expect(result).toBe("resumeId:r-1");
  });

  it("lowercases the resumeId value", () => {
    const result = buildReviewPacketIdentityKey({
      resumeId: "R-ABC",
    });
    expect(result).toBe("resumeId:r-abc");
  });

  it("trims the resumeId value", () => {
    const result = buildReviewPacketIdentityKey({
      resumeId: "  r-1  ",
    });
    expect(result).toBe("resumeId:r-1");
  });
});

// ---------------------------------------------------------------------------
// toReviewPacketItemSnapshot
// ---------------------------------------------------------------------------

describe("toReviewPacketItemSnapshot", () => {
  it("transforms a resolved record to snapshot", () => {
    const result = toReviewPacketItemSnapshot(makeResolvedRecord({
      resumeId: "r-1",
      identityKey: "id-key-1",
      profileUrl: "https://example.com",
      name: "Alice",
      source: "test",
    }));
    expect(result.resumeId).toBe("r-1");
    expect(result.identityKey).toBe("id-key-1");
    expect(result.profileUrl).toBe("https://example.com");
    expect(result.name).toBe("Alice");
    expect(result.source).toBe("test");
  });

  it("omits optional fields when undefined", () => {
    const result = toReviewPacketItemSnapshot(makeResolvedRecord({
      profileUrl: undefined,
      name: undefined,
      source: undefined,
    }));
    expect(result.profileUrl).toBeUndefined();
    expect(result.name).toBeUndefined();
    expect(result.source).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildReviewPacketEntriesFromResolvedRecords
// ---------------------------------------------------------------------------

describe("buildReviewPacketEntriesFromResolvedRecords", () => {
  it("builds export entries and item snapshots from resolved records", () => {
    const entries = [makeEntryContext({ resumeId: "r-1" })];
    const resolved = new Map([["r-1", makeResolvedRecord()]]);
    const result = buildReviewPacketEntriesFromResolvedRecords(entries, resolved);
    expect(result.entries).toHaveLength(1);
    expect(result.items).toHaveLength(1);
    expect(result.entries[0].key).toBe("r-1");
    expect(result.items[0].resumeId).toBe("r-1");
    expect(result.items[0].identityKey).toBe("id-key-1");
  });

  it("throws DataNotFoundError for missing resume IDs", () => {
    const entries = [makeEntryContext({ resumeId: "missing-id" })];
    const resolved = new Map();
    expect(() => buildReviewPacketEntriesFromResolvedRecords(entries, resolved)).toThrow(/missing-id/);
  });

  it("returns empty arrays for empty entries", () => {
    const result = buildReviewPacketEntriesFromResolvedRecords([], new Map());
    expect(result.entries).toEqual([]);
    expect(result.items).toEqual([]);
  });

  it("handles multiple entries with different records", () => {
    const entries = [
      makeEntryContext({ resumeId: "r-1" }),
      makeEntryContext({ resumeId: "r-2" }),
    ];
    const resolved = new Map([
      ["r-1", makeResolvedRecord({ resumeId: "r-1", identityKey: "id-1" })],
      ["r-2", makeResolvedRecord({ resumeId: "r-2", identityKey: "id-2", name: "Bob" })],
    ]);
    const result = buildReviewPacketEntriesFromResolvedRecords(entries, resolved);
    expect(result.entries).toHaveLength(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].identityKey).toBe("id-1");
    expect(result.items[1].identityKey).toBe("id-2");
  });
});

// ---------------------------------------------------------------------------
// buildReviewPacketDownloadPath
// ---------------------------------------------------------------------------

describe("buildReviewPacketDownloadPath", () => {
  it("builds download path with encoded runId", () => {
    expect(buildReviewPacketDownloadPath("run-1")).toBe("/api/resumes/review-packets/run-1/download");
  });

  it("encodes special characters in runId", () => {
    expect(buildReviewPacketDownloadPath("run/1")).toBe("/api/resumes/review-packets/run%2F1/download");
  });
});

// ---------------------------------------------------------------------------
// buildReviewPacketSessionId
// ---------------------------------------------------------------------------

describe("buildReviewPacketSessionId", () => {
  it("prefixes runId with review-packet namespace", () => {
    expect(buildReviewPacketSessionId("run-1")).toBe("review-packet:run-1");
  });
});

// ---------------------------------------------------------------------------
// buildReviewPacketFilename
// ---------------------------------------------------------------------------

describe("buildReviewPacketFilename", () => {
  it("builds xlsx filename", () => {
    expect(buildReviewPacketFilename("run-1", "xlsx")).toBe("review-packet-run-1.xlsx");
  });

  it("builds csv filename", () => {
    expect(buildReviewPacketFilename("run-1", "csv")).toBe("review-packet-run-1.csv");
  });
});

// ---------------------------------------------------------------------------
// toPublicReviewPacketRun
// ---------------------------------------------------------------------------

describe("toPublicReviewPacketRun", () => {
  it("maps a stored run to public run", () => {
    const stored = makeStoredRun();
    const result = toPublicReviewPacketRun(stored);
    expect(result.id).toBe("run-1");
    expect(result.workspaceSlug).toBe("hr");
    expect(result.source).toBe("convex");
    expect(result.format).toBe("xlsx");
    expect(result.status).toBe("exported");
    expect(result.totalCount).toBe(5);
  });

  it("maps feedback import stats when present", () => {
    const stored = makeStoredRun({
      stats: {
        import: {
          importedAt: "2024-01-01T01:00:00Z",
          fileName: "reviewed.xlsx",
          totalRows: 10,
          matchedRows: 8,
          importedRows: 8,
          reviewedCount: 7,
          reviewedResumeIds: ["r1", "r2", "r3", "r4", "r5", "r6", "r7"],
          statusUpdates: 5,
          actionUpdates: 3,
          noteUpdates: 2,
          invalidRows: 1,
          duplicateRows: 0,
          warningCount: 1,
          matchedByProfileUrlCount: 2,
          nameMismatchCount: 0,
          warnings: ["Minor issue"],
        },
      },
    });
    const result = toPublicReviewPacketRun(stored);
    expect(result.stats?.import?.importedAt).toBe("2024-01-01T01:00:00Z");
    expect(result.stats?.import?.totalRows).toBe(10);
    expect(result.stats?.import?.matchedRows).toBe(8);
    expect(result.stats?.import?.warnings).toEqual(["Minor issue"]);
  });

  it("maps summary stats when present", () => {
    const stored = makeStoredRun({
      stats: {
        summary: {
          previewedAt: "2024-01-01T02:00:00Z",
          sentAt: "2024-01-01T03:00:00Z",
          channel: "wechat_work",
          reviewedCount: 5,
          pendingCount: 3,
          warningCount: 1,
          statusBreakdown: { new: 3, contacted: 2 },
          actionBreakdown: { shortlist: 2 },
        },
      },
    });
    const result = toPublicReviewPacketRun(stored);
    expect(result.stats?.summary?.channel).toBe("wechat_work");
    expect(result.stats?.summary?.reviewedCount).toBe(5);
    expect(result.stats?.summary?.statusBreakdown).toEqual({ new: 3, contacted: 2 });
  });

  it("returns undefined stats when no stats present", () => {
    const stored = makeStoredRun();
    const result = toPublicReviewPacketRun(stored);
    expect(result.stats).toBeUndefined();
  });

  it("maps error when present", () => {
    const stored = makeStoredRun({ error: "Export failed" });
    const result = toPublicReviewPacketRun(stored);
    expect(result.error).toBe("Export failed");
  });

  it("maps optional fields when present", () => {
    const stored = makeStoredRun({
      sampleName: "test-sample",
      sessionId: "sess-1",
      jobDescriptionId: "jd-1",
      packetFilename: "review-packet-run-1.xlsx",
      feedbackImportedAt: "2024-01-02T00:00:00Z",
      summarySentAt: "2024-01-03T00:00:00Z",
      summaryChannel: "wechat_work",
    });
    const result = toPublicReviewPacketRun(stored);
    expect(result.sampleName).toBe("test-sample");
    expect(result.sessionId).toBe("sess-1");
    expect(result.jobDescriptionId).toBe("jd-1");
    expect(result.packetFilename).toBe("review-packet-run-1.xlsx");
    expect(result.feedbackImportedAt).toBe("2024-01-02T00:00:00Z");
    expect(result.summarySentAt).toBe("2024-01-03T00:00:00Z");
    expect(result.summaryChannel).toBe("wechat_work");
  });
});

// ---------------------------------------------------------------------------
// toReviewPacketStatusListItem
// ---------------------------------------------------------------------------

describe("toReviewPacketStatusListItem", () => {
  it("returns a status list item from a valid record", () => {
    const result = toReviewPacketStatusListItem({
      identityKey: "id-1",
      status: "contacted",
    });
    expect(result).toEqual({ identityKey: "id-1", status: "contacted" });
  });

  it("returns null for non-record input", () => {
    expect(toReviewPacketStatusListItem(null)).toBeNull();
    expect(toReviewPacketStatusListItem(undefined)).toBeNull();
    expect(toReviewPacketStatusListItem("string")).toBeNull();
    expect(toReviewPacketStatusListItem(42)).toBeNull();
  });

  it("returns null when identityKey is missing", () => {
    expect(toReviewPacketStatusListItem({ status: "contacted" })).toBeNull();
  });

  it("returns null when status is missing", () => {
    expect(toReviewPacketStatusListItem({ identityKey: "id-1" })).toBeNull();
  });

  it("returns null when identityKey is empty string", () => {
    expect(toReviewPacketStatusListItem({ identityKey: "", status: "contacted" })).toBeNull();
  });

  it("returns null when status is empty string", () => {
    expect(toReviewPacketStatusListItem({ identityKey: "id-1", status: "" })).toBeNull();
  });

  it("stringifies non-string values", () => {
    // toStringValue converts to string, non-empty values pass
    const result = toReviewPacketStatusListItem({ identityKey: 123, status: 456 });
    expect(result).toEqual({ identityKey: "123", status: "456" });
  });
});
