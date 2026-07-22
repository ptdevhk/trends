/**
 * Resolve the BFF base URL used by Convex ingest/reingest actions.
 *
 * Preview Convex runs in Docker; container-local loopback on the production
 * API port is never the host preview API. Production Convex runs on the host
 * and must call the host BFF explicitly — never leave this as an accidental
 * dev default.
 *
 * Hostnames/ports live in {@link BFF_API_URL_DEFAULTS} only — helpers and
 * diagnose messages must not invent alternate hard-coded hosts.
 */

export type BffApiUrlEnv = {
  BFF_API_URL?: string | null;
  /** Alias accepted for operator convenience */
  TRENDS_BFF_API_URL?: string | null;
  /**
   * Deployment role hint used only when no explicit URL is set.
   * - preview → public preview origin (Docker cannot use host loopback)
   * - production / unset → host loopback on PORT or production API port
   */
  TRENDS_DEPLOYMENT_ROLE?: string | null;
  /** Public preview host (no scheme), e.g. from PREVIEW_PUBLIC_HOST */
  PREVIEW_PUBLIC_HOST?: string | null;
  /** Public production host (no scheme) */
  PROD_PUBLIC_HOST?: string | null;
  PORT?: string | null;
};

/** Single source of truth for BFF host/port defaults (override via env). */
export const BFF_API_URL_DEFAULTS = {
  previewPublicHost: "preview.pt-mes.com",
  productionPublicHost: "trends.pt-mes.com",
  productionApiPort: "3000",
  previewApiPort: "3002",
  loopbackHost: "127.0.0.1",
} as const;

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function readHost(env: BffApiUrlEnv, key: "PREVIEW_PUBLIC_HOST" | "PROD_PUBLIC_HOST", fallback: string): string {
  const raw = typeof env[key] === "string" ? env[key]!.trim() : "";
  return raw || fallback;
}

/** Public HTTPS origin for preview BFF (Docker Convex → host via Caddy). */
export function previewPublicBffOrigin(env: BffApiUrlEnv = {}): string {
  const host = readHost(env, "PREVIEW_PUBLIC_HOST", BFF_API_URL_DEFAULTS.previewPublicHost);
  return `https://${host}`;
}

function resolvePort(env: BffApiUrlEnv, fallback: string): string {
  const portRaw = typeof env.PORT === "string" ? env.PORT.trim() : "";
  return portRaw && /^\d+$/.test(portRaw) ? portRaw : fallback;
}

function loopbackUrl(port: string): string {
  return `http://${BFF_API_URL_DEFAULTS.loopbackHost}:${port}`;
}

/** Host loopback URL for production BFF (systemd Convex → host API). */
export function productionLoopbackBffUrl(env: BffApiUrlEnv = {}): string {
  return loopbackUrl(resolvePort(env, BFF_API_URL_DEFAULTS.productionApiPort));
}

/** Host loopback URL for preview API when role is unset but PORT is preview. */
export function previewLoopbackBffUrl(env: BffApiUrlEnv = {}): string {
  return loopbackUrl(resolvePort(env, BFF_API_URL_DEFAULTS.previewApiPort));
}

/**
 * True when URL targets container-local loopback on the production API port
 * (or bare loopback without a port). That is wrong for preview Docker Convex.
 */
export function isContainerLocalBffUrl(url: string): boolean {
  const value = url.trim();
  if (!value) return false;
  const prodPort = BFF_API_URL_DEFAULTS.productionApiPort;
  const re = new RegExp(
    `^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:${prodPort})?\\/?$`,
    "i",
  );
  return re.test(value);
}

/**
 * Resolve BFF base URL (no path). Explicit env always wins.
 */
export function resolveBffApiUrl(env: BffApiUrlEnv = process.env): string {
  const explicit = (
    (typeof env.BFF_API_URL === "string" ? env.BFF_API_URL : "")
    || (typeof env.TRENDS_BFF_API_URL === "string" ? env.TRENDS_BFF_API_URL : "")
  ).trim();
  if (explicit) {
    return trimTrailingSlash(explicit);
  }

  const role = (typeof env.TRENDS_DEPLOYMENT_ROLE === "string"
    ? env.TRENDS_DEPLOYMENT_ROLE
    : ""
  ).trim().toLowerCase();
  if (role === "preview") {
    return previewPublicBffOrigin(env);
  }

  const port = resolvePort(env, BFF_API_URL_DEFAULTS.productionApiPort);
  if (port === BFF_API_URL_DEFAULTS.previewApiPort) {
    return previewLoopbackBffUrl({ ...env, PORT: port });
  }
  return productionLoopbackBffUrl({ ...env, PORT: port });
}

/** Default BFF URL for a deployment role (ignores BFF_API_URL). */
export function defaultBffApiUrlForRole(
  role: string,
  env: BffApiUrlEnv = {},
): string {
  const normalized = role.trim().toLowerCase();
  if (normalized === "preview") {
    return previewPublicBffOrigin(env);
  }
  return productionLoopbackBffUrl(env);
}

export type BffApiUrlSanityIssue = {
  code: "missing_preview_override" | "preview_points_at_container_localhost" | "empty";
  message: string;
};

/**
 * Detect BFF URL configurations that break Convex→BFF reingest after deploy.
 * Used by upgrade/doctor gates — does not throw.
 */
export function diagnoseBffApiUrl(
  env: BffApiUrlEnv = process.env,
  options?: { role?: string | null },
): BffApiUrlSanityIssue[] {
  const issues: BffApiUrlSanityIssue[] = [];
  const role = (
    options?.role
    ?? (typeof env.TRENDS_DEPLOYMENT_ROLE === "string" ? env.TRENDS_DEPLOYMENT_ROLE : "")
  ).trim().toLowerCase();
  const explicit = (
    (typeof env.BFF_API_URL === "string" ? env.BFF_API_URL : "")
    || (typeof env.TRENDS_BFF_API_URL === "string" ? env.TRENDS_BFF_API_URL : "")
  ).trim();
  const resolved = resolveBffApiUrl({
    ...env,
    ...(role ? { TRENDS_DEPLOYMENT_ROLE: role } : {}),
  });

  if (!resolved) {
    issues.push({ code: "empty", message: "BFF API URL resolved to empty string" });
    return issues;
  }

  const recommendedPreview = previewPublicBffOrigin(env);

  if (role === "preview" && explicit && isContainerLocalBffUrl(explicit)) {
    issues.push({
      code: "preview_points_at_container_localhost",
      message:
        `Preview BFF_API_URL="${explicit}" points at container-local loopback; `
        + `use ${recommendedPreview} (or host-reachable URL) so Docker Convex can call the host BFF`,
    });
  }

  // Host preview API uses preview port; BFF still on production port is wrong.
  if (
    explicit
    && isContainerLocalBffUrl(explicit)
    && env.PORT === BFF_API_URL_DEFAULTS.previewApiPort
  ) {
    if (!issues.some((i) => i.code === "preview_points_at_container_localhost")) {
      issues.push({
        code: "preview_points_at_container_localhost",
        message:
          `PORT=${BFF_API_URL_DEFAULTS.previewApiPort} but BFF_API_URL="${explicit}" targets `
          + `:${BFF_API_URL_DEFAULTS.productionApiPort}; preview host API is `
          + `:${BFF_API_URL_DEFAULTS.previewApiPort} / public host`,
      });
    }
  }

  return issues;
}
