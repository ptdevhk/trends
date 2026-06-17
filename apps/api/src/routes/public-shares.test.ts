import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthContext } from "./test-auth-helpers";

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "public-shares-route-"));
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });
  fs.writeFileSync(path.join(root, "pyproject.toml"), "", "utf8");
  fs.writeFileSync(
    path.join(root, "config", "resume", "skills.md"),
    [
      "---",
      "version: 1",
      'updated_at: "2026-03-26"',
      "---",
      "",
      "## Company Patterns",
    ].join("\n"),
    "utf8"
  );
  return root;
}

async function loadPublicShareModules(root: string) {
  process.env.PROJECT_ROOT = root;
  vi.resetModules();
  const { createApp } = await import("../app");
  const { PublicShareStorage } = await import("../services/public-share-storage");
  const { resetResumeScreeningDb } = await import("../services/database");
  return {
    createApp,
    PublicShareStorage,
    resetResumeScreeningDb,
  };
}

type PublicShareCreateResponse = {
  success: boolean;
  share: {
    id: string;
    publicPath: string;
    title: string;
    targetType: string;
    targetId: string;
  };
};

type PublicShareReadResponse = {
  success: boolean;
  share: {
    id: string;
    title: string;
    createdAt: string;
    snapshot: {
      id: string;
      scoringMode: string;
      promptVersion: string;
      skillConfigVersion: string;
      modelProvider: string;
      modelName: string;
      payload: {
        title?: string;
        search?: {
          query?: string;
          filters?: Record<string, unknown>;
        };
        results: Array<Record<string, unknown>>;
      };
    };
    member?: {
      workspaceSlug: string;
      canReview: boolean;
      searchRun: {
        id: string;
        resumeKeys: string[];
        query: Record<string, unknown>;
        filters: Record<string, unknown>;
      };
    };
  };
};

