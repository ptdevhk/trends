import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "openid-client";

import { CasdoorOidcProvider } from "./oidc-provider.js";
import type { StoredOidcState } from "./auth-types.js";

vi.mock("openid-client", () => ({
  ClientSecretPost: vi.fn(() => "client-secret-post"),
  authorizationCodeGrant: vi.fn(),
  buildAuthorizationUrl: vi.fn((_config: unknown, parameters: Record<string, string>) => {
    const url = new URL("https://auth.example.test/login/oauth/authorize");
    for (const [key, value] of Object.entries(parameters)) {
      url.searchParams.set(key, value);
    }
    return url;
  }),
  calculatePKCECodeChallenge: vi.fn(async () => "challenge-123"),
  discovery: vi.fn(),
  fetchUserInfo: vi.fn(),
  randomNonce: vi.fn(() => "nonce-123"),
  randomPKCECodeVerifier: vi.fn(() => "verifier-123"),
  randomState: vi.fn(() => "state-123"),
}));

const settings = {
  issuer: "https://auth.example.test",
  clientId: "trends",
  clientSecret: "secret",
  redirectUri: "https://app.example.test/api/auth/casdoor/callback",
  scope: "openid profile email",
};

describe("CasdoorOidcProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.discovery).mockResolvedValue({} as Awaited<ReturnType<typeof client.discovery>>);
  });

  it("builds an authorization URL with PKCE and stores state", async () => {
    const provider = new CasdoorOidcProvider(settings);
    const stateStore = vi.fn();

    const result = await provider.buildLoginUrl("/resumes", stateStore);

    expect(result.url.href).toContain("/login/oauth/authorize");
    expect(result.url.searchParams.get("client_id")).toBe("trends");
    expect(result.url.searchParams.get("redirect_uri")).toBe(settings.redirectUri);
    expect(result.url.searchParams.get("scope")).toBe("openid profile email");
    expect(result.url.searchParams.get("code_challenge")).toBe("challenge-123");
    expect(result.url.searchParams.get("state")).toBe("state-123");
    expect(result.url.searchParams.get("nonce")).toBe("nonce-123");
    expect(stateStore).toHaveBeenCalledWith(expect.objectContaining({
      state: "state-123",
      provider: "casdoor",
      codeVerifier: "verifier-123",
      nonce: "nonce-123",
      redirectTo: "/resumes",
    }));
  });

  it("maps validated callback claims to a Casdoor identity", async () => {
    vi.mocked(client.authorizationCodeGrant).mockResolvedValue({
      access_token: "access-token",
      claims: () => ({ sub: "casdoor-user-1", email: "hr@example.com" }),
      expiresIn: () => 3600,
    } as unknown as Awaited<ReturnType<typeof client.authorizationCodeGrant>>);
    vi.mocked(client.fetchUserInfo).mockResolvedValue({
      sub: "casdoor-user-1",
      name: "HR Manager",
      email: "hr@example.com",
    });

    const provider = new CasdoorOidcProvider(settings);
    const state: StoredOidcState = {
      state: "state-123",
      provider: "casdoor",
      codeVerifier: "verifier-123",
      nonce: "nonce-123",
      redirectTo: "/resumes",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };

    const identity = await provider.handleCallback(
      new URL(`${settings.redirectUri}?code=code-123&state=state-123`),
      state,
    );

    expect(client.authorizationCodeGrant).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(URL),
      {
        expectedNonce: "nonce-123",
        expectedState: "state-123",
        idTokenExpected: true,
        pkceCodeVerifier: "verifier-123",
      },
    );
    expect(identity).toEqual({
      provider: "casdoor",
      providerSubject: "casdoor-user-1",
      providerTenant: "https://auth.example.test",
      email: "hr@example.com",
      displayName: "HR Manager",
      rawProfile: {
        sub: "casdoor-user-1",
        name: "HR Manager",
        email: "hr@example.com",
      },
    });
  });
});
