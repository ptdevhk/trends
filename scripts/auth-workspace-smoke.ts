import { pathToFileURL } from "node:url";

const DEFAULT_API_URL = "http://localhost:3000";
const DEFAULT_WEB_URL = "http://localhost:5173";
const DEFAULT_WORKSPACE = "hr";
const MEMBER_ROUTE = "/api/resumes?limit=1";
const ADMIN_ROUTE = "/api/auth/events?limit=1";

type EnvInput = Partial<Record<string, string | undefined>>;

export type SmokeConfig = {
  apiUrl: string;
  webUrl: string;
  workspaceSlug: string;
  wrongWorkspaceSlug: string;
  loginUsername: string;
  password: string;
  memberRoute: string;
  adminRoute: string;
};

export type AuthHeaderInput = {
  cookieJar: string;
  csrfToken: string;
  workspaceSlug: string;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type HeadersWithSetCookie = Headers & {
  getSetCookie?: () => string[];
  raw?: () => Record<string, string[]>;
};

type SmokeStepResult = {
  name: string;
  status: number;
};

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolveWrongWorkspace(workspaceSlug: string, env: EnvInput): string {
  if (env.AUTH_SMOKE_WRONG_WORKSPACE) {
    return env.AUTH_SMOKE_WRONG_WORKSPACE;
  }
  return workspaceSlug === "dev" ? "hr" : "dev";
}

export function readSmokeConfig(env: EnvInput = process.env): SmokeConfig {
  const loginUsername = env.AUTH_SMOKE_USERNAME ?? env.AUTH_SMOKE_EMAIL;
  const missing: string[] = [];
  if (!loginUsername) {
    missing.push("AUTH_SMOKE_EMAIL or AUTH_SMOKE_USERNAME");
  }
  if (!env.AUTH_SMOKE_PASSWORD) {
    missing.push("AUTH_SMOKE_PASSWORD");
  }
  if (missing.length > 0) {
    throw new Error(`Missing required auth smoke environment variables: ${missing.join(", ")}`);
  }

  const workspaceSlug = env.WORKSPACE ?? DEFAULT_WORKSPACE;
  return {
    apiUrl: stripTrailingSlash(env.API_URL ?? DEFAULT_API_URL),
    webUrl: stripTrailingSlash(env.WEB_URL ?? DEFAULT_WEB_URL),
    workspaceSlug,
    wrongWorkspaceSlug: resolveWrongWorkspace(workspaceSlug, env),
    loginUsername: requireEnv(loginUsername, "AUTH_SMOKE_EMAIL"),
    password: requireEnv(env.AUTH_SMOKE_PASSWORD, "AUTH_SMOKE_PASSWORD"),
    memberRoute: env.AUTH_SMOKE_MEMBER_ROUTE ?? MEMBER_ROUTE,
    adminRoute: env.AUTH_SMOKE_ADMIN_ROUTE ?? ADMIN_ROUTE,
  };
}

function splitCombinedSetCookieHeader(header: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < header.length; index += 1) {
    if (header[index] !== ",") {
      continue;
    }
    const remainder = header.slice(index + 1);
    if (/^\s*[^=;,\s]+=/u.test(remainder)) {
      parts.push(header.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(header.slice(start).trim());
  return parts.filter((part) => part.length > 0);
}

export function parseSetCookieHeaders(input: readonly string[] | string | null | undefined): string {
  const headers = Array.isArray(input)
    ? input
    : input
      ? splitCombinedSetCookieHeader(input)
      : [];
  const cookies = headers
    .map((header) => header.split(";")[0]?.trim() ?? "")
    .filter((cookie) => /^[^=]+=[\s\S]*$/u.test(cookie));

  if (cookies.length === 0) {
    throw new Error("Login response did not include session cookies");
  }

  return cookies.join("; ");
}

export function extractSetCookieHeaders(headers: Headers): string[] {
  const withSetCookie = headers as HeadersWithSetCookie;
  if (typeof withSetCookie.getSetCookie === "function") {
    return withSetCookie.getSetCookie();
  }
  if (typeof withSetCookie.raw === "function") {
    return withSetCookie.raw()["set-cookie"] ?? [];
  }
  const combined = headers.get("set-cookie");
  return combined ? splitCombinedSetCookieHeader(combined) : [];
}

export function extractCsrfToken(body: unknown): string {
  if (
    typeof body === "object"
    && body !== null
    && "csrfToken" in body
    && typeof body.csrfToken === "string"
    && body.csrfToken.length > 0
  ) {
    return body.csrfToken;
  }
  throw new Error("Login response did not include a csrfToken");
}

export function buildAuthHeaders(input: AuthHeaderInput): Record<string, string> {
  return {
    Cookie: input.cookieJar,
    "X-CSRF-Token": input.csrfToken,
    "X-Workspace-Slug": input.workspaceSlug,
  };
}

export async function assertExpectedStatus(
  name: string,
  response: Response,
  allowedStatuses: readonly number[],
): Promise<void> {
  if (allowedStatuses.includes(response.status)) {
    return;
  }

  const body = await response.text();
  throw new Error(
    `${name} expected HTTP ${allowedStatuses.join(" or ")} but received ${response.status} ${response.statusText}: ${body}`,
  );
}

function buildUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//u.test(path)) {
    return path;
  }
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function requestStep(params: {
  name: string;
  fetchImpl: FetchLike;
  url: string;
  init?: RequestInit;
  expectedStatuses: readonly number[];
}): Promise<SmokeStepResult> {
  const response = await params.fetchImpl(params.url, params.init);
  await assertExpectedStatus(params.name, response, params.expectedStatuses);
  return {
    name: params.name,
    status: response.status,
  };
}

export async function runAuthWorkspaceSmoke(
  config: SmokeConfig = readSmokeConfig(),
  fetchImpl: FetchLike = fetch,
): Promise<SmokeStepResult[]> {
  const results: SmokeStepResult[] = [];

  results.push(await requestStep({
    name: "web URL",
    fetchImpl,
    url: config.webUrl,
    expectedStatuses: [200],
  }));

  const loginResponse = await fetchImpl(buildUrl(config.apiUrl, "/api/auth/login"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Workspace-Slug": config.workspaceSlug,
    },
    body: JSON.stringify({
      username: config.loginUsername,
      password: config.password,
    }),
  });
  await assertExpectedStatus("local login", loginResponse, [200]);
  results.push({ name: "local login", status: loginResponse.status });

  const cookieJar = parseSetCookieHeaders(extractSetCookieHeaders(loginResponse.headers));
  const csrfToken = extractCsrfToken(await loginResponse.json());
  const authHeaders = buildAuthHeaders({
    cookieJar,
    csrfToken,
    workspaceSlug: config.workspaceSlug,
  });

  results.push(await requestStep({
    name: "authenticated /api/auth/me",
    fetchImpl,
    url: buildUrl(config.apiUrl, "/api/auth/me"),
    init: { headers: authHeaders },
    expectedStatuses: [200],
  }));

  results.push(await requestStep({
    name: "workspace member route",
    fetchImpl,
    url: buildUrl(config.apiUrl, config.memberRoute),
    init: { headers: authHeaders },
    expectedStatuses: [200],
  }));

  results.push(await requestStep({
    name: "wrong workspace denial",
    fetchImpl,
    url: buildUrl(config.apiUrl, config.memberRoute),
    init: {
      headers: buildAuthHeaders({
        cookieJar,
        csrfToken,
        workspaceSlug: config.wrongWorkspaceSlug,
      }),
    },
    expectedStatuses: [403],
  }));

  results.push(await requestStep({
    name: "anonymous workspace denial",
    fetchImpl,
    url: buildUrl(config.apiUrl, config.memberRoute),
    init: {
      headers: {
        "X-Workspace-Slug": config.workspaceSlug,
      },
    },
    expectedStatuses: [401],
  }));

  results.push(await requestStep({
    name: "member admin-only denial",
    fetchImpl,
    url: buildUrl(config.apiUrl, config.adminRoute),
    init: { headers: authHeaders },
    expectedStatuses: [403],
  }));

  return results;
}

function isMainModule(): boolean {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

if (isMainModule()) {
  runAuthWorkspaceSmoke()
    .then((results) => {
      for (const result of results) {
        console.log(`PASS ${result.name}: HTTP ${result.status}`);
      }
      console.log("PASS session cookie + CSRF token capture: values present (redacted)");
      console.log("Auth workspace smoke passed.");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
