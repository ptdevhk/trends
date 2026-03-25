import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ActionStorage, actionTypeGroup } from "./action-storage";
import { getResumeScreeningDb, resetResumeScreeningDb } from "./database";

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "action-storage-"));
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  fs.writeFileSync(path.join(root, "pyproject.toml"), "", "utf8");
  return root;
}

describe("actionTypeGroup", () => {
  it("classifies primary actions", () => {
    for (const t of ["star", "shortlist", "reject", "archive", "note", "contact"]) {
      expect(actionTypeGroup(t)).toBe("primary");
    }
  });

  it("classifies ai_score actions", () => {
    expect(actionTypeGroup("ai_score_like")).toBe("ai_score");
    expect(actionTypeGroup("ai_score_unlike")).toBe("ai_score");
  });

  it("classifies ai_summary actions", () => {
    expect(actionTypeGroup("ai_summary_like")).toBe("ai_summary");
    expect(actionTypeGroup("ai_summary_unlike")).toBe("ai_summary");
  });

  it("treats unknown action types as primary", () => {
    expect(actionTypeGroup("unknown_type")).toBe("primary");
  });
});

describe("ActionStorage", () => {
  let root: string;
  let storage: ActionStorage;

  afterEach(() => {
    resetResumeScreeningDb();
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function setup(): void {
    root = createFixtureRoot();
    storage = new ActionStorage(root);
    // Insert a session row to satisfy FK constraint on candidate_actions.session_id
    const db = getResumeScreeningDb(root);
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO search_sessions (id, status, created_at, updated_at) VALUES (?, ?, ?, ?)"
    ).run("s1", "active", now, now);
  }

  it("saves and retrieves new AI feedback action types", () => {
    setup();
    const action = storage.saveAction({
      sessionId: "s1",
      resumeId: "r1",
      actionType: "ai_score_like",
    });
    expect(action.actionType).toBe("ai_score_like");

    const all = storage.getActionsForSession("s1");
    expect(all).toHaveLength(1);
    expect(all[0]?.actionType).toBe("ai_score_like");
  });

  it("stores synthetic action scopes in action_data when no persisted session exists", () => {
    setup();

    const action = storage.saveAction({
      sessionId: "scope:lathe-sales",
      resumeId: "r1",
      actionType: "star",
    });

    expect(action.sessionId).toBe("scope:lathe-sales");

    const scoped = storage.getActionsForSession("scope:lathe-sales");
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.resumeId).toBe("r1");
    expect(scoped[0]?.actionData).toEqual({ scopeId: "scope:lathe-sales" });
  });

  describe("getLatestActionsForSession grouped retrieval", () => {
    it("returns latest primary action and latest AI feedback per resume", () => {
      setup();
      // Primary actions: star then shortlist (shortlist is latest)
      storage.saveAction({ sessionId: "s1", resumeId: "r1", actionType: "star" });
      storage.saveAction({ sessionId: "s1", resumeId: "r1", actionType: "shortlist" });

      // AI score feedback: like then unlike (unlike is latest)
      storage.saveAction({ sessionId: "s1", resumeId: "r1", actionType: "ai_score_like" });
      storage.saveAction({ sessionId: "s1", resumeId: "r1", actionType: "ai_score_unlike" });

      // AI summary feedback: just a like
      storage.saveAction({ sessionId: "s1", resumeId: "r1", actionType: "ai_summary_like" });

      const latest = storage.getLatestActionsForSession("s1");
      const types = latest.map((a) => a.actionType).sort();

      // Should have 3 entries: latest primary + latest ai_score + latest ai_summary
      expect(types).toEqual(["ai_score_unlike", "ai_summary_like", "shortlist"]);
    });

    it("returns grouped results across multiple resumes", () => {
      setup();
      storage.saveAction({ sessionId: "s1", resumeId: "r1", actionType: "star" });
      storage.saveAction({ sessionId: "s1", resumeId: "r1", actionType: "ai_score_like" });
      storage.saveAction({ sessionId: "s1", resumeId: "r2", actionType: "reject" });
      storage.saveAction({ sessionId: "s1", resumeId: "r2", actionType: "ai_summary_unlike" });

      const latest = storage.getLatestActionsForSession("s1");
      expect(latest).toHaveLength(4);

      const r1Actions = latest.filter((a) => a.resumeId === "r1").map((a) => a.actionType).sort();
      const r2Actions = latest.filter((a) => a.resumeId === "r2").map((a) => a.actionType).sort();

      expect(r1Actions).toEqual(["ai_score_like", "star"]);
      expect(r2Actions).toEqual(["ai_summary_unlike", "reject"]);
    });

    it("returns only primary action when no AI feedback exists", () => {
      setup();
      storage.saveAction({ sessionId: "s1", resumeId: "r1", actionType: "star" });
      storage.saveAction({ sessionId: "s1", resumeId: "r1", actionType: "reject" });

      const latest = storage.getLatestActionsForSession("s1");
      expect(latest).toHaveLength(1);
      expect(latest[0]?.actionType).toBe("reject");
    });

    it("filters AI feedback by job description within synthetic scopes", () => {
      setup();
      storage.saveAction({ sessionId: "keywords:cnc", resumeId: "r1", actionType: "star" });
      storage.saveAction({
        sessionId: "keywords:cnc",
        resumeId: "r1",
        actionType: "ai_score_like",
        actionData: { jobDescriptionId: "lathe-sales" },
      });
      storage.saveAction({
        sessionId: "keywords:cnc",
        resumeId: "r1",
        actionType: "ai_score_unlike",
        actionData: { jobDescriptionId: "field-service" },
      });

      const latest = storage.getLatestActionsForSession("keywords:cnc", "lathe-sales");
      expect(latest.map((action) => action.actionType).sort()).toEqual(["ai_score_like", "star"]);
    });
  });

  it("summarizes actions in a workspace window using persisted sessions and review packets", () => {
    root = createFixtureRoot();
    storage = new ActionStorage(root);
    const db = getResumeScreeningDb(root);
    const now = new Date().toISOString();

    db.prepare(
      `
      INSERT INTO search_sessions (id, workspace_slug, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      `
    ).run("session-hr", "hr", "active", now, now);
    db.prepare(
      `
      INSERT INTO search_sessions (id, workspace_slug, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      `
    ).run("session-dev", "dev", "active", now, now);
    db.prepare(
      `
      INSERT INTO review_packet_runs (
        id, workspace_slug, source, format, status, total_count, exported_at, items_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run("packet-hr", "hr", "convex", "csv", "exported", 0, now, "[]");

    storage.saveAction({ sessionId: "session-hr", resumeId: "r1", actionType: "shortlist" });
    storage.saveAction({ sessionId: "session-dev", resumeId: "r2", actionType: "reject" });
    storage.saveAction({ sessionId: "review-packet:packet-hr", resumeId: "r3", actionType: "contact" });
    storage.saveAction({ sessionId: "scope:untracked", resumeId: "r4", actionType: "star" });

    const summary = storage.summarizeActionsInWindow({
      workspaceSlug: "hr",
      startAt: "2000-01-01T00:00:00.000Z",
      endAt: "2999-01-01T00:00:00.000Z",
    });

    expect(summary.total).toBe(2);
    expect(summary.breakdown).toEqual([
      { actionType: "contact", count: 1 },
      { actionType: "shortlist", count: 1 },
    ]);
  });
});
