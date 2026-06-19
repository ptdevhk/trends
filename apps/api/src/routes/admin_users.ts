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

const AdminUserRecordSchema = z.object({
  id: z.string(),
  email: z.string().optional(),
  displayName: z.string().optional(),
  status: z.enum(["active", "disabled"]),
  createdAt: z.string(),
  identities: z.array(z.object({
    provider: z.enum(["local", "casdoor"]),
    providerSubject: z.string(),
    providerTenant: z.string().nullable(),
  })),
  memberships: z.array(z.object({
    workspaceSlug: z.string(),
    role: z.enum(["user", "admin"]),
  })),
});

const ListUsersResponseSchema = z.object({
  success: z.literal(true),
  users: z.array(AdminUserRecordSchema),
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

  const listUsersRoute = createRoute({
    method: "get",
    path: "/api/admin/users",
    tags: ["admin"],
    responses: {
      200: { description: "Users list", content: { "application/json": { schema: ListUsersResponseSchema } } },
      401: { description: "Auth required", content: { "application/json": { schema: ErrorResponseSchema } } },
      403: { description: "Admin access required", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.openapi(listUsersRoute, async (c) => {
    const gate = assertSystemAdmin(c);
    if (!gate.ok) return gate.response;
    const users = getStorage().listUsers();
    return c.json({ success: true as const, users }, 200);
  });

  const CreateUserRequestSchema = z.object({
    username: z.string().min(1).max(64),
    email: z.string().email().optional(),
    displayName: z.string().min(1).max(120).optional(),
    initialMembership: z.object({
      workspaceSlug: z.enum(["dev", "hr"]),
      role: z.enum(["user", "admin"]),
    }).optional(),
  });

  const CreateUserResponseSchema = z.object({
    success: z.literal(true),
    user: AdminUserRecordSchema,
    temporaryPassword: z.string(),
  });

  const createUserRoute = createRoute({
    method: "post",
    path: "/api/admin/users",
    tags: ["admin"],
    request: { body: { content: { "application/json": { schema: CreateUserRequestSchema } } } },
    responses: {
      201: { description: "User created", content: { "application/json": { schema: CreateUserResponseSchema } } },
      401: { description: "Auth required", content: { "application/json": { schema: ErrorResponseSchema } } },
      403: { description: "Admin access required", content: { "application/json": { schema: ErrorResponseSchema } } },
      409: { description: "Username taken", content: { "application/json": { schema: ErrorResponseSchema } } },
      500: { description: "Internal error", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.openapi(createUserRoute, async (c) => {
    const gate = assertSystemAdmin(c);
    if (!gate.ok) return gate.response;
    const auth = c.var.auth!;
    const input = c.req.valid("json");

    if (getStorage().findIdentity("local", input.username, "local")) {
      return c.json({ success: false as const, error: "Username already exists" }, 409);
    }

    const user = getStorage().createUser({ email: input.email, displayName: input.displayName });
    getStorage().linkIdentity({
      userId: user.id,
      provider: "local",
      providerSubject: input.username,
      providerTenant: "local",
      email: input.email,
      displayName: input.displayName,
    });
    const temporaryPassword = randomBytes(16).toString("base64url");
    getStorage().savePasswordCredential({
      userId: user.id,
      ...(await hashPassword(temporaryPassword)),
      mustChangePassword: false,
    });
    if (input.initialMembership) {
      getStorage().upsertMembership({
        userId: user.id,
        workspaceSlug: input.initialMembership.workspaceSlug,
        role: input.initialMembership.role,
      });
      getEventStorage().append({
        type: "membership_granted_by_admin",
        userId: user.id,
        workspaceSlug: input.initialMembership.workspaceSlug,
        sessionId: auth.sessionId,
        metadata: { operatorId: auth.user.id, role: input.initialMembership.role },
      });
    }
    getEventStorage().append({
      type: "user_created",
      userId: user.id,
      sessionId: auth.sessionId,
      metadata: { operatorId: auth.user.id, username: input.username },
    });

    const record = getStorage().listUsers().find((u) => u.id === user.id);
    if (!record) {
      // Should not happen -- user was just inserted in same transaction context.
      console.error("[admin/users:create] freshly created user not found in listUsers", user.id);
      return c.json({ success: false as const, error: "Internal error" }, 500);
    }
    return c.json({ success: true as const, user: record, temporaryPassword }, 201);
  });

  const UserIdParamSchema = z.object({ id: z.string().min(1) });
  const DisableResponseSchema = z.object({ success: z.literal(true), sessionsRevoked: z.number().int().nonnegative() });
  const EnableResponseSchema = z.object({ success: z.literal(true) });

  const AddMembershipBodySchema = z.object({
    workspaceSlug: z.enum(["dev", "hr"]),
    role: z.enum(["user", "admin"]),
  });
  const AddMembershipResponseSchema = z.object({ success: z.literal(true), created: z.boolean() });
  const DeleteMembershipResponseSchema = z.object({ success: z.literal(true), deleted: z.boolean() });
  const DeleteMembershipParamsSchema = z.object({ id: z.string().min(1), slug: z.string().min(1) });

  const disableUserRoute = createRoute({
    method: "post",
    path: "/api/admin/users/{id}/disable",
    tags: ["admin"],
    request: { params: UserIdParamSchema },
    responses: {
      200: { description: "Disabled", content: { "application/json": { schema: DisableResponseSchema } } },
      400: { description: "Self-disable blocked", content: { "application/json": { schema: ErrorResponseSchema } } },
      401: { description: "Auth required", content: { "application/json": { schema: ErrorResponseSchema } } },
      403: { description: "Admin access required", content: { "application/json": { schema: ErrorResponseSchema } } },
      404: { description: "User not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.openapi(disableUserRoute, async (c) => {
    const gate = assertSystemAdmin(c);
    if (!gate.ok) return gate.response;
    const auth = c.var.auth!;
    const { id } = c.req.valid("param");
    if (id === auth.user.id) {
      return c.json({ success: false as const, error: "Cannot disable your own account" }, 400);
    }
    // Verify the row exists (findUser returns null for disabled users — use direct row query)
    const exists = getStorage().listUsers().some((u) => u.id === id);
    if (!exists) {
      return c.json({ success: false as const, error: "User not found" }, 404);
    }
    const { changed } = getStorage().setUserStatus(id, "disabled");
    const sessionsRevoked = changed ? getStorage().revokeAllSessionsByUser(id) : 0;
    getEventStorage().append({
      type: "user_disabled",
      userId: id,
      sessionId: auth.sessionId,
      metadata: { operatorId: auth.user.id, sessionsRevoked },
    });
    return c.json({ success: true as const, sessionsRevoked }, 200);
  });

  const enableUserRoute = createRoute({
    method: "post",
    path: "/api/admin/users/{id}/enable",
    tags: ["admin"],
    request: { params: UserIdParamSchema },
    responses: {
      200: { description: "Enabled", content: { "application/json": { schema: EnableResponseSchema } } },
      401: { description: "Auth required", content: { "application/json": { schema: ErrorResponseSchema } } },
      403: { description: "Admin access required", content: { "application/json": { schema: ErrorResponseSchema } } },
      404: { description: "User not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.openapi(enableUserRoute, async (c) => {
    const gate = assertSystemAdmin(c);
    if (!gate.ok) return gate.response;
    const auth = c.var.auth!;
    const { id } = c.req.valid("param");
    const exists = getStorage().listUsers().some((u) => u.id === id);
    if (!exists) {
      return c.json({ success: false as const, error: "User not found" }, 404);
    }
    getStorage().setUserStatus(id, "active");
    getEventStorage().append({
      type: "user_enabled",
      userId: id,
      sessionId: auth.sessionId,
      metadata: { operatorId: auth.user.id },
    });
    return c.json({ success: true as const }, 200);
  });

  const addMembershipRoute = createRoute({
    method: "post",
    path: "/api/admin/users/{id}/memberships",
    tags: ["admin"],
    request: {
      params: UserIdParamSchema,
      body: {
        content: {
          "application/json": {
            schema: AddMembershipBodySchema,
          },
        },
      },
    },
    responses: {
      200: { description: "Membership upserted", content: { "application/json": { schema: AddMembershipResponseSchema } } },
      401: { description: "Auth required", content: { "application/json": { schema: ErrorResponseSchema } } },
      403: { description: "Admin access required", content: { "application/json": { schema: ErrorResponseSchema } } },
      404: { description: "User not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.openapi(addMembershipRoute, async (c) => {
    const gate = assertSystemAdmin(c);
    if (!gate.ok) return gate.response;
    const auth = c.var.auth!;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const exists = getStorage().listUsers().some((u) => u.id === id);
    if (!exists) {
      return c.json({ success: false as const, error: "User not found" }, 404);
    }

    const before = getStorage().listMemberships(id).some((m) => m.workspaceSlug === body.workspaceSlug);
    getStorage().upsertMembership({ userId: id, workspaceSlug: body.workspaceSlug, role: body.role });
    getEventStorage().append({
      type: "membership_granted_by_admin",
      userId: id,
      workspaceSlug: body.workspaceSlug,
      sessionId: auth.sessionId,
      metadata: { operatorId: auth.user.id, role: body.role },
    });
    return c.json({ success: true as const, created: !before }, 200);
  });

  const deleteMembershipRoute = createRoute({
    method: "delete",
    path: "/api/admin/users/{id}/memberships/{slug}",
    tags: ["admin"],
    request: { params: DeleteMembershipParamsSchema },
    responses: {
      200: { description: "Membership removed", content: { "application/json": { schema: DeleteMembershipResponseSchema } } },
      400: { description: "Self-demotion blocked", content: { "application/json": { schema: ErrorResponseSchema } } },
      401: { description: "Auth required", content: { "application/json": { schema: ErrorResponseSchema } } },
      403: { description: "Admin access required", content: { "application/json": { schema: ErrorResponseSchema } } },
      404: { description: "User not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.openapi(deleteMembershipRoute, async (c) => {
    const gate = assertSystemAdmin(c);
    if (!gate.ok) return gate.response;
    const auth = c.var.auth!;
    const { id, slug } = c.req.valid("param");

    // Self-demotion guard: prevent admin from removing their own dev workspace membership
    if (id === auth.user.id && slug === "dev") {
      return c.json({ success: false as const, error: "Cannot remove your own dev/admin membership" }, 400);
    }

    const exists = getStorage().listUsers().some((u) => u.id === id);
    if (!exists) {
      return c.json({ success: false as const, error: "User not found" }, 404);
    }

    const { deleted } = getStorage().deleteMembership(id, slug);
    if (deleted) {
      getEventStorage().append({
        type: "membership_revoked_by_admin",
        userId: id,
        workspaceSlug: slug,
        sessionId: auth.sessionId,
        metadata: { operatorId: auth.user.id },
      });
    }
    return c.json({ success: true as const, deleted }, 200);
  });

  return app;
}