function extractToken(publicPath: string): string {
  const token = publicPath.replace(/^\/s\//, "");
  expect(token).not.toBe(publicPath);
  return token;
}

describe("public share routes", () => {
  let root = "";

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.PROJECT_ROOT;
    if (root) {
      const { resetResumeScreeningDb } = await import("../services/database");
      resetResumeScreeningDb();
      fs.rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("creates a public snapshot through the share scope and reads it anonymously", async () => {
    root = createFixtureRoot();
    const { createApp } = await loadPublicShareModules(root);
    const adminApp = createApp({ authContext: createAuthContext({ workspaceSlug: "hr", role: "admin" }) });
    const publicApp = createApp();

    const createResponse = await adminApp.request("/api/public-shares", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify({
        title: "Public CNC sales snapshot",
        description: "External recruiter view",
        sessionId: "session-1",
        search: {
          query: "CNC sales",
          filters: {
            locations: ["Malaysia"],
            status: ["offer"],
            showRejected: true,
          },
        },
        analysis: {
          scoringMode: "hybrid",
          promptVersion: "prompt-v1",
          skillConfigVersion: "skills-v1",
          modelProvider: "openai",
          modelName: "gpt-test",
          resultSetHash: "hash-cnc",
        },
        results: [{
          resumeKey: "resume-1",
          displayName: "Candidate A",
          location: "Kuala Lumpur",
          summary: "Strong CNC sales background",
          score: 91,
          recommendation: "strong_match",
          highlights: ["CNC"],
          candidateStatus: "offer",
          actions: [{ type: "shortlist" }],
          notes: "Internal reviewer note",
          auditLog: [{ event: "viewed" }],
        }],
      }),
    });

    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json() as PublicShareCreateResponse;
    expect(createPayload.success).toBe(true);
    expect(createPayload.share.publicPath).toMatch(/^\/s\/[A-Za-z0-9_-]{32,}$/);
    expect(createPayload.share.targetType).toBe("analysis_snapshot");

    const readResponse = await publicApp.request(`/api/public-shares/${extractToken(createPayload.share.publicPath)}`, {
      headers: {
        "X-Workspace-Slug": "dev",
      },
    });

    expect(readResponse.status).toBe(200);
    const readPayload = await readResponse.json() as PublicShareReadResponse;
    expect(readPayload.success).toBe(true);
    expect(readPayload.share.title).toBe("Public CNC sales snapshot");
    expect(readPayload.share.snapshot).toMatchObject({
      scoringMode: "hybrid",
      promptVersion: "prompt-v1",
      skillConfigVersion: "skills-v1",
      modelProvider: "openai",
      modelName: "gpt-test",
    });
    expect(readPayload.share.snapshot.payload.search?.filters).toEqual({ locations: ["Malaysia"] });
    expect(readPayload.share.snapshot.payload.results[0]).toMatchObject({
      resumeKey: "resume-1",
      summary: "Strong CNC sales background",
    });
    expect(readPayload.share.snapshot.payload.results[0]).not.toHaveProperty("candidateStatus");
    expect(readPayload.share.snapshot.payload.results[0]).not.toHaveProperty("actions");
    expect(readPayload.share.snapshot.payload.results[0]).not.toHaveProperty("notes");
    expect(readPayload.share.snapshot.payload.results[0]).not.toHaveProperty("auditLog");
    expect(readPayload.share).not.toHaveProperty("member");
  });

  it("exposes search-run resume keys only to authenticated members of the share workspace", async () => {
    root = createFixtureRoot();
    const { createApp } = await loadPublicShareModules(root);
    const adminApp = createApp({ authContext: createAuthContext({ workspaceSlug: "hr", role: "admin" }) });
    const publicApp = createApp();
    const memberApp = createApp({ authContext: createAuthContext({ workspaceSlug: "hr", role: "user" }) });
    const otherWorkspaceApp = createApp({ authContext: createAuthContext({ workspaceSlug: "dev", role: "user" }) });

    const createResponse = await adminApp.request("/api/public-shares", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify({
        title: "China CNC sales snapshot",
        sessionId: "session-1",
        search: {
          query: "CNC 销售 China",
          filters: {
            locations: ["China"],
            minRoleYears: 1,
            roleFilterType: "sales",
            minAge: 25,
            maxAge: 40,
          },
        },
        analysis: {
          scoringMode: "hybrid",
          promptVersion: "prompt-v1",
          skillConfigVersion: "skills-v1",
          modelProvider: "openai",
          modelName: "gpt-test",
        },
        results: Array.from({ length: 3 }, (_, index) => ({
          resumeKey: `identity-${index + 1}`,
          displayName: `Candidate ${index + 1}`,
        })),
      }),
    });

    const createPayload = await createResponse.json() as PublicShareCreateResponse;
    const token = extractToken(createPayload.share.publicPath);

    const publicResponse = await publicApp.request(`/api/public-shares/${token}`);
    const publicPayload = await publicResponse.json() as PublicShareReadResponse;
    expect(publicPayload.share).not.toHaveProperty("member");

    const memberResponse = await memberApp.request(`/api/public-shares/${token}`, {
      headers: {
        "X-Workspace-Slug": "dev",
      },
    });
    expect(memberResponse.status).toBe(200);
    const memberPayload = await memberResponse.json() as PublicShareReadResponse;
    expect(memberPayload.share.member).toEqual({
      workspaceSlug: "hr",
      canReview: true,
      searchRun: {
        id: expect.any(String),
        resumeKeys: ["identity-1", "identity-2", "identity-3"],
        query: { text: "CNC 销售 China" },
        filters: {
          locations: ["China"],
          minRoleYears: 1,
          roleFilterType: "sales",
          minAge: 25,
          maxAge: 40,
        },
      },
    });

    const otherWorkspaceResponse = await otherWorkspaceApp.request(`/api/public-shares/${token}`);
    const otherWorkspacePayload = await otherWorkspaceResponse.json() as PublicShareReadResponse;
    expect(otherWorkspacePayload.share).not.toHaveProperty("member");
  });

  it("rejects public share creation when the actor lacks the create scope", async () => {
    root = createFixtureRoot();
    const { createApp } = await loadPublicShareModules(root);
    const userApp = createApp({ authContext: createAuthContext({ workspaceSlug: "hr", role: "user" }) });

    const response = await userApp.request("/api/public-shares", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify({
        title: "Denied snapshot",
        search: { query: "CNC" },
        analysis: {
          scoringMode: "hybrid",
          promptVersion: "prompt-v1",
          skillConfigVersion: "skills-v1",
          modelProvider: "openai",
          modelName: "gpt-test",
          resultSetHash: "hash-cnc",
        },
        results: [{ resumeKey: "resume-1" }],
      }),
    });

    expect(response.status).toBe(403);
  });

  it("returns gone for revoked and expired public tokens", async () => {
    root = createFixtureRoot();
    const { createApp, PublicShareStorage } = await loadPublicShareModules(root);
    const storage = new PublicShareStorage(root);
    const publicApp = createApp();
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
      revokedBy: "admin-1",
      revokedAt: "2026-06-12T10:00:00.000Z",
    });

    const revokedResponse = await publicApp.request(`/api/public-shares/${revoked.token}`);
    const expiredResponse = await publicApp.request(`/api/public-shares/${expired.token}`);

    expect(revokedResponse.status).toBe(410);
    expect(expiredResponse.status).toBe(410);
  });
});
