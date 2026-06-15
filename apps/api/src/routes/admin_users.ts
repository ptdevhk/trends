import { randomBytes } from "node:crypto";

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { AuthEventStorage } from "../services/auth-event-storage.js";
import { AuthStorage } from "../services/auth-storage.js";
import { config } from "../services/config.js";
import { hashPassword } from "../services/local-password-provider.js";
import type { createAuthMiddleware } from "../middleware/auth.js";

const ResetPasswordRequestSchema = z.object({
  username: z.string().min(1),
});

const ResetPasswordResponseSchema = z.object({
  success: z.literal(true),
  temporaryPassword: z.string(),
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

    const auth = c.var.auth;
    if (!auth) {
      return c.json({ success: false as const, error: "Authentication required" }, 401);
    }

    // System-admin gate: must be called from the dev workspace (ADR D4).
    if (c.var.workspaceSlug !== "dev") {
      return c.json({ success: false as const, error: "Admin access required" }, 403);
    }

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

  return app;
}
