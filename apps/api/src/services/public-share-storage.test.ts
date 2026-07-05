import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getResumeScreeningDb, resetResumeScreeningDb } from "./database.js";
import {
  PublicShareStorage,
  hashPublicShareToken,
  type PublicShareSnapshotPayload,
} from "./public-share-storage.js";

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "public-share-storage-"));
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  fs.writeFileSync(path.join(root, "pyproject.toml"), "", "utf8");
  return root;
}

describe("PublicShareStorage", () => {
  let root = "";

  afterEach(() => {
    vi.restoreAllMocks();
    resetResumeScreeningDb();
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("stores multiple immutable search runs for one member session", () => {
    root = createFixtureRoot();
    const storage = new PublicShareStorage(root);

    const firstRun = storage.createSearchRun({
      workspaceSlug: "hr",
      sessionId: "session-1",
      query: { text: "CNC sales" },
      safeFilters: { locations: ["Malaysia"], status: ["offer"], showRejected: true },
      resultSetHash: "hash-cnc",
      resumeKeys: ["resume-1", "resume-2"],
      createdBy: "admin-1",
      createdAt: "2026-06-12T09:00:00.000Z",
    });
    const secondRun = storage.createSearchRun({
      workspaceSlug: "hr",
      sessionId: "session-1",
      query: { text: "Lathe service" },
      safeFilters: { locations: ["Hong Kong"] },
      resultSetHash: "hash-lathe",
      resumeKeys: ["resume-3"],
      createdBy: "admin-1",
      createdAt: "2026-06-12T09:01:00.000Z",
    });

    const runs = storage.listSearchRunsForSession({
      workspaceSlug: "hr",
      sessionId: "session-1",
    });

    expect(runs.map((run) => run.id)).toEqual([secondRun.id, firstRun.id]);
    expect(runs[0].query).toEqual({ text: "Lathe service" });
    expect(runs[1].safeFilters).toEqual({ locations: ["Malaysia"] });
  });

  it("stores multiple sanitized analysis snapshots for one run without mutating older snapshots", () => {
    root = createFixtureRoot();
    const storage = new PublicShareStorage(root);
    const run = storage.createSearchRun({
      workspaceSlug: "hr",
      sessionId: "session-1",
      query: { text: "CNC sales" },
      safeFilters: { locations: ["Malaysia"] },
      resultSetHash: "hash-cnc",
      resumeKeys: ["resume-1"],
      createdBy: "admin-1",
      createdAt: "2026-06-12T09:00:00.000Z",
    });
    const payload: PublicShareSnapshotPayload = {
      title: "CNC sales snapshot",
      search: {
        query: "CNC sales",
        filters: { locations: ["Malaysia"], status: ["offer"], showBlocked: true },
      },
      results: [{
        resumeKey: "resume-1",
        displayName: "Candidate A",
        location: "Kuala Lumpur",
        summary: "Strong CNC sales background",
        score: 91,
        recommendation: "strong_match",
        highlights: ["CNC"],
        concerns: [],
        candidateStatus: "offer",
        actions: [{ type: "shortlist" }],
        notes: "Internal only",
      }],
    };

    const firstSnapshot = storage.createAnalysisSnapshot({
      workspaceSlug: "hr",
      searchRunId: run.id,
      scoringMode: "hybrid",
      promptVersion: "prompt-v1",
      skillConfigVersion: "skills-v1",
      modelProvider: "openai",
      modelName: "gpt-test",
      resultSetHash: "hash-cnc",
      payload,
      createdBy: "admin-1",
      createdAt: "2026-06-12T09:02:00.000Z",
    });
    payload.results[0].summary = "Mutated after snapshot creation";
    const secondSnapshot = storage.createAnalysisSnapshot({
      workspaceSlug: "hr",
      searchRunId: run.id,
      scoringMode: "rules_only",
      promptVersion: "prompt-v2",
      skillConfigVersion: "skills-v2",
      modelProvider: "rules",
      modelName: "rule-v2",
      resultSetHash: "hash-cnc-v2",
      payload: {
        title: "CNC sales snapshot v2",
        search: { query: "CNC sales", filters: { locations: ["Malaysia"] } },
        results: [{ resumeKey: "resume-1", summary: "Rule snapshot" }],
      },
      createdBy: "admin-1",
      createdAt: "2026-06-12T09:03:00.000Z",
    });

    const loadedFirst = storage.getAnalysisSnapshot(firstSnapshot.id);
    const snapshots = storage.listAnalysisSnapshotsForRun(run.id);

    expect(snapshots.map((snapshot) => snapshot.id)).toEqual([secondSnapshot.id, firstSnapshot.id]);
    expect(loadedFirst?.payload.results[0]).toMatchObject({
      resumeKey: "resume-1",
      summary: "Strong CNC sales background",
    });
    expect(loadedFirst?.payload.results[0]).not.toHaveProperty("candidateStatus");
    expect(loadedFirst?.payload.results[0]).not.toHaveProperty("actions");
    expect(loadedFirst?.payload.results[0]).not.toHaveProperty("notes");
    expect(loadedFirst?.payload.search?.filters).toEqual({ locations: ["Malaysia"] });
  });

  it("stores only token hashes and resolves active public shares by raw token", () => {
    root = createFixtureRoot();
    const storage = new PublicShareStorage(root);
    const run = storage.createSearchRun({
      workspaceSlug: "hr",
      sessionId: "session-1",
      query: { text: "CNC sales" },
      safeFilters: {},
      resultSetHash: "hash-cnc",
      resumeKeys: ["resume-1"],
      createdBy: "admin-1",
    });
    const snapshot = storage.createAnalysisSnapshot({
      workspaceSlug: "hr",
      searchRunId: run.id,
      scoringMode: "hybrid",
      promptVersion: "prompt-v1",
      skillConfigVersion: "skills-v1",
      modelProvider: "openai",
      modelName: "gpt-test",
      resultSetHash: "hash-cnc",
      payload: {
        title: "Public CNC snapshot",
        search: { query: "CNC sales" },
        results: [{ resumeKey: "resume-1", summary: "Public-safe summary" }],
      },
      createdBy: "admin-1",
    });

    const share = storage.createPublicShare({
      workspaceSlug: "hr",
      targetType: "analysis_snapshot",
      targetId: snapshot.id,
      title: "Public CNC snapshot",
      description: "External recruiter view",
      createdBy: "admin-1",
      expiresAt: "2026-07-12T00:00:00.000Z",
    });

    const db = getResumeScreeningDb(root);
    const rawRows = db
      .prepare("SELECT token_hash FROM public_shares")
      .all() as Array<{ token_hash: string }>;
    const lookup = storage.lookupPublicShareByToken(share.token, {
      now: "2026-06-12T10:00:00.000Z",
    });

    expect(share.token).not.toBe(hashPublicShareToken(share.token));
    expect(JSON.stringify(rawRows)).not.toContain(share.token);
    expect(rawRows[0].token_hash).toBe(hashPublicShareToken(share.token));
    expect(lookup?.status).toBe("active");
    expect(lookup?.share).toMatchObject({
      id: share.id,
      workspaceSlug: "hr",
      targetType: "analysis_snapshot",
      targetId: snapshot.id,
      title: "Public CNC snapshot",
    });
    expect(lookup?.snapshot?.payload.results[0]).toEqual({
      resumeKey: "resume-1",
      summary: "Public-safe summary",
    });
  });

  it("marks revoked and expired public shares unavailable", () => {
    root = createFixtureRoot();
    const storage = new PublicShareStorage(root);
    const run = storage.createSearchRun({
      workspaceSlug: "hr",
      sessionId: "session-1",
      query: { text: "CNC sales" },
      safeFilters: {},
      resultSetHash: "hash-cnc",
      resumeKeys: ["resume-1"],
      createdBy: "admin-1",
    });
    const snapshot = storage.createAnalysisSnapshot({
      workspaceSlug: "hr",
      searchRunId: run.id,
      scoringMode: "hybrid",
      promptVersion: "prompt-v1",
      skillConfigVersion: "skills-v1",
      modelProvider: "openai",
      modelName: "gpt-test",
      resultSetHash: "hash-cnc",
      payload: { results: [{ resumeKey: "resume-1" }] },
      createdBy: "admin-1",
    });
    const revoked = storage.createPublicShare({
      workspaceSlug: "hr",
      targetType: "analysis_snapshot",
      targetId: snapshot.id,
      title: "Revoked",
      createdBy: "admin-1",
    });
    const expired = storage.createPublicShare({
      workspaceSlug: "hr",
      targetType: "analysis_snapshot",
      targetId: snapshot.id,
      title: "Expired",
      createdBy: "admin-1",
      expiresAt: "2026-06-01T00:00:00.000Z",
    });

    storage.revokePublicShare({
      shareId: revoked.id,
      revokedBy: "admin-2",
      revokedAt: "2026-06-12T10:00:00.000Z",
    });

    expect(storage.lookupPublicShareByToken(revoked.token, {
      now: "2026-06-12T10:01:00.000Z",
    })?.status).toBe("revoked");
    expect(storage.lookupPublicShareByToken(expired.token, {
      now: "2026-06-12T10:01:00.000Z",
    })?.status).toBe("expired");
  });

  it("logs malformed search run JSON records and falls back to an empty query", () => {
    root = createFixtureRoot();
    const storage = new PublicShareStorage(root);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const run = storage.createSearchRun({
      workspaceSlug: "hr",
      sessionId: "session-1",
      query: { text: "CNC sales" },
      safeFilters: {},
      resultSetHash: "hash-cnc",
      resumeKeys: ["resume-1"],
      createdBy: "admin-1",
    });

    getResumeScreeningDb(root)
      .prepare("UPDATE search_runs SET query_json = ? WHERE id = ?")
      .run("not json", run.id);

    const loaded = storage.getSearchRun(run.id);

    expect(loaded?.query).toEqual({});
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "public-share-storage JSON record parse failed:",
      expect.any(SyntaxError),
    );
  });

  it("logs malformed search run JSON arrays and falls back to empty resume keys", () => {
    root = createFixtureRoot();
    const storage = new PublicShareStorage(root);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const run = storage.createSearchRun({
      workspaceSlug: "hr",
      sessionId: "session-1",
      query: { text: "CNC sales" },
      safeFilters: {},
      resultSetHash: "hash-cnc",
      resumeKeys: ["resume-1"],
      createdBy: "admin-1",
    });

    getResumeScreeningDb(root)
      .prepare("UPDATE search_runs SET resume_keys_json = ? WHERE id = ?")
      .run("not json", run.id);

    const loaded = storage.getSearchRun(run.id);

    expect(loaded?.resumeKeys).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "public-share-storage JSON array parse failed:",
      expect.any(SyntaxError),
    );
  });
});
