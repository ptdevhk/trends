import { afterEach, describe, expect, it, vi } from "vitest";
import { loginAsAdmin, postJson } from "./verify-industry-scores";

const SESSION = "sess-value-123";
const CSRF = "csrf-value-456";

function joinedSetCookieHeader(): string {
  // fetch joins multiple Set-Cookie headers with ", " — this mirrors that shape.
  return [
    `${SESSION_COOKIE}=${SESSION}; Path=/; HttpOnly; SameSite=Lax`,
    `${CSRF_COOKIE}=${CSRF}; Path=/; HttpOnly; SameSite=Lax`,
  ].join(", ");
}

const SESSION_COOKIE = "trends_session";
const CSRF_COOKIE = "trends_csrf";

describe("loginAsAdmin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns session + CSRF cookies from the joined Set-Cookie header", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "Set-Cookie": joinedSetCookieHeader() }),
      text: async () => "",
    })));

    const auth = await loginAsAdmin("http://api.test");

    expect(auth.cookieHeader).toBe(`${SESSION_COOKIE}=${SESSION}; ${CSRF_COOKIE}=${CSRF}`);
    expect(auth.csrfToken).toBe(CSRF);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/auth/login",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Workspace-Slug": "dev",
        }),
        body: JSON.stringify({ username: "demo-admin", password: "admin123" }),
      }),
    );
  });

  it("throws when the session cookie is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "Set-Cookie": `${CSRF_COOKIE}=${CSRF}; Path=/` }),
      text: async () => "",
    })));

    await expect(loginAsAdmin("http://api.test")).rejects.toThrow(
      /Unable to parse session cookie \(trends_session\)/,
    );
  });

  it("throws when the CSRF cookie is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "Set-Cookie": `${SESSION_COOKIE}=${SESSION}; Path=/` }),
      text: async () => "",
    })));

    await expect(loginAsAdmin("http://api.test")).rejects.toThrow(
      /Login set no CSRF cookie \(trends_csrf\)/,
    );
  });

  it("throws with the API error body when login is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: async () => '{"success":false,"error":"bad credentials"}',
    })));

    await expect(loginAsAdmin("http://api.test")).rejects.toThrow(
      /Login failed \(401\).*bad credentials/s,
    );
  });
});

describe("postJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends Cookie + X-CSRF-Token headers when an auth session is provided", async () => {
    const responseBody = { ok: true };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(url).toBe("http://api.test/api/resumes/import");
      expect(headers.Cookie).toBe(`${SESSION_COOKIE}=${SESSION}; ${CSRF_COOKIE}=${CSRF}`);
      expect(headers["X-CSRF-Token"]).toBe(CSRF);
      expect(headers["X-Workspace-Slug"]).toBe("dev");
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => "",
        json: async () => responseBody,
      };
    }));

    const result = await postJson(
      "http://api.test/api/resumes/import",
      { hello: "world" },
      { cookieHeader: `${SESSION_COOKIE}=${SESSION}; ${CSRF_COOKIE}=${CSRF}`, csrfToken: CSRF },
    );

    expect(result).toEqual(responseBody);
  });

  it("omits auth headers when no session is provided", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Cookie).toBeUndefined();
      expect(headers["X-CSRF-Token"]).toBeUndefined();
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => "",
        json: async () => ({}),
      };
    }));

    await postJson("http://api.test/api/resumes/import", {});
  });

  it("throws with status + body on non-ok responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 403,
      headers: new Headers(),
      text: async () => '{"success":false,"error":"CSRF token required"}',
    })));

    await expect(postJson("http://api.test/api/resumes/import", {})).rejects.toThrow(
      /Request failed \(403\).*CSRF token required/s,
    );
  });
});
