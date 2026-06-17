import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import resumesMatchRoutes from "./resumes_match";
import { workspaceMiddleware } from "../middleware/workspace";
import { MatchStorage, type StoredMatch } from "../services/match-storage";
import { SessionManager } from "../services/session-manager";
import type { AuthContext } from "../services/auth-types";
import { createAuthContext } from "./test-auth-helpers";
import { parseJsonBody } from "../test-utils";

function createTestApp(authContext: AuthContext | null = createAuthContext({ workspaceSlug: "dev", role: "user" })) {
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  if (authContext) {
    app.use("*", async (c, next) => {
      c.set("auth", authContext);
      await next();
    });
  }
  app.route("/", resumesMatchRoutes);
  return app;
}

function makeStoredMatch(overrides: Partial<{ resumeId: string; score: number; scoreSource: "rule" | "ai"; jobDescriptionId: string }> = {}): StoredMatch {
  return {
    id: 1,
    resumeId: overrides.resumeId ?? "r1",
    jobDescriptionId: overrides.jobDescriptionId ?? "jd1",
    score: overrides.score ?? 85,
    recommendation: "strong_match",
    highlights: ["5 years CNC experience"],
    concerns: [],
    summary: "Strong candidate",
    scoreSource: overrides.scoreSource ?? "rule",
    matchedAt: "2026-05-26T12:00:00Z",
  };
}

function makeStoredMatchRun(overrides: Partial<{ id: string; status: "completed" | "processing" | "failed" }> = {}) {
  return {
    id: overrides.id ?? "run-1",
    sessionId: "sess-1",
    jobDescriptionId: "jd1",
    sampleName: "sample-initial",
    mode: "rules_only" as const,
    status: overrides.status ?? "completed",
    totalCount: 10,
    processedCount: 10,
    failedCount: 0,
    matchedCount: 5,
    avgScore: 72,
    startedAt: "2026-05-26T12:00:00Z",
  };
}

const JSON_HEADERS = { "Content-Type": "application/json" };

