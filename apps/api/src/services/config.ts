/**
 * API Configuration
 *
 * Environment variables:
 * - PORT: HTTP server port (default: 3000)
 * - WORKER_URL: FastAPI worker URL (default: http://localhost:8000)
 * - PROJECT_ROOT: TrendRadar project root (auto-detected if unset)
 * - TIMEZONE: Global timezone override (default from config/config.yaml or Asia/Hong_Kong)
 */

import path from "node:path";

import { findProjectRoot } from "./db.js";
import { ensureProcessTimezone, resolveTimezone } from "./timezone.js";

const projectRoot = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : findProjectRoot();

const timezone = resolveTimezone({
  envTimezone: process.env.TIMEZONE,
  projectRoot,
});
ensureProcessTimezone(timezone);

const isProduction = process.env.NODE_ENV === "production";

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  workerUrl: process.env.WORKER_URL || "http://localhost:8000",
  projectRoot,
  timezone,
  version: "0.4.6",
  auth: {
    sessionCookieName: process.env.AUTH_SESSION_COOKIE_NAME || "trends_session",
    csrfCookieName: process.env.AUTH_CSRF_COOKIE_NAME || "trends_csrf",
    sessionTtlSeconds: parseInt(process.env.AUTH_SESSION_TTL_SECONDS || "604800", 10),
    secureCookies: isProduction,
    adminResetEnabled: process.env.AUTH_ADMIN_RESET_ENABLED === "true",
    allowedOrigins: (process.env.AUTH_ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    convexWriteSecret: process.env.CONVEX_WRITE_SECRET || "",
    oidc: {
      enabled: process.env.AUTH_OIDC_ENABLED === "true",
      provider: "casdoor" as const,
      issuer: process.env.AUTH_OIDC_ISSUER || "",
      clientId: process.env.AUTH_OIDC_CLIENT_ID || "",
      clientSecret: process.env.AUTH_OIDC_CLIENT_SECRET || "",
      redirectUri: process.env.AUTH_OIDC_REDIRECT_URI || "",
      scope: process.env.AUTH_OIDC_SCOPE || "openid profile email",
    },
  },
};
