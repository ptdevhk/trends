import type { MiddlewareHandler } from "hono";
import { getAccessLevel, isValidWorkspace, type AccessLevel, type WorkspaceSlug } from "@trends/shared";

declare module "hono" {
  interface ContextVariableMap {
    workspaceSlug: WorkspaceSlug;
    accessLevel: AccessLevel;
  }
}

const DEFAULT_WORKSPACE: WorkspaceSlug = "dev";
const WORKSPACE_HEADER = "X-Workspace-Slug";

export const workspaceMiddleware: MiddlewareHandler = async (c, next) => {
  const rawSlug = c.req.header(WORKSPACE_HEADER);
  const querySlug = c.req.query("workspaceSlug");
  const candidate = rawSlug?.trim() || querySlug?.trim() || DEFAULT_WORKSPACE;

  if (!isValidWorkspace(candidate)) {
    return c.json(
      {
        success: false,
        error: `Invalid workspace slug: ${candidate}. Allowed: dev, hr`,
      },
      400,
    );
  }

  const accessLevel = getAccessLevel(candidate);
  if (!accessLevel) {
    return c.json(
      {
        success: false,
        error: `Unable to resolve access level for workspace: ${candidate}`,
      },
      400,
    );
  }

  c.set("workspaceSlug", candidate);
  c.set("accessLevel", accessLevel);
  await next();
};

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  if (c.var.accessLevel !== "admin") {
    return c.json({ success: false, error: "Admin access required" }, 403);
  }
  await next();
};
