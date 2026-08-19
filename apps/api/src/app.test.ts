import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import { createAuthHeaders } from "./routes/test-auth-helpers";
import { AuthEventStorage } from "./services/auth-event-storage";
import { resetResumeScreeningDb } from "./services/database";

// Mock the Convex helper so admin audit GETs resolve without a live backend.
vi.mock("./services/convex-utils.js", () => ({
  callConvexQuery: vi.fn().mockResolvedValue(null),
  callConvexMutation: vi.fn(),
  callConvexAction: vi.fn(),
  isConvexPaginatedQueryPage: vi.fn(() => false),
  isConvexResumeIdValidationError: vi.fn(() => false),
}));

describe("createApp auth event storage wiring", () => {
  afterEach(() => {
    resetResumeScreeningDb();
  });

  it("accepts web vitals telemetry from an authenticated browser without CSRF", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "dev", role: "user" });
    const app = createApp({
      authStorage: auth.storage,
      authTtlSeconds: 3600,
    });

    const response = await app.request("/api/web-vitals/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
        Cookie: auth.headers.Cookie,
      },
      body: JSON.stringify({
        name: "LCP",
        value: 2.5,
        rating: "good",
        id: "v5-preview-smoke",
        navigationType: "navigate",
      }),
    });

    expect(response.status).toBe(200);
  });

  it("uses injected auth event storage for CSRF and workspace denials", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const eventStorage = new AuthEventStorage(auth.root);
    const app = createApp({
      authStorage: auth.storage,
      authEventStorage: eventStorage,
      authTtlSeconds: 3600,
    });

    const csrfResponse = await app.request("/api/candidate-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
        Cookie: auth.headers.Cookie,
      },
      body: JSON.stringify({
        identityKey: "resume-1",
        status: "interviewing",
      }),
    });
    expect(csrfResponse.status).toBe(403);

    const workspaceResponse = await app.request("/api/candidate-status", {
      method: "POST",
      headers: {
        ...auth.headers,
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({
        identityKey: "resume-1",
        status: "interviewing",
      }),
    });
    expect(workspaceResponse.status).toBe(403);

    const events = eventStorage.listRecent({ limit: 10 });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "csrf_reject",
          userId: auth.userId,
          workspaceSlug: "hr",
        }),
        expect.objectContaining({
          type: "workspace_access_denied",
          userId: auth.userId,
          workspaceSlug: "dev",
        }),
      ]),
    );
  });
});

describe("admin audit GET routes under /api/resumes/* (shadowing regression)", () => {
  it("serves bias-report and anomaly-alerts instead of the {resumeId} param route", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "dev", role: "admin" });
    const app = createApp({ authStorage: auth.storage, authTtlSeconds: 3600 });

    const biasResponse = await app.request("/api/resumes/bias-report?workspaceSlug=dev", {
      headers: auth.headers,
    });
    expect(biasResponse.status).toBe(200);
    const biasBody = await biasResponse.json();
    expect(biasBody.success).toBe(true);

    const alertsResponse = await app.request("/api/resumes/anomaly-alerts?workspaceSlug=dev", {
      headers: auth.headers,
    });
    expect(alertsResponse.status).toBe(200);
    const alertsBody = await alertsResponse.json();
    expect(alertsBody.success).toBe(true);
  });
});
