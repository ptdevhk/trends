import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app";
import { config } from "../services/config";

describe("worker proxy routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("proxies summary trigger requests to the worker API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          mode: "summary",
          started_at: "2026-03-26T18:00:00+00:00",
          finished_at: "2026-03-26T18:00:01+00:00",
          message: "Summary task completed for hr",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );

    const app = createApp();
    const body = JSON.stringify({
      workspaceSlug: "hr",
      channel: "telegram",
      dryRun: true,
      templateId: "summary-daily",
    });

    const response = await app.request("/api/worker/summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      mode: "summary",
      message: "Summary task completed for hr",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(`${config.workerUrl}/worker/summary`);
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    });
  });
});
