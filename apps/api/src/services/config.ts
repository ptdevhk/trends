/**
 * API Configuration
 *
 * Environment variables:
 * - PORT: HTTP server port (default: 3000)
 * - WORKER_URL: FastAPI worker URL (default: http://localhost:8000)
 * - INDUSTRY_MAINTENANCE_WORKER_TIMEOUT_MS: bounded API wait for one
 *   industry-maintenance worker batch (default: 300000)
 * - PROJECT_ROOT: TrendRadar project root (auto-detected if unset)
 * - TIMEZONE: Global timezone override (default from config/config.yaml or Asia/Hong_Kong)
 */

import path from "node:path";

import { findProjectRoot } from "./db.js";
import { ensureProcessTimezone, resolveTimezone } from "./timezone.js";

function loadConvexWriteSecret(): string {
  const direct = process.env.CONVEX_WRITE_SECRET;
  if (direct) return direct;
  // Some local dev setups (e.g. older `scripts/dev.sh` runs) export the
  // secret under a legacy alias; prefer the canonical name but fall back so
  // the reviewer cockpit never reads Convex with an empty secret. Read at
  // call time (not module load) so tests and env reloads can change it.
  const alias = process.env.CONVEX_ADMIN_SECRET;
  return alias ?? "";
}

export function getConvexWriteSecret(): string {
  return loadConvexWriteSecret();
}

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
  industryMaintenanceWorkerTimeoutMs: Math.min(
    300_000,
    Math.max(
      30_000,
      Number.parseInt(
        process.env.INDUSTRY_MAINTENANCE_WORKER_TIMEOUT_MS || "300000",
        10,
      ) || 300_000,
    ),
  ),
  industryEvidenceTargetedQueueEnabled:
    process.env.INDUSTRY_EVIDENCE_TARGETED_QUEUE_ENABLED === "true",
  industryEvidenceResearchMaxBatch: Math.min(
    50,
    Math.max(
      1,
      Number.parseInt(
        process.env.INDUSTRY_EVIDENCE_RESEARCH_MAX_BATCH || "20",
        10,
      ) || 20,
    ),
  ),
  projectRoot,
  timezone,
  version: "0.4.23",
  auth: {
    sessionCookieName: process.env.AUTH_SESSION_COOKIE_NAME || "trends_session",
    csrfCookieName: process.env.AUTH_CSRF_COOKIE_NAME || "trends_csrf",
    sessionTtlSeconds: parseInt(process.env.AUTH_SESSION_TTL_SECONDS || "604800", 10),
    secureCookies: isProduction,
    adminResetEnabled: process.env.AUTH_ADMIN_RESET_ENABLED !== "false",
    allowedOrigins: (process.env.AUTH_ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    convexWriteSecret: loadConvexWriteSecret(),
    /**
     * Shared HR demo silent-login secret (migration bookmarks).
     * Maps to the canonical preview/prod HR seat (`hr-demo` by default).
     * Prefer AUTH_HR_DEMO_TOKEN_HASH (sha256 base64url via hashSecret) when the
     * plaintext must not sit in env; otherwise AUTH_HR_DEMO_TOKEN.
     * AUTH_HR_DESK_* names remain accepted as temporary aliases.
     */
    hrDemo: {
      username: (
        process.env.AUTH_HR_DEMO_USERNAME
        || process.env.BOOTSTRAP_HR_DEMO_USER
        || process.env.AUTH_HR_DESK_USERNAME
        || "hr-demo"
      ).trim() || "hr-demo",
      token: process.env.AUTH_HR_DEMO_TOKEN || process.env.AUTH_HR_DESK_TOKEN || "",
      tokenHash: process.env.AUTH_HR_DEMO_TOKEN_HASH || process.env.AUTH_HR_DESK_TOKEN_HASH || "",
    },
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
