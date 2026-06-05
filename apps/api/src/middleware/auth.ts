import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import { AuthSessionService } from "../services/auth-session-service.js";
import { AuthStorage } from "../services/auth-storage.js";
import { config } from "../services/config.js";
import { hasWorkspaceRole, type AuthContext } from "../services/auth-types.js";

declare module "hono" {
  interface ContextVariableMap {
    auth?: AuthContext;
  }
}

type AuthMiddlewareOptions = {
  storage?: AuthStorage;
  ttlSeconds?: number;
  sessionCookieName?: string;
  csrfHeaderName?: string;
};

export function createAuthMiddleware(options: AuthMiddlewareOptions = {}) {
  const storage = options.storage ?? new AuthStorage(config.projectRoot);
  const sessions = new AuthSessionService(storage, {
    ttlSeconds: options.ttlSeconds ?? config.auth.sessionTtlSeconds,
  });
  const sessionCookieName = options.sessionCookieName ?? config.auth.sessionCookieName;
  const csrfHeaderName = options.csrfHeaderName ?? "X-CSRF-Token";

  const optionalAuth: MiddlewareHandler = async (c, next) => {
    const token = getCookie(c, sessionCookieName);
    const auth = token ? sessions.resolveSession(token) : null;
    if (auth) {
      c.set("auth", auth);
    }
    await next();
  };

  const requireWorkspaceUser: MiddlewareHandler = async (c, next) => {
    const auth = c.var.auth;
    if (!auth) {
      return c.json({ success: false as const, error: "Authentication required" }, 401);
    }
    if (!hasWorkspaceRole(auth.memberships, c.var.workspaceSlug, ["user", "admin"])) {
      return c.json({ success: false as const, error: "Workspace access required" }, 403);
    }
    await next();
  };

  const requireAdmin: MiddlewareHandler = async (c, next) => {
    const auth = c.var.auth;
    if (!auth) {
      return c.json({ success: false as const, error: "Authentication required" }, 401);
    }
    if (!hasWorkspaceRole(auth.memberships, c.var.workspaceSlug, ["admin"])) {
      return c.json({ success: false as const, error: "Admin access required" }, 403);
    }
    await next();
  };

  const requireCsrf: MiddlewareHandler = async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") {
      await next();
      return;
    }

    const token = getCookie(c, sessionCookieName);
    const csrf = c.req.header(csrfHeaderName);
    if (!token || !csrf || !sessions.verifyCsrf(token, csrf)) {
      return c.json({ success: false as const, error: "CSRF token required" }, 403);
    }
    await next();
  };

  return {
    optionalAuth,
    requireWorkspaceUser,
    requireAdmin,
    requireCsrf,
  };
}

const defaultAuthMiddleware = createAuthMiddleware();

export const optionalAuth = defaultAuthMiddleware.optionalAuth;
export const requireWorkspaceUser = defaultAuthMiddleware.requireWorkspaceUser;
export const requireAdmin = defaultAuthMiddleware.requireAdmin;
export const requireCsrf = defaultAuthMiddleware.requireCsrf;

export function getAuthenticatedActorId(c: { var: { auth?: AuthContext } }): string {
  const userId = c.var.auth?.user.id;
  if (!userId) {
    throw new Error("Authenticated actor required");
  }
  return userId;
}
