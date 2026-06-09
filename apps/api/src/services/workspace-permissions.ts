import type { MiddlewareHandler } from "hono";

import { hasWorkspaceRole, type AuthContext } from "./auth-types.js";

export type WorkspacePermission =
  | "resume:search"
  | "candidate:status:read"
  | "candidate:action:read"
  | "candidate:mutate"
  | "resume:export"
  | "workspace:admin";

type WorkspacePermissionInput = {
  auth?: AuthContext;
  workspaceSlug: string;
  permission: WorkspacePermission;
};

const MEMBER_PERMISSIONS: ReadonlySet<WorkspacePermission> = new Set([
  "resume:search",
  "candidate:status:read",
  "candidate:action:read",
  "candidate:mutate",
  "resume:export",
]);

const ANONYMOUS_WORKSPACE_GRANTS: Readonly<Record<string, ReadonlySet<WorkspacePermission>>> = {
  hr: new Set(["resume:search"]),
};

function normalizeWorkspaceSlug(workspaceSlug: string): string {
  return workspaceSlug.trim() || "dev";
}

export function hasWorkspacePermission(input: WorkspacePermissionInput): boolean {
  const workspaceSlug = normalizeWorkspaceSlug(input.workspaceSlug);
  const auth = input.auth;

  if (!auth) {
    return ANONYMOUS_WORKSPACE_GRANTS[workspaceSlug]?.has(input.permission) ?? false;
  }

  if (input.permission === "workspace:admin") {
    return hasWorkspaceRole(auth.memberships, workspaceSlug, ["admin"]);
  }

  return (
    hasWorkspaceRole(auth.memberships, workspaceSlug, ["user", "admin"])
    && MEMBER_PERMISSIONS.has(input.permission)
  );
}

export function requireWorkspacePermission(permission: WorkspacePermission): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.var.auth;
    const workspaceSlug = c.var.workspaceSlug;
    if (hasWorkspacePermission({ auth, workspaceSlug, permission })) {
      await next();
      return;
    }

    if (!auth) {
      c.var.authEventStorage?.append({
        type: "workspace_access_denied",
        workspaceSlug,
        reason: "authentication_required",
        metadata: {
          method: c.req.method,
          path: c.req.path,
        },
      });
      return c.json({ success: false as const, error: "Authentication required" }, 401);
    }

    c.var.authEventStorage?.append({
      type: "workspace_access_denied",
      userId: auth.user.id,
      workspaceSlug,
      sessionId: auth.sessionId,
    });
    return c.json({ success: false as const, error: "Workspace access required" }, 403);
  };
}
