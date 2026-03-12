import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app";
import { convexSuccess, parseConvexCall, type ConvexCall } from "../test-helpers";
import { workspaceConfigService } from "../services/workspace-config-service";

describe("candidate-status route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates candidate status successfully", async () => {
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
          workspaceSlug: "dev",
          status: "interviewing",
          updatedAt: 1_700_000_000_000,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/candidate-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({
        identityKey: "resume-1",
        status: "interviewing",
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      success: true,
      item: {
        identityKey: "resume-1",
        workspaceSlug: "dev",
        status: "interviewing",
      },
    });
    expect(payload.learningEntry).toBeUndefined();

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      type: "mutation",
      pathName: "candidate_status:upsert",
      args: {
        workspaceSlug: "dev",
        identityKey: "resume-1",
        status: "interviewing",
      },
    });
    expect(calls[1]).toMatchObject({
      type: "query",
      pathName: "candidate_status:getByIdentity",
      args: {
        workspaceSlug: "dev",
        identityKey: "resume-1",
      },
    });
  });

  it("appends learning log entry for interviewed_reject updates", async () => {
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

    const app = createApp();
    const response = await app.request("/api/candidate-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
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
      "hr",
      "reject_pattern: 经验不匹配 -> interviewed_reject"
    );
  });

  it("respects workspace isolation via X-Workspace-Slug", async () => {
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
});
