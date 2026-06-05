import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app";
import { config } from "../services/config";
import { resetResumeScreeningDb } from "../services/database";
import { workspaceConfigService } from "../services/workspace-config-service";
import { createAuthHeaders } from "./test-auth-helpers";

type ConvexCall = {
  type: "query" | "mutation";
  pathName: string;
  args: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConvexCall(input: RequestInfo | URL, init?: RequestInit): ConvexCall {
  const requestUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  const type: ConvexCall["type"] = requestUrl.includes("/api/query") ? "query" : "mutation";
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  if (!isRecord(body)) {
    throw new Error("Missing convex request body");
  }

  const pathName = typeof body.path === "string" ? body.path : "";
  const args = isRecord(body.args) ? body.args : {};
  if (!pathName) {
    throw new Error("Missing convex path in request body");
  }

  return {
    type,
    pathName,
    args,
  };
}

function convexSuccess(value: unknown): Response {
  return new Response(
    JSON.stringify({
      status: "success",
      value,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}

describe("candidate-status route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetResumeScreeningDb();
  });

  it("rejects status writes without a session", async () => {
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push(parseConvexCall(input, init));
      return convexSuccess(null);
    });

    const app = createApp();
    const response = await app.request("/api/candidate-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify({
        identityKey: "resume-1",
        status: "interviewing",
      }),
    });

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("updates candidate status successfully", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "candidate_status:upsert") {
        return convexSuccess("status-id-1");
      }
      if (call.pathName === "candidate_status:getByIdentity") {
        return convexSuccess({
          _id: "status-id-1",
          identityKey: "resume-1",
          workspaceSlug: "hr",
          status: "interviewing",
          updatedBy: auth.userId,
          updatedAt: 1_700_000_000_000,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/candidate-status", {
      method: "POST",
      headers: {
        ...auth.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        identityKey: "resume-1",
        status: "interviewing",
        updatedBy: "body-user",
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      success: true,
      item: {
        identityKey: "resume-1",
        workspaceSlug: "hr",
        status: "interviewing",
      },
    });
    expect(payload.learningEntry).toBeUndefined();

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      type: "mutation",
      pathName: "candidate_status:upsert",
      args: {
        workspaceSlug: "hr",
        identityKey: "resume-1",
        status: "interviewing",
        updatedBy: auth.userId,
        writeSecret: config.auth.convexWriteSecret,
      },
    });
    expect(calls[1]).toMatchObject({
      type: "query",
      pathName: "candidate_status:getByIdentity",
      args: {
        workspaceSlug: "hr",
        identityKey: "resume-1",
      },
    });
  });

  it("appends learning log entry for interviewed_reject updates", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "dev", role: "user" });
    const appendSpy = vi
      .spyOn(workspaceConfigService, "appendLearningLogEntry")
      .mockResolvedValue({
        date: "2026-03-03",
        observation: "reject_pattern: 经验不匹配 -> interviewed_reject",
      });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "candidate_status:upsert") {
        return convexSuccess("status-id-2");
      }
      if (call.pathName === "candidate_status:getByIdentity") {
        return convexSuccess({
          _id: "status-id-2",
          identityKey: "resume-2",
          workspaceSlug: "hr",
          status: "interviewed_reject",
          notes: "经验不匹配",
          updatedAt: 1_700_000_000_001,
        });
      }
      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/candidate-status", {
      method: "POST",
      headers: {
        ...auth.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        identityKey: "resume-2",
        status: "interviewed_reject",
        notes: "经验不匹配",
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.learningEntry).toEqual({
      date: "2026-03-03",
      observation: "reject_pattern: 经验不匹配 -> interviewed_reject",
    });
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledWith(
      "dev",
      "reject_pattern: 经验不匹配 -> interviewed_reject"
    );
  });

  it("rejects status writes when auth lacks selected workspace membership", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", requestWorkspaceSlug: "dev", role: "user" });
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      return convexSuccess(null);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/candidate-status", {
      method: "POST",
      headers: {
        ...auth.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        identityKey: "resume-1",
        status: "interviewing",
      }),
    });

    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("lists statuses for the selected workspace", async () => {
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      if (call.pathName === "candidate_status:list") {
        return convexSuccess([]);
      }
      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const hrResponse = await app.request("/api/candidate-status", {
      headers: {
        "X-Workspace-Slug": "hr",
      },
    });
    const devResponse = await app.request("/api/candidate-status");

    expect(hrResponse.status).toBe(200);
    expect(devResponse.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args.workspaceSlug).toBe("hr");
    expect(calls[1]?.args.workspaceSlug).toBe("dev");
  });

  describe("POST /api/candidate-appeal", () => {
    it("submits an appeal and returns appeal_submitted status", async () => {
      const calls: ConvexCall[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        calls.push(call);

        if (call.pathName === "audit:submitAppeal") {
          return convexSuccess({ success: true, status: "appeal_submitted" });
        }

        throw new Error(`Unexpected convex path: ${call.pathName}`);
      });

      const app = createApp();
      const response = await app.request("/api/candidate-appeal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Slug": "dev",
        },
        body: JSON.stringify({
          resumeId: "resume-abc123",
          identityKey: "candidate-1",
          reason: "I believe the score is incorrect",
        }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({
        success: true,
        status: "appeal_submitted",
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        type: "mutation",
        pathName: "audit:submitAppeal",
        args: {
          resumeId: "resume-abc123",
          identityKey: "candidate-1",
          workspaceSlug: "dev",
          reason: "I believe the score is incorrect",
        },
      });
    });

    it("rejects missing resumeId", async () => {
      const app = createApp();
      const response = await app.request("/api/candidate-appeal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identityKey: "candidate-1",
        }),
      });

      expect(response.status).toBe(400);
    });

    it("handles Convex errors gracefully", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        if (call.pathName === "audit:submitAppeal") {
          return new Response(
            JSON.stringify({ status: "error", errorMessage: "Resume not found" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        throw new Error(`Unexpected convex path: ${call.pathName}`);
      });

      const app = createApp();
      const response = await app.request("/api/candidate-appeal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resumeId: "nonexistent",
          identityKey: "candidate-1",
        }),
      });

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.success).toBe(false);
    });
  });
});
