import type { MiddlewareHandler } from "hono";

import { hasWorkspaceRole, type AuthContext } from "./auth-types.js";

export type WorkspacePermission =
  | "resume:search"
  | "resume:session:create"
  | "resume:session:read"
  | "resume:analysis:run"
  | "resume:analysis:snapshot:create"
  | "resume:share:public:create"
  | "resume:share:public:read"
  | "candidate:status:read"
  | "candidate:action:read"
  | "candidate:mutate"
  | "resume:export"
  | "industry:review"
  | "workspace:admin";

export type PublicSharePrincipal = {
  type: "public-token";
  shareId: string;
  workspaceSlug: string;
};

type WorkspacePermissionInput = {
  auth?: AuthContext;
  principal?: PublicSharePrincipal;
  workspaceSlug: string;
  permission: WorkspacePermission;
};

const MEMBER_PERMISSIONS: ReadonlySet<WorkspacePermission> = new Set([
  "resume:search",
  "resume:session:create",
  "resume:session:read",
  "resume:analysis:run",
  "resume:analysis:snapshot:create",
  "candidate:status:read",
  "candidate:action:read",
  "candidate:mutate",
  "resume:export",
]);

const REVIEWER_PERMISSIONS: ReadonlySet<WorkspacePermission> = new Set([...MEMBER_PERMISSIONS, "industry:review"]);

const ADMIN_PERMISSIONS: ReadonlySet<WorkspacePermission> = new Set([
  ...MEMBER_PERMISSIONS,
  "industry:review",
  "resume:share:public:create",
]);

const PUBLIC_SHARE_PRINCIPAL_PERMISSIONS: ReadonlySet<WorkspacePermission> = new Set([
  "resume:search",
  "resume:share:public:read",
]);

const ANONYMOUS_WORKSPACE_GRANTS: Readonly<Record<string, ReadonlySet<WorkspacePermission>>> = {
  hr: new Set(["resume:search"]),
};

function normalizeWorkspaceSlug(workspaceSlug: string): string {
  return workspaceSlug.trim() || "dev";
}

export function hasWorkspacePermission(input: WorkspacePermissionInput): boolean {
  const workspaceSlug = normalizeWorkspaceSlug(input.workspaceSlug);
  if (input.principal) {
    return (
      input.principal.type === "public-token"
      && normalizeWorkspaceSlug(input.principal.workspaceSlug) === workspaceSlug
      && PUBLIC_SHARE_PRINCIPAL_PERMISSIONS.has(input.permission)
    );
  }

  const auth = input.auth;

  if (!auth) {
    return ANONYMOUS_WORKSPACE_GRANTS[workspaceSlug]?.has(input.permission) ?? false;
  }

  if (input.permission === "workspace:admin") {
    return hasWorkspaceRole(auth.memberships, workspaceSlug, ["admin"]);
  }

  if (hasWorkspaceRole(auth.memberships, workspaceSlug, ["reviewer"])) {
    return REVIEWER_PERMISSIONS.has(input.permission);
  }

  if (hasWorkspaceRole(auth.memberships, workspaceSlug, ["admin"])) {
    return ADMIN_PERMISSIONS.has(input.permission);
  }

  return (
    hasWorkspaceRole(auth.memberships, workspaceSlug, ["user"])
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
