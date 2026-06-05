import { createHash, randomBytes } from "node:crypto";

import type { AuthContext } from "./auth-types.js";
import type { AuthStorage } from "./auth-storage.js";

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export class AuthSessionService {
  constructor(
    private readonly storage: AuthStorage,
    private readonly options: { ttlSeconds: number },
  ) {}

  createSession(userId: string): { token: string; csrfToken: string; expiresAt: string } {
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.options.ttlSeconds * 1000).toISOString();

    this.storage.createSession({
      userId,
      tokenHash: hashSecret(token),
      csrfTokenHash: hashSecret(csrfToken),
      expiresAt,
    });

    return { token, csrfToken, expiresAt };
  }

  resolveSession(token: string): AuthContext | null {
    const session = this.storage.findSessionByTokenHash(hashSecret(token));
    if (!session) {
      return null;
    }

    const user = this.storage.findUser(session.userId);
    if (!user) {
      return null;
    }

    return {
      user,
      memberships: this.storage.listMemberships(user.id),
      sessionId: session.id,
      csrfToken: session.csrfTokenHash,
    };
  }

  verifyCsrf(token: string, csrfToken: string): boolean {
    const session = this.storage.findSessionByTokenHash(hashSecret(token));
    return Boolean(session && session.csrfTokenHash === hashSecret(csrfToken));
  }

  revokeSession(token: string): void {
    this.storage.revokeSessionByTokenHash(hashSecret(token));
  }
}
