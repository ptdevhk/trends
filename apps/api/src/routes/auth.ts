import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { AuthEventStorage } from "../services/auth-event-storage.js";
import type { AuthEvent } from "../services/auth-event-types.js";
import { AuthSessionService } from "../services/auth-session-service.js";
import { AuthStorage } from "../services/auth-storage.js";
import type { AuthContext, AuthUser, WorkspaceRole } from "../services/auth-types.js";
import { config } from "../services/config.js";
import { hashPassword, verifyPassword } from "../services/local-password-provider.js";
import { CasdoorOidcProvider } from "../services/oidc-provider.js";

type AuthRoutesOptions = {
  storage?: AuthStorage;
  eventStorage?: AuthEventStorage;
  ttlSeconds?: number;
  oidcEnabled?: boolean;
  oidcProvider?: CasdoorOidcProvider;
};

const cookieOptions = {
  httpOnly: true,
  sameSite: "Lax" as const,
  secure: config.auth.secureCookies,
  path: "/",
};

const csrfCookieOptions = {
  sameSite: "Lax" as const,
  secure: config.auth.secureCookies,
  path: "/",
};

const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

const AuthUserSchema = z.object({
  id: z.string(),
  email: z.string().optional(),
  displayName: z.string().optional(),
  status: z.enum(["active", "disabled"]),
});

const MembershipSchema = z.object({
  userId: z.string(),
  workspaceSlug: z.string(),
  role: z.enum(["user", "admin"]),
});

const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const LoginResponseSchema = z.object({
  success: z.literal(true),
  user: AuthUserSchema,
  memberships: z.array(MembershipSchema),
  csrfToken: z.string(),
  expiresAt: z.string(),
});

const MeResponseSchema = z.object({
  success: z.literal(true),
  user: AuthUserSchema,
  memberships: z.array(MembershipSchema),
  workspaceRole: z.enum(["user", "admin"]).nullable(),
});

const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const SuccessResponseSchema = z.object({
  success: z.literal(true),
});

const RedirectQuerySchema = z.object({
  redirectTo: z.string().optional(),
});

