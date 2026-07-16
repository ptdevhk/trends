import type { MiddlewareHandler } from "hono";
import {
  formatWorkspaceSlugList,
  isValidWorkspace,
  type WorkspaceSlug,
} from "@trends/shared";

declare module "hono" {
  interface ContextVariableMap {
    workspaceSlug: WorkspaceSlug;
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
        error: `Invalid workspace slug: ${candidate}. System teams: ${formatWorkspaceSlugList()}. Personal seats use lowercase slug format (not reserved).`,
      },
      400,
    );
  }

  c.set("workspaceSlug", candidate);
  await next();
};
