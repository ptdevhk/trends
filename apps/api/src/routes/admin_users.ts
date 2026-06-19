import { randomBytes } from "node:crypto";

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { clearLoginLockout } from "../middleware/login-rate-limit.js";
import { AuthEventStorage } from "../services/auth-event-storage.js";
import { AuthStorage } from "../services/auth-storage.js";
import { config } from "../services/config.js";
import { hashPassword } from "../services/local-password-provider.js";
import type { createAuthMiddleware } from "../middleware/auth.js";

// Layered system-admin gate (ADR D4): combine with `requireAdmin` middleware to
// enforce "admin role AND in the dev workspace". `requireAdmin` covers the
// admin-role check; this helper pins the workspace to `dev`.
//
// The return type is deliberately inferred (not annotated as `{ ok: false;
// response: Response }`) so the `TypedResponse` shape from `c.json` is
// preserved — `@hono/zod-openapi` handlers reject bare `Response` returns when
// the route declares typed responses.
function assertSystemAdmin(c: Context) {
  const auth = c.var.auth;
  if (!auth) {
    return {
      ok: false as const,
      response: c.json({ success: false as const, error: "Authentication required" }, 401),
    };
  }
  if (c.var.workspaceSlug !== "dev") {
    return {
      ok: false as const,
      response: c.json({ success: false as const, error: "Admin access required" }, 403),
    };
  }
  return { ok: true as const };
}

const ResetPasswordRequestSchema = z.object({
  username: z.string().min(1),
});

const ResetPasswordResponseSchema = z.object({
  success: z.literal(true),
  temporaryPassword: z.string(),
});

const UnlockRequestSchema = z.object({
  username: z.string().min(1),
});

const UnlockResponseSchema = z.object({
  success: z.literal(true),
  cleared: z.boolean(),
  removedCount: z.number().int().nonnegative(),
});

const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

type AdminUserRoutesOptions = {
  storage?: AuthStorage;
  eventStorage?: AuthEventStorage;
  adminResetEnabled: boolean;
  authMiddleware: ReturnType<typeof createAuthMiddleware>;
};

export function createAdminUserRoutes(options: AdminUserRoutesOptions) {
  const app = new OpenAPIHono();

  let storage = options.storage;
  let eventStorage = options.eventStorage;

  function getStorage(): AuthStorage {
    storage ??= new AuthStorage(config.projectRoot);
    return storage;
  }

  function getEventStorage(): AuthEventStorage {
    eventStorage ??= new AuthEventStorage(config.projectRoot);
    return eventStorage;
  }

  // All admin user routes require admin membership.
  app.use("/api/admin/*", options.authMiddleware.requireAdmin);

  const resetPasswordRoute = createRoute({
    method: "post",
    path: "/api/admin/reset-password",
    tags: ["admin"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: ResetPasswordRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Password reset; temporary password returned",
        content: {
          "application/json": {
            schema: ResetPasswordResponseSchema,
          },
        },
      },
      400: {
        description: "Self-reset blocked",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
      401: {
        description: "Authentication required",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
      403: {
        description: "Admin access required",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
      404: {
        description: "Feature disabled or identity not found",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  });

  app.openapi(resetPasswordRoute, async (c) => {
    // Flag gate: 404 when disabled (do not advertise the endpoint).
    if (!options.adminResetEnabled) {
      return c.json({ success: false as const, error: "Not found" }, 404);
    }

    const gate = assertSystemAdmin(c);
    if (!gate.ok) return gate.response;
    const auth = c.var.auth!; // safe: gate.ok implies auth present

    const { username } = c.req.valid("json");

    // Local-identity lookup (same pattern as loginRoute).
    const identity = getStorage().findIdentity("local", username, "local");
    if (!identity) {
      return c.json(
        {
          success: false as const,
          error: `No local password identity found for username '${username}'`,
        },
        404,
      );
    }

    // Self-reset footgun: point to the self-service path.
    if (identity.userId === auth.user.id) {
      return c.json(
        {
          success: false as const,
          error: "Cannot reset your own password via admin reset; use POST /api/auth/change-password",
        },
        400,
      );
    }

    // Server-generated temporary password — admin never types a password.
    const temporaryPassword = randomBytes(16).toString("base64url");

    // Update the credential. mustChangePassword stays false — the flag is a
    // no-op (login flow does not enforce it) and setting true would repeat the
    // dead-field anti-pattern removed in #1262.
    getStorage().savePasswordCredential({
      userId: identity.userId,
      ...(await hashPassword(temporaryPassword)),
      mustChangePassword: false,
    });

    // Revoke all target sessions (no exception — target must re-authenticate).
    getStorage().revokeAllSessionsByUser(identity.userId);

    // Audit trail. Safe metadata only — never the temporary password.
    getEventStorage().append({
      type: "password_reset_completed",
      userId: identity.userId,
      workspaceSlug: c.var.workspaceSlug,
      sessionId: auth.sessionId,
      metadata: {
        resetByUserId: auth.user.id,
        provider: "local",
      },
    });

    return c.json({ success: true as const, temporaryPassword }, 200);
  });

  // POST /api/admin/auth/unlock — clear login lockout for a username.
  // Required because PR #1259's in-memory rate limiter has no auto-recovery
  // path other than waiting 15 minutes or restarting the API. For a small-team
  // product the realistic failure is the only admin fat-fingering their password
  // — this endpoint exists so a second admin can unlock them without SSH.
  const unlockRoute = createRoute({
    method: "post",
    path: "/api/admin/auth/unlock",
    tags: ["admin"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: UnlockRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Lockout cleared (or no lockout was active)",
        content: {
          "application/json": {
            schema: UnlockResponseSchema,
          },
        },
      },
      401: {
        description: "Authentication required",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
      403: {
        description: "Admin access required",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  });

  app.openapi(unlockRoute, async (c) => {
    const gate = assertSystemAdmin(c);
    if (!gate.ok) return gate.response;
    const auth = c.var.auth!; // safe: gate.ok implies auth present

    const { username } = c.req.valid("json");
    const removedCount = clearLoginLockout(username);
    const cleared = removedCount > 0;

    // Audit trail. We always emit so a successful no-op (already-unlocked user)
    // is still attributable — useful when investigating "did the unlock fire?"
    getEventStorage().append({
      type: "login_lockout_cleared",
      workspaceSlug: c.var.workspaceSlug,
      sessionId: auth.sessionId,
      metadata: {
        targetUsername: username.trim().toLowerCase(),
        clearedByUserId: auth.user.id,
        removedCount,
        cleared,
      },
    });

    return c.json({ success: true as const, cleared, removedCount }, 200);
  });

  return app;
}