function sanitizeRedirect(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function getWorkspaceRole(auth: AuthContext, workspaceSlug: string): WorkspaceRole | null {
  return auth.memberships.find((membership) => membership.workspaceSlug === workspaceSlug)?.role ?? null;
}

function setSessionCookies(
  c: Parameters<typeof setCookie>[0],
  session: { token: string; csrfToken: string; expiresAt: string },
): void {
  const expires = new Date(session.expiresAt);
  setCookie(c, config.auth.sessionCookieName, session.token, { ...cookieOptions, expires });
  setCookie(c, config.auth.csrfCookieName, session.csrfToken, { ...csrfCookieOptions, expires });
}

function clearSessionCookies(c: Parameters<typeof deleteCookie>[0]): void {
  deleteCookie(c, config.auth.sessionCookieName, { path: "/" });
  deleteCookie(c, config.auth.csrfCookieName, { path: "/" });
}

async function createSessionResponse(
  user: AuthUser,
  storage: AuthStorage,
  sessions: AuthSessionService,
  c: Parameters<typeof setCookie>[0],
) {
  const session = sessions.createSession(user.id);
  setSessionCookies(c, session);

  return {
    success: true as const,
    user,
    memberships: storage.listMemberships(user.id),
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  };
}

export function createAuthRoutes(options: AuthRoutesOptions = {}) {
  const app = new OpenAPIHono();
  let storage = options.storage;
  let eventStorage = options.eventStorage;
  let sessions: AuthSessionService | undefined;
  const oidcEnabled = options.oidcEnabled ?? config.auth.oidc.enabled;
  const oidcProvider = options.oidcProvider ?? new CasdoorOidcProvider(config.auth.oidc);

  function getStorage(): AuthStorage {
    storage ??= new AuthStorage(config.projectRoot);
    return storage;
  }

  function getEventStorage(): AuthEventStorage {
    eventStorage ??= new AuthEventStorage(config.projectRoot);
    return eventStorage;
  }

  function getSessions(): AuthSessionService {
    sessions ??= new AuthSessionService(getStorage(), {
      ttlSeconds: options.ttlSeconds ?? config.auth.sessionTtlSeconds,
    });
    return sessions;
  }

  const loginRoute = createRoute({
    method: "post",
    path: "/api/auth/login",
    tags: ["auth"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: LoginRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Authenticated local user",
        content: {
          "application/json": {
            schema: LoginResponseSchema,
          },
        },
      },
      401: {
        description: "Invalid credentials",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  });

  app.openapi(loginRoute, async (c) => {
    const { username, password } = c.req.valid("json");
    const workspaceSlug = c.var.workspaceSlug;
    const authStorage = getStorage();
    const identity = authStorage.findIdentity("local", username, "local");
    const credential = identity ? authStorage.findPasswordCredential(identity.userId) : null;
    const user = identity ? authStorage.findUser(identity.userId) : null;

    if (!credential || !user || !(await verifyPassword(password, credential))) {
      getEventStorage().append({
        type: "login_failure",
        provider: "local",
        workspaceSlug,
        reason: "invalid_credentials",
        metadata: { username },
      });
      return c.json({ success: false as const, error: "Invalid username or password" }, 401);
    }

    const result = await createSessionResponse(user, authStorage, getSessions(), c);
    getEventStorage().append({
      type: "login_success",
      userId: user.id,
      provider: "local",
      workspaceSlug,
      sessionId: result.csrfToken ? undefined : undefined,
      metadata: { username },
    });
    return c.json(result, 200);
  });

  const meRoute = createRoute({
    method: "get",
    path: "/api/auth/me",
    tags: ["auth"],
    responses: {
      200: {
        description: "Current authenticated user",
        content: {
          "application/json": {
            schema: MeResponseSchema,
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
    },
  });

  app.openapi(meRoute, (c) => {
    const auth = c.var.auth;
    if (!auth) {
      return c.json({ success: false as const, error: "Authentication required" }, 401);
    }

    return c.json({
      success: true as const,
      user: auth.user,
      memberships: auth.memberships,
      workspaceRole: getWorkspaceRole(auth, c.var.workspaceSlug),
    }, 200);
  });

  const logoutRoute = createRoute({
    method: "post",
    path: "/api/auth/logout",
    tags: ["auth"],
    responses: {
      200: {
        description: "Session revoked",
        content: {
          "application/json": {
            schema: SuccessResponseSchema,
          },
        },
      },
    },
  });

  app.openapi(logoutRoute, (c) => {
    const token = getCookie(c, config.auth.sessionCookieName);
    const auth = c.var.auth;
    if (token) {
      getSessions().revokeSession(token);
    }
    if (auth) {
      getEventStorage().append({
        type: "logout",
        userId: auth.user.id,
        workspaceSlug: c.var.workspaceSlug,
        sessionId: auth.sessionId,
      });
    }
    clearSessionCookies(c);
    return c.json({ success: true as const }, 200);
  });

  const changePasswordRoute = createRoute({
    method: "post",
    path: "/api/auth/change-password",
    tags: ["auth"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: ChangePasswordRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Password changed",
        content: {
          "application/json": {
            schema: SuccessResponseSchema,
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
        description: "Current password invalid",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  });

  app.openapi(changePasswordRoute, async (c) => {
    const auth = c.var.auth;
    if (!auth) {
      return c.json({ success: false as const, error: "Authentication required" }, 401);
    }

    const { currentPassword, newPassword } = c.req.valid("json");
    const authStorage = getStorage();
    const credential = authStorage.findPasswordCredential(auth.user.id);
    if (!credential || !(await verifyPassword(currentPassword, credential))) {
      return c.json({ success: false as const, error: "Current password is incorrect" }, 403);
    }

    authStorage.savePasswordCredential({
      userId: auth.user.id,
      ...(await hashPassword(newPassword)),
      mustChangePassword: false,
    });
    return c.json({ success: true as const }, 200);
  });

  const casdoorLoginRoute = createRoute({
    method: "get",
    path: "/api/auth/casdoor/login",
    tags: ["auth"],
    request: {
      query: RedirectQuerySchema,
    },
    responses: {
      302: {
        description: "Redirect to Casdoor authorization URL",
      },
      404: {
        description: "OIDC disabled",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  });

  app.openapi(casdoorLoginRoute, async (c) => {
    if (!oidcEnabled) {
      return c.json({ success: false as const, error: "Casdoor login is disabled" }, 404);
    }

    const { redirectTo } = c.req.valid("query");
    const result = await oidcProvider.buildLoginUrl(
      sanitizeRedirect(redirectTo),
      (state) => getStorage().saveOidcState(state),
    );
    return c.redirect(result.url.href, 302);
  });

  const casdoorCallbackRoute = createRoute({
    method: "get",
    path: "/api/auth/casdoor/callback",
    tags: ["auth"],
    responses: {
      302: {
        description: "Redirect after successful OIDC callback",
      },
      400: {
        description: "Invalid OIDC callback",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
      404: {
        description: "OIDC disabled",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  });

  app.openapi(casdoorCallbackRoute, async (c) => {
    if (!oidcEnabled) {
      return c.json({ success: false as const, error: "Casdoor login is disabled" }, 404);
    }

    const stateValue = c.req.query("state");
    if (!stateValue) {
      return c.json({ success: false as const, error: "OIDC state is required" }, 400);
    }

    const authStorage = getStorage();
    const storedState = authStorage.consumeOidcState(stateValue);
    if (!storedState) {
      return c.json({ success: false as const, error: "OIDC state is invalid or expired" }, 400);
    }

    const identity = await oidcProvider.handleCallback(new URL(c.req.url), storedState);
    const existing = authStorage.findIdentity(
      identity.provider,
      identity.providerSubject,
      identity.providerTenant,
    );
    const user = existing
      ? authStorage.findUser(existing.userId)
      : authStorage.createUser({ email: identity.email, displayName: identity.displayName });

    if (!user) {
      return c.json({ success: false as const, error: "OIDC user is disabled" }, 403);
    }

    authStorage.linkIdentity({
      userId: user.id,
      provider: identity.provider,
      providerSubject: identity.providerSubject,
      providerTenant: identity.providerTenant,
      email: identity.email,
      displayName: identity.displayName,
      rawProfile: identity.rawProfile,
    });
    authStorage.applyProviderMembershipPreapprovals({
      userId: user.id,
      provider: identity.provider,
      providerSubject: identity.providerSubject,
      providerTenant: identity.providerTenant,
    });

    const session = getSessions().createSession(user.id);
    setSessionCookies(c, session);
    return c.redirect(sanitizeRedirect(storedState.redirectTo), 302);
  });

  // GET /api/auth/options — login page configuration (no secrets)
  const optionsRoute = createRoute({
    method: "get",
    path: "/api/auth/options",
    tags: ["auth"],
    responses: {
      200: {
        description: "Auth options for login page",
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              localPasswordEnabled: z.literal(true),
              casdoorEnabled: z.boolean(),
            }),
          },
        },
      },
    },
  });

  app.openapi(optionsRoute, (c) => {
    return c.json({
      success: true as const,
      localPasswordEnabled: true as const,
      casdoorEnabled: oidcEnabled,
    }, 200);
  });

  // GET /api/auth/events — admin-only recent auth diagnostics
  const eventsRoute = createRoute({
    method: "get",
    path: "/api/auth/events",
    tags: ["auth"],
    request: {
      query: z.object({
        limit: z.string().optional(),
        type: z.string().optional(),
        userId: z.string().optional(),
        workspaceSlug: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: "Recent auth events",
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              events: z.array(z.object({
                id: z.string(),
                type: z.string(),
                userId: z.string().optional(),
                provider: z.string().optional(),
                workspaceSlug: z.string().optional(),
                sessionId: z.string().optional(),
                reason: z.string().optional(),
                metadata: z.record(z.string(), z.unknown()).optional(),
                ipHash: z.string().optional(),
                userAgent: z.string().optional(),
                createdAt: z.string(),
              })),
            }),
          },
        },
      },
      401: {
        description: "Authentication required",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
      403: {
        description: "Admin access required",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
    },
  });

  app.openapi(eventsRoute, (c) => {
    const auth = c.var.auth;
    if (!auth) {
      return c.json({ success: false as const, error: "Authentication required" }, 401);
    }

    const workspaceSlug = c.var.workspaceSlug;
    const workspaceRole = auth.memberships.find(
      (m) => m.workspaceSlug === workspaceSlug,
    )?.role;

    if (workspaceRole !== "admin") {
      return c.json({ success: false as const, error: "Admin access required" }, 403);
    }

    const query = c.req.valid("query");
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const filterWorkspace = query.workspaceSlug ?? workspaceSlug;

    const events = getEventStorage().listRecent({
      limit: Math.min(limit, 200),
      type: query.type as AuthEvent["type"] | undefined,
      userId: query.userId,
      workspaceSlug: filterWorkspace,
    });

    return c.json({ success: true as const, events }, 200);
  });

  return app;
}

export default createAuthRoutes();
