import { timingSafeEqual } from "node:crypto";

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { getAdminAccessError } from "../middleware/auth.js";
import {
  checkLoginAttempt,
  extractClientIp,
  recordLoginFailure,
  resetOnSuccess,
} from "../middleware/login-rate-limit.js";
import { AuthEventStorage } from "../services/auth-event-storage.js";
import { AUTH_EVENT_TYPES } from "../services/auth-event-types.js";
import { AuthSessionService, hashSecret } from "../services/auth-session-service.js";
import { AuthStorage } from "../services/auth-storage.js";
import {
  hasWorkspaceRole,
  type AuthContext,
  type AuthProvider,
  type AuthUser,
  type WorkspaceMembership,
  type WorkspaceRole,
} from "../services/auth-types.js";
import { config } from "../services/config.js";
import { hashPassword, verifyPassword } from "../services/local-password-provider.js";
import { CasdoorOidcProvider } from "../services/oidc-provider.js";

/**
 * Derive the current session's token hash from the request cookie, for use as
 * the `exceptTokenHash` argument to `revokeAllSessionsByUser`. Returns
 * `undefined` when no session cookie is present.
 */
function currentSessionTokenHash(c: Context): string | undefined {
  const token = getCookie(c, config.auth.sessionCookieName);
  return token ? hashSecret(token) : undefined;
}

type HrDemoSilentLoginConfig = {
  username?: string;
  /** Plaintext desk token (compared via hashSecret). */
  token?: string;
  /** Precomputed hashSecret(token) when plaintext is not available. */
  tokenHash?: string;
};

type AuthRoutesOptions = {
  storage?: AuthStorage;
  eventStorage?: AuthEventStorage;
  ttlSeconds?: number;
  oidcEnabled?: boolean;
  oidcProvider?: CasdoorOidcProvider;
  /** Test/bootstrap override for shared HR demo silent login. Defaults to config.auth.hrDemo. */
  hrDemoSilentLogin?: HrDemoSilentLoginConfig;
};

