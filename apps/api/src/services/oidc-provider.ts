import * as client from "openid-client";

import type { StoredOidcState } from "./auth-types.js";

export type OidcSettings = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
};

export type OidcIdentityClaims = {
  provider: "casdoor";
  providerSubject: string;
  providerTenant: string;
  email?: string;
  displayName?: string;
  rawProfile: unknown;
};

type SaveOidcState = (state: StoredOidcState) => void | Promise<void>;

function readStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }

  const field = value[key as keyof typeof value];
  return typeof field === "string" ? field : undefined;
}

export class CasdoorOidcProvider {
  private configPromise?: Promise<client.Configuration>;

  constructor(private readonly settings: OidcSettings) {}

  async buildLoginUrl(
    redirectTo: string | undefined,
    saveState: SaveOidcState,
  ): Promise<{ url: URL; state: StoredOidcState }> {
    const config = await this.discover();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();
    const storedState: StoredOidcState = {
      state,
      provider: "casdoor",
      codeVerifier,
      nonce,
      redirectTo,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };

    await saveState(storedState);

    const url = client.buildAuthorizationUrl(config, {
      client_id: this.settings.clientId,
      redirect_uri: this.settings.redirectUri,
      scope: this.settings.scope,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });

    return { url, state: storedState };
  }

  async handleCallback(callbackUrl: URL, state: StoredOidcState): Promise<OidcIdentityClaims> {
    if (state.provider !== "casdoor") {
      throw new Error("Unsupported OIDC provider");
    }

    const config = await this.discover();
    const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
      expectedNonce: state.nonce,
      expectedState: state.state,
      idTokenExpected: true,
      pkceCodeVerifier: state.codeVerifier,
    });
    const claims = tokens.claims();
    const providerSubject = claims?.sub;
    if (!providerSubject) {
      throw new Error("OIDC subject claim is required");
    }
    if (!tokens.access_token) {
      throw new Error("OIDC access token is required");
    }

    const userInfo = await client.fetchUserInfo(config, tokens.access_token, providerSubject);
    const email = readStringField(userInfo, "email") ?? readStringField(claims, "email");
    const displayName = readStringField(userInfo, "name") ?? readStringField(claims, "name");

    return {
      provider: "casdoor",
      providerSubject,
      providerTenant: this.settings.issuer,
      email,
      displayName,
      rawProfile: userInfo,
    };
  }

  private discover(): Promise<client.Configuration> {
    this.configPromise ??= client.discovery(
      new URL(this.settings.issuer),
      this.settings.clientId,
      undefined,
      client.ClientSecretPost(this.settings.clientSecret),
    );
    return this.configPromise;
  }
}
