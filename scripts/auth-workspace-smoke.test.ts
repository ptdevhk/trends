import { describe, expect, it } from "vitest";

import {
  assertExpectedStatus,
  buildAuthHeaders,
  extractCsrfToken,
  parseSetCookieHeaders,
  readSmokeConfig,
  runAuthWorkspaceSmoke,
  type SmokeConfig,
} from "./auth-workspace-smoke.ts";

describe("auth workspace smoke helpers", () => {
  it("parses multiple Set-Cookie headers into a browser-style cookie jar", () => {
    const jar = parseSetCookieHeaders([
      "trends_session=session-token; Path=/; HttpOnly; SameSite=Lax",
      "trends_csrf=csrf-token; Path=/; SameSite=Lax",
    ]);

    expect(jar).toBe("trends_session=session-token; trends_csrf=csrf-token");
  });

  it("splits a combined Set-Cookie header without splitting Expires commas", () => {
    const jar = parseSetCookieHeaders(
      "trends_session=session-token; Expires=Tue, 09 Jun 2026 10:18:14 GMT; Path=/; HttpOnly, trends_csrf=csrf-token; Path=/",
    );

    expect(jar).toBe("trends_session=session-token; trends_csrf=csrf-token");
  });

  it("extracts the CSRF token from the local login response", () => {
    expect(extractCsrfToken({
      success: true,
      csrfToken: "csrf-token-1",
    })).toBe("csrf-token-1");
  });

  it("requires a CSRF token in the login response", () => {
    expect(() => extractCsrfToken({ success: true })).toThrow(/csrf/i);
  });

  it("builds auth headers with cookie, CSRF, and workspace selection", () => {
    expect(buildAuthHeaders({
      cookieJar: "trends_session=session-token; trends_csrf=csrf-token",
      csrfToken: "csrf-token",
      workspaceSlug: "hr",
    })).toEqual({
      Cookie: "trends_session=session-token; trends_csrf=csrf-token",
      "X-CSRF-Token": "csrf-token",
      "X-Workspace-Slug": "hr",
    });
  });

  it("accepts expected status codes", async () => {
    const response = new Response(JSON.stringify({ success: true }), { status: 200 });

    await expect(assertExpectedStatus("allowed route", response, [200])).resolves.toBeUndefined();
  });

  it("reports unexpected status codes with response body", async () => {
    const response = new Response(JSON.stringify({ error: "Workspace access required" }), { status: 403 });

    await expect(assertExpectedStatus("allowed route", response, [200]))
      .rejects
      .toThrow(/allowed route.*403.*Workspace access required/s);
  });

  it("reads smoke configuration from environment without leaking credentials", () => {
    expect(readSmokeConfig({
      API_URL: "https://api.example.com/",
      WEB_URL: "https://web.example.com/",
      WORKSPACE: "hr",
      AUTH_SMOKE_EMAIL: "member@example.com",
      AUTH_SMOKE_PASSWORD: "secret",
    })).toMatchObject({
      apiUrl: "https://api.example.com",
      webUrl: "https://web.example.com",
      workspaceSlug: "hr",
      wrongWorkspaceSlug: "dev",
      loginUsername: "member@example.com",
      password: "secret",
    });
  });

  it("requires smoke credentials from the environment", () => {
    expect(() => readSmokeConfig({})).toThrow(/AUTH_SMOKE_EMAIL.*AUTH_SMOKE_PASSWORD/s);
  });

  it("runs negative auth smokes before logout success", async () => {
    const config: SmokeConfig = {
      apiUrl: "https://api.example.com",
      webUrl: "https://web.example.com",
      workspaceSlug: "hr",
      wrongWorkspaceSlug: "dev",
      loginUsername: "member@example.com",
      password: "secret",
      memberRoute: "/api/resumes?limit=1",
      adminRoute: "/api/auth/events?limit=1",
    };
    const calls: Array<{ url: string; headers: Headers; method: string }> = [];

    const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const method = init?.method ?? "GET";
      calls.push({ url, headers, method });

      if (url === config.webUrl) {
        return new Response("ok", { status: 200 });
      }
      if (url === `${config.apiUrl}/api/auth/login`) {
        return new Response(JSON.stringify({ success: true, csrfToken: "csrf-token" }), {
          status: 200,
          headers: {
            "set-cookie": "trends_session=session-token; Path=/; HttpOnly, trends_csrf=csrf-token; Path=/",
          },
        });
      }
      if (url === `${config.apiUrl}/api/auth/me`) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (url === `${config.apiUrl}${config.memberRoute}`) {
        if (!headers.get("Cookie")) {
          return new Response(JSON.stringify({ success: false, error: "Authentication required" }), { status: 401 });
        }
        if (headers.get("X-Workspace-Slug") === config.wrongWorkspaceSlug) {
          return new Response(JSON.stringify({ success: false, error: "Workspace access required" }), { status: 403 });
        }
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (url === `${config.apiUrl}${config.adminRoute}`) {
        return new Response(JSON.stringify({ success: false, error: "Admin access required" }), { status: 403 });
      }
      if (url === `${config.apiUrl}/api/auth/logout` && method === "POST") {
        const status = headers.get("X-CSRF-Token") === "csrf-token" ? 200 : 403;
        return new Response(JSON.stringify({ success: status === 200 }), { status });
      }
      return new Response(JSON.stringify({ success: false, error: `Unhandled ${method} ${url}` }), { status: 500 });
    };

    const results = await runAuthWorkspaceSmoke(config, fetchImpl);

    expect(results.map((result) => result.name)).toEqual([
      "web URL",
      "local login",
      "authenticated /api/auth/me",
      "workspace member route",
      "wrong workspace denial",
      "anonymous workspace denial",
      "member admin-only denial",
      "csrf rejection",
      "logout success",
    ]);

    const logoutCalls = calls.filter((call) => call.url === `${config.apiUrl}/api/auth/logout`);
    expect(logoutCalls).toHaveLength(2);
    expect(logoutCalls[0]?.headers.get("X-CSRF-Token")).toBeNull();
    expect(logoutCalls[1]?.headers.get("X-CSRF-Token")).toBe("csrf-token");
  });
});