function safeEqualUtf8(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/**
 * Normalize env/test overrides to a single expected hash once at route setup.
 * Prefer precomputed tokenHash; otherwise hash the plaintext token.
 * Plaintext is kept only for admin reveal (hash-only deploys cannot re-show the secret).
 */
function resolveHrDemoSilentLoginConfig(
  override?: HrDemoSilentLoginConfig,
): { username: string; expectedTokenHash: string; plaintextToken: string } {
  const username = (override?.username ?? config.auth.hrDemo.username).trim() || "hr-demo";
  const plaintextToken = (override?.token ?? config.auth.hrDemo.token).trim();
  const configuredHash = (override?.tokenHash ?? config.auth.hrDemo.tokenHash).trim();
  if (configuredHash) {
    return { username, expectedTokenHash: configuredHash, plaintextToken };
  }
  return {
    username,
    expectedTokenHash: plaintextToken ? hashSecret(plaintextToken) : "",
    plaintextToken,
  };
}

function matchesHrDemoToken(presented: string, expectedTokenHash: string): boolean {
  if (!presented || !expectedTokenHash) {
    return false;
  }
  return safeEqualUtf8(hashSecret(presented), expectedTokenHash);
}

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

const AuthProviderSchema = z.enum(["local", "casdoor"]);
const WorkspaceRoleSchema = z.enum(["user", "admin"]);

const ProviderIdentitySchema = z.object({
  provider: AuthProviderSchema,
  providerSubject: z.string(),
  providerTenant: z.string().nullable(),
  userId: z.string(),
  email: z.string().optional(),
  displayName: z.string().optional(),
  updatedAt: z.string(),
});

const ProviderMembershipPreapprovalSchema = z.object({
  provider: AuthProviderSchema,
  providerSubject: z.string(),
  providerTenant: z.string(),
  workspaceSlug: z.string(),
  role: WorkspaceRoleSchema,
  operatorId: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  revokedAt: z.string().optional(),
  revokedBy: z.string().optional(),
});

const ProviderMembershipGrantSchema = z.object({
  provider: AuthProviderSchema,
  providerSubject: z.string(),
  providerTenant: z.string(),
  workspaceSlug: z.string(),
  role: WorkspaceRoleSchema,
  userId: z.string(),
  preapprovalId: z.string(),
  active: z.boolean(),
  grantedAt: z.string(),
  revokedAt: z.string().optional(),
});

const AuthEventSchema = z.object({
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
});

const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const SilentLoginRequestSchema = z.object({
  token: z.string().min(1),
});

const LoginResponseSchema = z.object({
  success: z.literal(true),
  user: AuthUserSchema,
  memberships: z.array(MembershipSchema),
  csrfToken: z.string(),
  expiresAt: z.string(),
});

const MeResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    user: AuthUserSchema,
    memberships: z.array(MembershipSchema),
    workspaceRole: z.enum(["user", "admin"]).nullable(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const SuccessResponseSchema = z.object({
  success: z.literal(true),
});

const ProviderMembershipListQuerySchema = z.object({
  provider: AuthProviderSchema.optional(),
  workspaceSlug: z.string().optional(),
});

const ProviderMembershipPreapproveRequestSchema = z.object({
  provider: AuthProviderSchema,
  providerSubject: z.string().min(1),
  providerTenant: z.string().min(1),
  workspaceSlug: z.string().min(1),
  role: WorkspaceRoleSchema,
});

const ProviderMembershipRevokeRequestSchema = z.object({
  provider: AuthProviderSchema,
  providerSubject: z.string().min(1),
  providerTenant: z.string().min(1),
  workspaceSlug: z.string().min(1),
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

function findProviderPreapproval(
  storage: AuthStorage,
  input: {
    provider: AuthProvider;
    providerSubject: string;
    providerTenant: string;
    workspaceSlug: string;
  },
) {
  return storage.listProviderMembershipPreapprovals({
    provider: input.provider,
    workspaceSlug: input.workspaceSlug,
    includeRevoked: true,
  }).find((preapproval) => (
    preapproval.providerSubject === input.providerSubject
    && preapproval.providerTenant === input.providerTenant
  )) ?? null;
}

function listAppliedWorkspaceMemberships(
  storage: AuthStorage,
  input: {
    provider: AuthProvider;
    providerSubject: string;
    providerTenant: string;
    workspaceSlug: string;
  },
): WorkspaceMembership[] {
  const identity = storage.findIdentity(input.provider, input.providerSubject, input.providerTenant);
  if (!identity) {
    return [];
  }
  return storage.listMemberships(identity.userId).filter(
    (membership) => membership.workspaceSlug === input.workspaceSlug,
  );
}

function appendProviderMembershipAdminEvent(
  eventStorage: AuthEventStorage,
  input: {
    action: "preapprove" | "revoke";
    operatorId: string;
    provider: AuthProvider;
    providerSubject: string;
    providerTenant: string;
    workspaceSlug: string;
    role?: WorkspaceRole;
  },
): void {
  const type = input.action === "preapprove"
    ? "provider_membership_preapproved"
    : "provider_membership_revoked";

  eventStorage.append({
    type,
    userId: input.operatorId,
    provider: input.provider,
    workspaceSlug: input.workspaceSlug,
    metadata: {
      action: input.action,
      operatorId: input.operatorId,
      providerSubject: input.providerSubject,
      providerTenant: input.providerTenant,
      ...(input.role ? { role: input.role } : {}),
    },
  });
}

function appendOidcStateInvalidEvent(
  eventStorage: AuthEventStorage,
  input: {
    workspaceSlug: string;
    reason: "missing_state" | "invalid_state";
    statePresent: boolean;
  },
): void {
  eventStorage.append({
    type: "oidc_state_invalid",
    provider: "casdoor",
    workspaceSlug: input.workspaceSlug,
    reason: input.reason,
    metadata: {
      statePresent: input.statePresent,
    },
  });
}

function appendOidcLoginFailureEvent(
  eventStorage: AuthEventStorage,
  input: {
    workspaceSlug: string;
    reason: "oidc_user_disabled";
    userId?: string;
    providerSubject: string;
    providerTenant: string;
  },
): void {
  eventStorage.append({
    type: "login_failure",
    provider: "casdoor",
    workspaceSlug: input.workspaceSlug,
    userId: input.userId,
    reason: input.reason,
    metadata: {
      providerSubject: input.providerSubject,
      providerTenant: input.providerTenant,
    },
  });
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
    body: {
      success: true as const,
      user,
      memberships: storage.listMemberships(user.id),
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    },
    sessionId: session.id,
  };
}

export function createAuthRoutes(options: AuthRoutesOptions = {}) {
  const app = new OpenAPIHono();
  let storage = options.storage;
  let eventStorage = options.eventStorage;
  let sessions: AuthSessionService | undefined;
  const oidcEnabled = options.oidcEnabled ?? config.auth.oidc.enabled;
  const oidcProvider = options.oidcProvider ?? new CasdoorOidcProvider(config.auth.oidc);
  const hrDemoSilentLogin = resolveHrDemoSilentLoginConfig(options.hrDemoSilentLogin);

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
      429: {
        description: "Account temporarily locked due to repeated failures",
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
    const clientIp = extractClientIp(c.req);

    // Account-scoped login rate limit (username+IP). Runs in all environments,
    // not just production, so local dev catches regressions.
    const attempt = checkLoginAttempt(username, clientIp);
    if (!attempt.allowed) {
      getEventStorage().append({
        type: "login_throttled",
        provider: "local",
        workspaceSlug,
        reason: "account_lockout",
        metadata: {
          username,
          retryAfterSeconds: attempt.retryAfterSeconds,
        },
      });
      c.header("Retry-After", String(attempt.retryAfterSeconds));
      return c.json(
        {
          success: false as const,
          error: `Account temporarily locked. Try again in ${attempt.retryAfterSeconds}s.`,
        },
        429,
      );
    }

    const authStorage = getStorage();
    const identity = authStorage.findIdentity("local", username, "local");
    const credential = identity ? authStorage.findPasswordCredential(identity.userId) : null;
    const user = identity ? authStorage.findUser(identity.userId) : null;

    if (!credential || !user || !(await verifyPassword(password, credential))) {
      recordLoginFailure(username, clientIp);
      getEventStorage().append({
        type: "login_failure",
        provider: "local",
        workspaceSlug,
        reason: "invalid_credentials",
        metadata: { username },
      });
      return c.json({ success: false as const, error: "Invalid username or password" }, 401);
    }

    resetOnSuccess(username, clientIp);
    const result = await createSessionResponse(user, authStorage, getSessions(), c);
    getEventStorage().append({
      type: "login_success",
      userId: user.id,
      provider: "local",
      workspaceSlug,
      sessionId: result.sessionId,
      metadata: { username },
    });
    return c.json(result.body, 200);
  });

  const silentLoginRoute = createRoute({
    method: "post",
    path: "/api/auth/silent-login",
    tags: ["auth"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: SilentLoginRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Authenticated shared HR desk user via static token",
        content: {
          "application/json": {
            schema: LoginResponseSchema,
          },
        },
      },
      401: {
        description: "Silent login failed (not_configured | invalid_token | disabled)",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
      429: {
        description: "Account temporarily locked due to repeated failures",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  });

  app.openapi(silentLoginRoute, async (c) => {
    const { token } = c.req.valid("json");
    const workspaceSlug = c.var.workspaceSlug;
    const clientIp = extractClientIp(c.req);
    const deskUsername = hrDemoSilentLogin.username;
    const expectedTokenHash = hrDemoSilentLogin.expectedTokenHash;

    const attempt = checkLoginAttempt(deskUsername, clientIp);
    if (!attempt.allowed) {
      getEventStorage().append({
        type: "login_throttled",
        provider: "local",
        workspaceSlug,
        reason: "account_lockout",
        metadata: {
          username: deskUsername,
          method: "desk_token",
          retryAfterSeconds: attempt.retryAfterSeconds,
        },
      });
      c.header("Retry-After", String(attempt.retryAfterSeconds));
      return c.json(
        {
          success: false as const,
          error: `Account temporarily locked. Try again in ${attempt.retryAfterSeconds}s.`,
        },
        429,
      );
    }

    if (!expectedTokenHash) {
      getEventStorage().append({
        type: "login_failure",
        provider: "local",
        workspaceSlug,
        reason: "not_configured",
        metadata: { method: "desk_token", username: deskUsername },
      });
      return c.json({ success: false as const, error: "not_configured" }, 401);
    }

    if (!matchesHrDemoToken(token, expectedTokenHash)) {
      recordLoginFailure(deskUsername, clientIp);
      getEventStorage().append({
        type: "login_failure",
        provider: "local",
        workspaceSlug,
        reason: "invalid_token",
        metadata: { method: "desk_token", username: deskUsername },
      });
      return c.json({ success: false as const, error: "invalid_token" }, 401);
    }

    const authStorage = getStorage();
    const identity = authStorage.findIdentity("local", deskUsername, "local");
    const user = identity ? authStorage.findUser(identity.userId) : null;
    const memberships = user ? authStorage.listMemberships(user.id) : [];
    const hasHrSeat = user
      ? hasWorkspaceRole(memberships, "hr", ["user", "admin"])
      : false;

    if (!user || !hasHrSeat) {
      recordLoginFailure(deskUsername, clientIp);
      getEventStorage().append({
        type: "login_failure",
        provider: "local",
        workspaceSlug,
        userId: identity?.userId,
        reason: "disabled",
        metadata: { method: "desk_token", username: deskUsername },
      });
      return c.json({ success: false as const, error: "disabled" }, 401);
    }

    resetOnSuccess(deskUsername, clientIp);
    const result = await createSessionResponse(user, authStorage, getSessions(), c);
    getEventStorage().append({
      type: "login_success",
      userId: user.id,
      provider: "local",
      workspaceSlug,
      sessionId: result.sessionId,
      metadata: { method: "desk_token", username: deskUsername },
    });
    return c.json(result.body, 200);
  });

  const meRoute = createRoute({
    method: "get",
    path: "/api/auth/me",
    tags: ["auth"],
    responses: {
      200: {
        description: "Current auth state (authenticated or not)",
        content: {
          "application/json": {
            schema: MeResponseSchema,
          },
        },
      },
    },
  });

  app.openapi(meRoute, (c) => {
    const auth = c.var.auth;
    if (!auth) {
      return c.json({ success: false as const, error: "Not authenticated" }, 200);
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
      429: {
        description: "Too many failed change-password attempts",
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

    const clientIp = extractClientIp(c.req);
    const attempt = checkLoginAttempt(auth.user.id, clientIp);
    if (!attempt.allowed) {
      getEventStorage().append({
        type: "password_change_throttled",
        userId: auth.user.id,
        workspaceSlug: c.var.workspaceSlug,
        reason: "account_lockout",
        metadata: {
          retryAfterSeconds: attempt.retryAfterSeconds,
        },
      });
      c.header("Retry-After", String(attempt.retryAfterSeconds));
      return c.json(
        {
          success: false as const,
          error: `Too many failed attempts. Try again in ${attempt.retryAfterSeconds}s.`,
        },
        429,
      );
    }

    const { currentPassword, newPassword } = c.req.valid("json");
    const authStorage = getStorage();
    const credential = authStorage.findPasswordCredential(auth.user.id);
    if (!credential || !(await verifyPassword(currentPassword, credential))) {
      recordLoginFailure(auth.user.id, clientIp);
      return c.json({ success: false as const, error: "Current password is incorrect" }, 403);
    }

    resetOnSuccess(auth.user.id, clientIp);
    authStorage.savePasswordCredential({
      userId: auth.user.id,
      ...(await hashPassword(newPassword)),
      mustChangePassword: false,
    });

    // Revoke all other sessions for this user — a compromised password, once
    // changed, must kick the attacker out. Preserve the caller's current
    // session so the legitimate user isn't forced to re-login immediately.
    const exceptTokenHash = currentSessionTokenHash(c);
    authStorage.revokeAllSessionsByUser(auth.user.id, exceptTokenHash);
    getEventStorage().append({
      type: "sessions_revoked",
      userId: auth.user.id,
      workspaceSlug: c.var.workspaceSlug,
      reason: "password_change",
      sessionId: auth.sessionId,
    });

    return c.json({ success: true as const }, 200);
  });

  const revokeAllSessionsRoute = createRoute({
    method: "post",
    path: "/api/auth/sessions/revoke-all",
    tags: ["auth"],
    responses: {
      200: {
        description: "All other sessions revoked",
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
    },
  });

  app.openapi(revokeAllSessionsRoute, (c) => {
    const auth = c.var.auth;
    if (!auth) {
      return c.json({ success: false as const, error: "Authentication required" }, 401);
    }

    const exceptTokenHash = currentSessionTokenHash(c);
    const authStorage = getStorage();
    authStorage.revokeAllSessionsByUser(auth.user.id, exceptTokenHash);
    getEventStorage().append({
      type: "sessions_revoked",
      userId: auth.user.id,
      workspaceSlug: c.var.workspaceSlug,
      reason: "revoke_all",
      sessionId: auth.sessionId,
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
      appendOidcStateInvalidEvent(getEventStorage(), {
        workspaceSlug: c.var.workspaceSlug,
        reason: "missing_state",
        statePresent: false,
      });
      return c.json({ success: false as const, error: "OIDC state is required" }, 400);
    }

    const authStorage = getStorage();
    const storedState = authStorage.consumeOidcState(stateValue);
    if (!storedState) {
      appendOidcStateInvalidEvent(getEventStorage(), {
        workspaceSlug: c.var.workspaceSlug,
        reason: "invalid_state",
        statePresent: true,
      });
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
      appendOidcLoginFailureEvent(getEventStorage(), {
        workspaceSlug: c.var.workspaceSlug,
        reason: "oidc_user_disabled",
        userId: existing?.userId,
        providerSubject: identity.providerSubject,
        providerTenant: identity.providerTenant,
      });
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

  // GET /api/auth/hr-demo-silent — system-admin reveal of shared HR desk token (env-backed)
  const hrDemoSilentRoute = createRoute({
    method: "get",
    path: "/api/auth/hr-demo-silent",
    tags: ["auth"],
    responses: {
      200: {
        description: "HR demo silent-login configuration for admin operators",
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              configured: z.boolean(),
              revealable: z.boolean(),
              username: z.string(),
              token: z.string().nullable(),
              tokenFingerprint: z.string().nullable(),
              samplePath: z.string().nullable(),
              paramName: z.literal("auth"),
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

  app.openapi(hrDemoSilentRoute, (c) => {
    const adminError = getAdminAccessError(c);
    if (adminError) {
      return c.json(adminError.body, adminError.status);
    }

    const desk = hrDemoSilentLogin;
    const configured = Boolean(desk.expectedTokenHash);
    const revealable = Boolean(desk.plaintextToken);
    const token = revealable ? desk.plaintextToken : null;
    const tokenFingerprint = desk.expectedTokenHash
      ? `${desk.expectedTokenHash.slice(0, 6)}…${desk.expectedTokenHash.slice(-4)}`
      : null;
    const samplePath = token
      ? `/hr/resumes?auth=${encodeURIComponent(token)}`
      : null;

    return c.json({
      success: true as const,
      configured,
      revealable,
      username: desk.username,
      token,
      tokenFingerprint,
      samplePath,
      paramName: "auth" as const,
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
        type: z.enum(AUTH_EVENT_TYPES).optional(),
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
              events: z.array(AuthEventSchema),
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
    const workspaceRole = auth.memberships.find((m) => m.workspaceSlug === workspaceSlug)?.role;
    if (workspaceRole !== "admin") {
      return c.json({ success: false as const, error: "Admin access required" }, 403);
    }
    const query = c.req.valid("query");
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const filterWorkspace = query.workspaceSlug ?? workspaceSlug;
    const events = getEventStorage().listRecent({
      limit: Math.min(limit, 200),
      type: query.type,
      userId: query.userId,
      workspaceSlug: filterWorkspace,
    });
    return c.json({ success: true as const, events }, 200);
  });

  const providerMembershipListRoute = createRoute({
    method: "get",
    path: "/api/auth/provider-memberships",
    tags: ["auth"],
    request: {
      query: ProviderMembershipListQuerySchema,
    },
    responses: {
      200: {
        description: "Provider membership admin state",
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              identities: z.array(ProviderIdentitySchema),
              preapprovals: z.array(ProviderMembershipPreapprovalSchema),
              grants: z.array(ProviderMembershipGrantSchema),
              events: z.array(AuthEventSchema),
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

  app.openapi(providerMembershipListRoute, (c) => {
    const adminError = getAdminAccessError(c);
    if (adminError) {
      return c.json(adminError.body, adminError.status);
    }

    const query = c.req.valid("query");
    const workspaceSlug = query.workspaceSlug ?? c.var.workspaceSlug;
    if (workspaceSlug !== c.var.workspaceSlug) {
      return c.json({ success: false as const, error: "Admin access required" }, 403);
    }
    const authStorage = getStorage();
    return c.json({
      success: true as const,
      identities: authStorage.listProviderIdentities({ provider: query.provider }),
      preapprovals: authStorage.listProviderMembershipPreapprovals({
        provider: query.provider,
        workspaceSlug,
        includeRevoked: true,
      }),
      grants: authStorage.listProviderMembershipGrants({
        provider: query.provider,
        workspaceSlug,
        includeRevoked: true,
      }),
      events: getEventStorage().listRecent({
        limit: 50,
        workspaceSlug,
      }),
    }, 200);
  });

  const providerMembershipPreapproveRoute = createRoute({
    method: "post",
    path: "/api/auth/provider-memberships/preapprove",
    tags: ["auth"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: ProviderMembershipPreapproveRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Provider membership preapproved",
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              preapproval: ProviderMembershipPreapprovalSchema,
              appliedMemberships: z.array(MembershipSchema),
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
      404: {
        description: "Provider membership preapproval not found",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
    },
  });

  app.openapi(providerMembershipPreapproveRoute, (c) => {
    const adminError = getAdminAccessError(c);
    if (adminError) {
      return c.json(adminError.body, adminError.status);
    }

    const auth = c.var.auth;
    if (!auth) {
      return c.json({ success: false as const, error: "Authentication required" }, 401);
    }
    const input = c.req.valid("json");
    if (input.workspaceSlug !== c.var.workspaceSlug) {
      return c.json({ success: false as const, error: "Admin access required" }, 403);
    }
    const authStorage = getStorage();
    authStorage.preapproveProviderMembership({
      ...input,
      operatorId: auth.user.id,
    });
    const preapproval = findProviderPreapproval(authStorage, input);
    if (!preapproval) {
      return c.json({ success: false as const, error: "Provider membership preapproval not found" }, 404);
    }
    appendProviderMembershipAdminEvent(getEventStorage(), {
      action: "preapprove",
      operatorId: auth.user.id,
      provider: input.provider,
      providerSubject: input.providerSubject,
      providerTenant: input.providerTenant,
      workspaceSlug: input.workspaceSlug,
      role: input.role,
    });
    return c.json({
      success: true as const,
      preapproval,
      appliedMemberships: listAppliedWorkspaceMemberships(authStorage, input),
    }, 200);
  });

  const providerMembershipRevokeRoute = createRoute({
    method: "post",
    path: "/api/auth/provider-memberships/revoke",
    tags: ["auth"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: ProviderMembershipRevokeRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Provider membership preapproval revoked",
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              revoked: ProviderMembershipPreapprovalSchema,
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
      404: {
        description: "Provider membership preapproval not found",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
    },
  });

  app.openapi(providerMembershipRevokeRoute, (c) => {
    const adminError = getAdminAccessError(c);
    if (adminError) {
      return c.json(adminError.body, adminError.status);
    }

    const auth = c.var.auth;
    if (!auth) {
      return c.json({ success: false as const, error: "Authentication required" }, 401);
    }
    const input = c.req.valid("json");
    if (input.workspaceSlug !== c.var.workspaceSlug) {
      return c.json({ success: false as const, error: "Admin access required" }, 403);
    }
    const authStorage = getStorage();
    authStorage.revokeProviderMembershipPreapproval({
      ...input,
      operatorId: auth.user.id,
    });
    const revoked = findProviderPreapproval(authStorage, input);
    if (!revoked) {
      return c.json({ success: false as const, error: "Provider membership preapproval not found" }, 404);
    }
    appendProviderMembershipAdminEvent(getEventStorage(), {
      action: "revoke",
      operatorId: auth.user.id,
      provider: input.provider,
      providerSubject: input.providerSubject,
      providerTenant: input.providerTenant,
      workspaceSlug: input.workspaceSlug,
      role: revoked.role,
    });
    return c.json({
      success: true as const,
      revoked,
    }, 200);
  });

  return app;
}

export default createAuthRoutes();
