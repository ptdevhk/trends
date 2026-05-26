/**
 * Integration tests for sessions.ts using convex-test.
 *
 * Covers: getActiveSession, saveSession, addReviewedItem,
 * archiveSession, saveSearchHistory, recentSearches,
 * markSearchHistoryOpened, listSearchHistory.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";


// ---------------------------------------------------------------------------
// getActiveSession + saveSession
// ---------------------------------------------------------------------------

describe("sessions: getActiveSession + saveSession", () => {
  it("returns null when no active session exists", async () => {
    const t = createTest();

    const session = await t.query(api.sessions.getActiveSession, {
      sessionKey: "sk-none",
      workspaceSlug: "dev",
    });

    expect(session).toBeNull();
  });

  it("creates and retrieves an active session", async () => {
    const t = createTest();

    await t.mutation(api.sessions.saveSession, {
      sessionKey: "sk-test",
      workspaceSlug: "dev",
      location: "Shanghai",
      keywords: ["python", "django"],
      filters: {},
    });

    const session = await t.query(api.sessions.getActiveSession, {
      sessionKey: "sk-test",
      workspaceSlug: "dev",
    });

    expect(session).not.toBeNull();
    expect(session!.sessionKey).toBe("sk-test");
    expect(session!.status).toBe("active");
    expect(session!.config.location).toBe("Shanghai");
    expect(session!.config.keywords).toEqual(["python", "django"]);
  });

  it("updates an existing active session", async () => {
    const t = createTest();

    await t.mutation(api.sessions.saveSession, {
      sessionKey: "sk-update",
      workspaceSlug: "dev",
      location: "Beijing",
      keywords: ["java"],
      filters: {},
    });

    await t.mutation(api.sessions.saveSession, {
      sessionKey: "sk-update",
      workspaceSlug: "dev",
      location: "Shenzhen",
      keywords: ["golang"],
      filters: {},
    });

    const session = await t.query(api.sessions.getActiveSession, {
      sessionKey: "sk-update",
      workspaceSlug: "dev",
    });

    expect(session!.config.location).toBe("Shenzhen");
    expect(session!.config.keywords).toEqual(["golang"]);
  });

  it("isolates sessions by workspace", async () => {
    const t = createTest();

    await t.mutation(api.sessions.saveSession, {
      sessionKey: "sk-iso",
      workspaceSlug: "ws-a",
      location: "Shanghai",
      keywords: ["python"],
      filters: {},
    });

    const sessionA = await t.query(api.sessions.getActiveSession, {
      sessionKey: "sk-iso",
      workspaceSlug: "ws-a",
    });
    const sessionB = await t.query(api.sessions.getActiveSession, {
      sessionKey: "sk-iso",
      workspaceSlug: "ws-b",
    });

    expect(sessionA).not.toBeNull();
    expect(sessionB).toBeNull();
  });

  it("saves collectionSource on session", async () => {
    const t = createTest();

    await t.mutation(api.sessions.saveSession, {
      sessionKey: "sk-source",
      workspaceSlug: "dev",
      location: "Shanghai",
      keywords: ["cnc"],
      collectionSource: { type: "51job" },
      filters: {},
    });

    const session = await t.query(api.sessions.getActiveSession, {
      sessionKey: "sk-source",
      workspaceSlug: "dev",
    });

    expect(session!.config.collectionSource).toEqual({ type: "51job" });
  });
});

// ---------------------------------------------------------------------------
// addReviewedItem
// ---------------------------------------------------------------------------

describe("sessions: addReviewedItem", () => {
  it("adds a resume to the reviewed list", async () => {
    const t = createTest();

    await t.mutation(api.sessions.saveSession, {
      sessionKey: "sk-review",
      workspaceSlug: "dev",
      location: "Shanghai",
      keywords: ["python"],
      filters: {},
    });

    const result = await t.mutation(api.sessions.addReviewedItem, {
      sessionKey: "sk-review",
      workspaceSlug: "dev",
      resumeId: "resume_001",
    });

    expect(result).toBeDefined();

    const session = await t.query(api.sessions.getActiveSession, {
      sessionKey: "sk-review",
      workspaceSlug: "dev",
    });

    expect(session!.reviewedResumeIds).toContain("resume_001");
  });

  it("does not duplicate reviewed resume IDs", async () => {
    const t = createTest();

    await t.mutation(api.sessions.saveSession, {
      sessionKey: "sk-dedup",
      workspaceSlug: "dev",
      location: "Shanghai",
      keywords: ["python"],
      filters: {},
    });

    await t.mutation(api.sessions.addReviewedItem, {
      sessionKey: "sk-dedup",
      workspaceSlug: "dev",
      resumeId: "resume_002",
    });
    await t.mutation(api.sessions.addReviewedItem, {
      sessionKey: "sk-dedup",
      workspaceSlug: "dev",
      resumeId: "resume_002",
    });

    const session = await t.query(api.sessions.getActiveSession, {
      sessionKey: "sk-dedup",
      workspaceSlug: "dev",
    });

    const count = session!.reviewedResumeIds.filter((id) => id === "resume_002").length;
    expect(count).toBe(1);
  });

  it("returns null when no active session exists", async () => {
    const t = createTest();

    const result = await t.mutation(api.sessions.addReviewedItem, {
      sessionKey: "sk-noexist",
      workspaceSlug: "dev",
      resumeId: "resume_003",
    });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// archiveSession
// ---------------------------------------------------------------------------

describe("sessions: archiveSession", () => {
  it("archives an active session", async () => {
    const t = createTest();

    await t.mutation(api.sessions.saveSession, {
      sessionKey: "sk-archive",
      workspaceSlug: "dev",
      location: "Shanghai",
      keywords: ["python"],
      filters: {},
    });

    await t.mutation(api.sessions.archiveSession, {
      sessionKey: "sk-archive",
      workspaceSlug: "dev",
    });

    const session = await t.query(api.sessions.getActiveSession, {
      sessionKey: "sk-archive",
      workspaceSlug: "dev",
    });

    expect(session).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// saveSearchHistory + recentSearches + listSearchHistory
// ---------------------------------------------------------------------------

describe("sessions: search history", () => {
  it("saves and retrieves search history", async () => {
    const t = createTest();

    await t.mutation(api.sessions.saveSearchHistory, {
      sessionKey: "sk-hist",
      workspaceSlug: "dev",
      location: "Shanghai",
      keywords: ["python", "flask"],
      filters: {},
    });

    const recent = await t.query(api.sessions.recentSearches, {
      sessionKey: "sk-hist",
      workspaceSlug: "dev",
    });

    expect(recent.length).toBe(1);
    expect(recent[0].keywords).toEqual(["python", "flask"]);
    expect(recent[0].location).toBe("Shanghai");
  });

  it("generates title from location and keywords when not provided", async () => {
    const t = createTest();

    await t.mutation(api.sessions.saveSearchHistory, {
      sessionKey: "sk-title",
      workspaceSlug: "dev",
      location: "Beijing",
      keywords: ["golang"],
      filters: {},
    });

    const recent = await t.query(api.sessions.recentSearches, {
      sessionKey: "sk-title",
      workspaceSlug: "dev",
    });

    expect(recent[0].title).toContain("Beijing");
    expect(recent[0].title).toContain("golang");
  });

  it("uses custom title when provided", async () => {
    const t = createTest();

    await t.mutation(api.sessions.saveSearchHistory, {
      sessionKey: "sk-custom",
      workspaceSlug: "dev",
      title: "My Custom Search",
      location: "Shanghai",
      keywords: ["python"],
      filters: {},
    });

    const recent = await t.query(api.sessions.recentSearches, {
      sessionKey: "sk-custom",
      workspaceSlug: "dev",
    });

    expect(recent[0].title).toBe("My Custom Search");
  });

  it("limits recent searches to 10", async () => {
    const t = createTest();

    for (let i = 0; i < 12; i++) {
      await t.mutation(api.sessions.saveSearchHistory, {
        sessionKey: "sk-limit",
        workspaceSlug: "dev",
        location: `City${i}`,
        keywords: [`keyword${i}`],
        filters: {},
      });
    }

    const recent = await t.query(api.sessions.recentSearches, {
      sessionKey: "sk-limit",
      workspaceSlug: "dev",
      limit: 5,
    });

    expect(recent.length).toBe(5);
  });

  it("listSearchHistory returns all history for workspace", async () => {
    const t = createTest();

    await t.mutation(api.sessions.saveSearchHistory, {
      sessionKey: "sk-list-a",
      workspaceSlug: "ws-list",
      location: "Shanghai",
      keywords: ["python"],
      filters: {},
    });
    await t.mutation(api.sessions.saveSearchHistory, {
      sessionKey: "sk-list-b",
      workspaceSlug: "ws-list",
      location: "Beijing",
      keywords: ["java"],
      filters: {},
    });

    const history = await t.query(api.sessions.listSearchHistory, {
      workspaceSlug: "ws-list",
    });

    expect(history.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// markSearchHistoryOpened
// ---------------------------------------------------------------------------

describe("sessions: markSearchHistoryOpened", () => {
  it("updates lastOpenedAt on a search history entry", async () => {
    const t = createTest();

    const historyId = await t.mutation(api.sessions.saveSearchHistory, {
      sessionKey: "sk-open",
      workspaceSlug: "dev",
      location: "Shanghai",
      keywords: ["python"],
      filters: {},
    });

    await t.mutation(api.sessions.markSearchHistoryOpened, {
      id: historyId,
      workspaceSlug: "dev",
    });

    const history = await t.query(api.sessions.listSearchHistory, {
      workspaceSlug: "dev",
    });

    const entry = history.find((h) => String(h._id) === String(historyId));
    expect(entry).toBeDefined();
    expect(entry!.lastOpenedAt).toBeDefined();
  });

  it("returns null for history entry from another workspace", async () => {
    const t = createTest();

    const historyId = await t.mutation(api.sessions.saveSearchHistory, {
      sessionKey: "sk-ws-iso",
      workspaceSlug: "ws-a",
      location: "Shanghai",
      keywords: ["python"],
      filters: {},
    });

    // Try to mark opened from a different workspace
    const result = await t.mutation(api.sessions.markSearchHistoryOpened, {
      id: historyId,
      workspaceSlug: "ws-b",
    });

    // Should return null since it doesn't belong to ws-b
    expect(result).toBeNull();
  });
});
