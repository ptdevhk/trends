import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "./app";
import { createAuthHeaders } from "./routes/test-auth-helpers";
import { AuthEventStorage } from "./services/auth-event-storage";
import { resetResumeScreeningDb } from "./services/database";

describe("createApp auth event storage wiring", () => {
  afterEach(() => {
    resetResumeScreeningDb();
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
