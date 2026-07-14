import { timingSafeEqual } from "node:crypto";

import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import type { AuthEventStorage } from "../services/auth-event-storage.js";
import { AuthSessionService } from "../services/auth-session-service.js";
import { AuthStorage } from "../services/auth-storage.js";
import { config } from "../services/config.js";
import { hasWorkspaceRole, type AuthContext } from "../services/auth-types.js";

declare module "hono" {
  interface ContextVariableMap {
    auth?: AuthContext;
    authEventStorage?: AuthEventStorage;
  }
}

type AuthMiddlewareOptions = {
  storage?: AuthStorage;
  eventStorage?: AuthEventStorage;
  ttlSeconds?: number;
  sessionCookieName?: string;
  csrfHeaderName?: string;
};

type AdminAccessError = {
  body: { success: false; error: string };
  status: 401 | 403;
};

export function getAdminAccessError(c: { var: { auth?: AuthContext; workspaceSlug: string } }): AdminAccessError | null {
  const auth = c.var.auth;
  if (!auth) {
    return {
      body: { success: false, error: "Authentication required" },
      status: 401,
    };
  }
  if (!hasWorkspaceRole(auth.memberships, c.var.workspaceSlug, ["admin"])) {
    return {
      body: { success: false, error: "Admin access required" },
      status: 403,
    };
  }
  return null;
}

export function createAuthMiddleware(options: AuthMiddlewareOptions = {}) {
  let storage = options.storage;
  let sessions: AuthSessionService | undefined;
  const sessionCookieName = options.sessionCookieName ?? config.auth.sessionCookieName;
  const csrfHeaderName = options.csrfHeaderName ?? "X-CSRF-Token";

  function getSessions(): AuthSessionService {
    storage ??= new AuthStorage(config.projectRoot);
    sessions ??= new AuthSessionService(storage, {
      ttlSeconds: options.ttlSeconds ?? config.auth.sessionTtlSeconds,
    });
    return sessions;
  }

  function getEventStorage(c: { var: { authEventStorage?: AuthEventStorage } }): AuthEventStorage | null {
    return options.eventStorage ?? c.var.authEventStorage ?? null;
  }

  const optionalAuth: MiddlewareHandler = async (c, next) => {
    const token = getCookie(c, sessionCookieName);
    const auth = token ? getSessions().resolveSession(token) : null;
    if (auth) {
      c.set("auth", auth);
    }
    await next();
  };

  const requireWorkspaceUser: MiddlewareHandler = async (c, next) => {
    const auth = c.var.auth;
    if (!auth) {
      getEventStorage(c)?.append({
        type: "workspace_access_denied",
        workspaceSlug: c.var.workspaceSlug,
        reason: "authentication_required",
        metadata: {
          method: c.req.method,
          path: c.req.path,
        },
      });
      return c.json({ success: false as const, error: "Authentication required" }, 401);
    }
    if (!hasWorkspaceRole(auth.memberships, c.var.workspaceSlug, ["user", "admin"])) {
      getEventStorage(c)?.append({
        type: "workspace_access_denied",
        userId: auth.user.id,
        workspaceSlug: c.var.workspaceSlug,
        sessionId: auth.sessionId,
      });
      return c.json({ success: false as const, error: "Workspace access required" }, 403);
    }
    await next();
  };

  const requireAdmin: MiddlewareHandler = async (c, next) => {
    const adminError = getAdminAccessError(c);
    if (adminError) {
      const auth = c.var.auth;
      if (auth) {
        const eventType = adminError.status === 401 ? "workspace_access_denied" as const : "admin_access_denied" as const;
        getEventStorage(c)?.append({
          type: eventType,
          userId: auth.user.id,
          workspaceSlug: c.var.workspaceSlug,
          sessionId: auth.sessionId,
        });
      }
      return c.json(adminError.body, adminError.status);
    }
    await next();
  };

  const requireCsrf: MiddlewareHandler = async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") {
      await next();
      return;
    }

    const token = getCookie(c, sessionCookieName);
    if (!token) {
      await next();
      return;
    }

    // Stale-cookie guard: if the cookie is present but resolves to no valid
    // session, skip CSRF and let the downstream route handle it (e.g. the
    // login route starts a fresh session).  Without this, a stale session
    // cookie blocks login with 403 because the login POST carries no CSRF
    // header — the user must manually clear browser data to recover.
    const session = getSessions().resolveSession(token);
    if (!session) {
      await next();
      return;
    }

    const csrf = c.req.header(csrfHeaderName);
    if (!csrf || !getSessions().verifyCsrf(token, csrf)) {
      const auth = c.var.auth;
      getEventStorage(c)?.append({
        type: "csrf_reject",
        userId: auth?.user.id,
        workspaceSlug: c.var.workspaceSlug,
        sessionId: auth?.sessionId,
      });
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

export const CONVEX_WRITE_SECRET_HEADER = "X-Convex-Write-Secret";

function matchesConfiguredConvexWriteSecret(value: string | undefined): boolean {
  const expected = config.auth.convexWriteSecret;
  if (!expected?.trim() || !value) {
    return false;
  }

  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(value);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export const requireAdminOrConvexWorker: MiddlewareHandler = async (c, next) => {
  if (matchesConfiguredConvexWriteSecret(c.req.header(CONVEX_WRITE_SECRET_HEADER))) {
    await next();
    return;
  }
  return requireAdmin(c, next);
};

export function getAuthenticatedActorId(c: { var: { auth?: AuthContext } }): string {
  const userId = c.var.auth?.user.id;
  if (!userId) {
    throw new Error("Authenticated actor required");
  }
  return userId;
}
