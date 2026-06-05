import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { AuthSessionService } from "../services/auth-session-service.js";
import { AuthStorage } from "../services/auth-storage.js";
import type { AuthContext, AuthUser, WorkspaceRole } from "../services/auth-types.js";
import { config } from "../services/config.js";
import { hashPassword, verifyPassword } from "../services/local-password-provider.js";
import { CasdoorOidcProvider } from "../services/oidc-provider.js";

type AuthRoutesOptions = {
  storage?: AuthStorage;
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
  const storage = options.storage ?? new AuthStorage(config.projectRoot);
  const sessions = new AuthSessionService(storage, {
    ttlSeconds: options.ttlSeconds ?? config.auth.sessionTtlSeconds,
  });
  const oidcEnabled = options.oidcEnabled ?? config.auth.oidc.enabled;
  const oidcProvider = options.oidcProvider ?? new CasdoorOidcProvider(config.auth.oidc);

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
    const identity = storage.findIdentity("local", username, "local");
    const credential = identity ? storage.findPasswordCredential(identity.userId) : null;
    const user = identity ? storage.findUser(identity.userId) : null;

    if (!credential || !user || !(await verifyPassword(password, credential))) {
      return c.json({ success: false as const, error: "Invalid username or password" }, 401);
    }

    return c.json(await createSessionResponse(user, storage, sessions, c), 200);
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
    if (token) {
      sessions.revokeSession(token);
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
    const credential = storage.findPasswordCredential(auth.user.id);
    if (!credential || !(await verifyPassword(currentPassword, credential))) {
      return c.json({ success: false as const, error: "Current password is incorrect" }, 403);
    }

    storage.savePasswordCredential({
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
      (state) => storage.saveOidcState(state),
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

    const storedState = storage.consumeOidcState(stateValue);
    if (!storedState) {
      return c.json({ success: false as const, error: "OIDC state is invalid or expired" }, 400);
    }

    const identity = await oidcProvider.handleCallback(new URL(c.req.url), storedState);
    const existing = storage.findIdentity(
      identity.provider,
      identity.providerSubject,
      identity.providerTenant,
    );
    const user = existing
      ? storage.findUser(existing.userId)
      : storage.createUser({ email: identity.email, displayName: identity.displayName });

    if (!user) {
      return c.json({ success: false as const, error: "OIDC user is disabled" }, 403);
    }

    storage.linkIdentity({
      userId: user.id,
      provider: identity.provider,
      providerSubject: identity.providerSubject,
      providerTenant: identity.providerTenant,
      email: identity.email,
      displayName: identity.displayName,
      rawProfile: identity.rawProfile,
    });

    const session = sessions.createSession(user.id);
    setSessionCookies(c, session);
    return c.redirect(sanitizeRedirect(storedState.redirectTo), 302);
  });

  return app;
}

export default createAuthRoutes();
