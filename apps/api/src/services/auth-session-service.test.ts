import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AuthSessionService } from "./auth-session-service.js";
import { AuthStorage } from "./auth-storage.js";
import { resetResumeScreeningDb } from "./database.js";

describe("auth sessions", () => {
  afterEach(() => {
    resetResumeScreeningDb();
  });

  it("creates, resolves, verifies csrf, and revokes opaque sessions", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-session-"));
    const storage = new AuthStorage(root);
    const user = storage.createUser({ email: "hr@example.com", displayName: "HR" });
    storage.upsertMembership({ userId: user.id, workspaceSlug: "hr", role: "user" });

    const service = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const created = service.createSession(user.id);

    expect(created.token).not.toBe(created.csrfToken);
    expect(storage.findSessionByTokenHash(created.token)).toBeNull();
    expect(service.resolveSession(created.token)?.user.id).toBe(user.id);
    expect(service.resolveSession(created.token)?.memberships).toEqual([
      { userId: user.id, workspaceSlug: "hr", role: "user" },
    ]);
    expect(service.verifyCsrf(created.token, created.csrfToken)).toBe(true);
    expect(service.verifyCsrf(created.token, "wrong-csrf")).toBe(false);

    service.revokeSession(created.token);
    expect(service.resolveSession(created.token)).toBeNull();
  });
});
