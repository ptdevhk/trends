import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { AuthSessionService } from "../services/auth-session-service.js";
import { AuthStorage } from "../services/auth-storage.js";
import type { WorkspaceRole } from "../services/auth-types.js";
import { config } from "../services/config.js";
import { resetResumeScreeningDb } from "../services/database.js";

export function createAuthHeaders(input: {
  workspaceSlug: string;
  role: WorkspaceRole;
  requestWorkspaceSlug?: string;
}) {
  resetResumeScreeningDb();
  const root = mkdtempSync(path.join(tmpdir(), "trends-route-auth-"));
  const storage = new AuthStorage(root);
  const user = storage.createUser({
    email: `${input.role}@example.com`,
    displayName: input.role,
  });
  storage.upsertMembership({
    userId: user.id,
    workspaceSlug: input.workspaceSlug,
    role: input.role,
  });
  const session = new AuthSessionService(storage, { ttlSeconds: 3600 }).createSession(user.id);

  return {
    root,
    storage,
    userId: user.id,
    headers: {
      "X-Workspace-Slug": input.requestWorkspaceSlug ?? input.workspaceSlug,
      "X-CSRF-Token": session.csrfToken,
      Cookie: `${config.auth.sessionCookieName}=${session.token}`,
    },
  };
}