describe("resumes_match", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("workspace membership", () => {
    it("rejects anonymous match run reads", async () => {
      const app = createTestApp(null);
      const response = await app.request("/api/resumes/match-runs");

      expect(response.status).toBe(401);
    });

    it("rejects match run reads from users outside the selected workspace", async () => {
      const app = createTestApp(createAuthContext({ workspaceSlug: "hr", role: "user" }));
      const response = await app.request("/api/resumes/match-runs", {
        headers: { "X-Workspace-Slug": "dev" },
      });

      expect(response.status).toBe(403);
    });

    it("allows workspace members to read match runs", async () => {
      vi.spyOn(MatchStorage.prototype, "listMatchRuns").mockReturnValue([makeStoredMatchRun()]);

      const app = createTestApp();
      const response = await app.request("/api/resumes/match-runs");

      expect(response.status).toBe(200);
    });
  });

  describe("POST /api/resumes/match", () => {
    it("rejects request without jobDescriptionId or keywords", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/match", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const payload = await parseJsonBody(response);
      expect(payload.error).toContain("jobDescriptionId or keywords is required");
    });

    it("rejects persist=false with non-rules_only mode", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/match", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          keywords: ["CNC"],
          persist: false,
          mode: "hybrid",
        }),
      });

      expect(response.status).toBe(400);
      const payload = await parseJsonBody(response);
      expect(payload.error).toContain("persist=false only supports rules_only mode");
    });

    it("rejects source=convex without persist=false", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/match", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          keywords: ["CNC"],
          source: "convex",
        }),
      });

      expect(response.status).toBe(400);
      const payload = await parseJsonBody(response);
      expect(payload.error).toContain("source=convex only supports persist=false");
    });

    it("returns 404 for non-existent session with persist=true", async () => {
      vi.spyOn(SessionManager.prototype, "getSession").mockReturnValue(null);

      const app = createTestApp();
      const response = await app.request("/api/resumes/match", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          keywords: ["CNC"],
          sessionId: "nonexistent-session",
          persist: true,
          mode: "rules_only",
        }),
      });

      expect(response.status).toBe(404);
      const payload = await parseJsonBody(response);
      expect(payload.error).toContain("Session not found");
    });
  });

  describe("POST /api/resumes/match-stream", () => {
    it("rejects source=convex", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/match-stream", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          keywords: ["CNC"],
          source: "convex",
        }),
      });

      expect(response.status).toBe(400);
      const payload = await parseJsonBody(response);
      expect(payload.error).toContain("match-stream does not support source=convex");
    });

    it("rejects persist=false", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/match-stream", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          keywords: ["CNC"],
          persist: false,
        }),
      });

      expect(response.status).toBe(400);
      const payload = await parseJsonBody(response);
      expect(payload.error).toContain("match-stream does not support persist=false");
    });

    it("rejects request without jobDescriptionId or keywords", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/match-stream", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const payload = await parseJsonBody(response);
      expect(payload.error).toContain("jobDescriptionId or keywords is required");
    });

    it("returns 404 for non-existent session", async () => {
      vi.spyOn(SessionManager.prototype, "getSession").mockReturnValue(null);

      const app = createTestApp();
      const response = await app.request("/api/resumes/match-stream", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          keywords: ["CNC"],
          sessionId: "nonexistent-session",
        }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/resumes/matches", () => {
    it("requires sessionId or jobDescriptionId", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/matches");

      expect(response.status).toBe(400);
      const payload = await parseJsonBody(response);
      expect(payload.error).toContain("sessionId or jobDescriptionId is required");
    });

    it("returns matches by sessionId", async () => {
      const storedMatch = makeStoredMatch();
      vi.spyOn(MatchStorage.prototype, "getMatchesForSession").mockReturnValue([storedMatch]);

      const app = createTestApp();
      const response = await app.request("/api/resumes/matches?sessionId=sess-1");

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ success: boolean; results: { resumeId: string; score: number }[] }>(response);
      expect(payload.success).toBe(true);
      expect(payload.results).toHaveLength(1);
      expect(payload.results[0].resumeId).toBe("r1");
      expect(payload.results[0].score).toBe(85);
    });

    it("returns matches by jobDescriptionId", async () => {
      const storedMatch = makeStoredMatch({ jobDescriptionId: "jd-sales" });
      vi.spyOn(MatchStorage.prototype, "getMatchesForJob").mockReturnValue([storedMatch]);

      const app = createTestApp();
      const response = await app.request("/api/resumes/matches?jobDescriptionId=jd-sales");

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ success: boolean; results: { jobDescriptionId: string }[] }>(response);
      expect(payload.success).toBe(true);
      expect(payload.results).toHaveLength(1);
      expect(payload.results[0].jobDescriptionId).toBe("jd-sales");
    });
  });

  describe("GET /api/resumes/match-runs", () => {
    it("returns match runs", async () => {
      const storedRun = makeStoredMatchRun();
      vi.spyOn(MatchStorage.prototype, "listMatchRuns").mockReturnValue([storedRun]);

      const app = createTestApp();
      const response = await app.request("/api/resumes/match-runs");

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ success: boolean; runs: { id: string; status: string }[] }>(response);
      expect(payload.success).toBe(true);
      expect(payload.runs).toHaveLength(1);
      expect(payload.runs[0].id).toBe("run-1");
      expect(payload.runs[0].status).toBe("completed");
    });

    it("passes query params to storage", async () => {
      const listSpy = vi.spyOn(MatchStorage.prototype, "listMatchRuns").mockReturnValue([]);

      const app = createTestApp();
      const response = await app.request("/api/resumes/match-runs?sessionId=s1&jobDescriptionId=jd1&limit=5");

      expect(response.status).toBe(200);
      expect(listSpy).toHaveBeenCalledWith({ sessionId: "s1", jobDescriptionId: "jd1", limit: 5 });
    });
  });

  describe("DELETE /api/resumes/matches", () => {
    it("clears matches and returns deleted count", async () => {
      vi.spyOn(MatchStorage.prototype, "clearMatches").mockReturnValue(15);

      const app = createTestApp();
      const response = await app.request("/api/resumes/matches", {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      const payload = await parseJsonBody(response);
      expect(payload.success).toBe(true);
      expect(payload.deleted).toBe(15);
    });

    it("passes jobDescriptionId to storage", async () => {
      const clearSpy = vi.spyOn(MatchStorage.prototype, "clearMatches").mockReturnValue(3);

      const app = createTestApp();
      const response = await app.request("/api/resumes/matches?jobDescriptionId=jd1", {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      expect(clearSpy).toHaveBeenCalledWith("jd1");
      const payload = await parseJsonBody(response);
      expect(payload.jobDescriptionId).toBe("jd1");
    });
  });
});
