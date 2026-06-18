/**
 * Account-scoped login rate limiter.
 *
 * Keys on `${normalizedUsername}:${clientIp}` so an account under attack is
 * throttled regardless of attacker IP, while a single attacker IP cannot lock
 * out many different accounts. After {@link LOGIN_MAX_FAILURES} failures within
 * {@link LOGIN_WINDOW_MS}, the key is locked for {@link LOGIN_LOCKOUT_MS}.
 *
 * In-memory (single-instance). Resets on process restart — acceptable for
 * Phase 1 (attacker loses progress; legitimate users unaffected). Move to a
 * shared store only if operationally required.
 */

import { extractClientIp } from "./rate-limit.js";

export { extractClientIp };

/** Max failed attempts per username+IP before lockout. */
export const LOGIN_MAX_FAILURES = 5;
/** Sliding window over which failures are counted (15 minutes). */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Lockout duration once the threshold is hit (15 minutes). */
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

interface LoginAttemptEntry {
  /** Timestamps of failures within the current window. */
  failures: number[];
  /** Absolute time (epoch ms) when the active lockout expires. */
  lockedUntil: number;
}

export interface LoginAttemptCheck {
  /** Whether a login attempt is currently allowed for this key. */
  allowed: boolean;
  /** Seconds remaining on the active lockout (0 when allowed). */
  retryAfterSeconds: number;
  /** Failures remaining before the next lockout triggers. */
  failuresRemaining: number;
}

const store = new Map<string, LoginAttemptEntry>();

// Periodic cleanup of expired entries so the store does not grow unbounded.
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    const hasLiveFailures = entry.failures.some((ts) => now - ts < LOGIN_WINDOW_MS);
    if (!hasLiveFailures && now >= entry.lockedUntil) {
      store.delete(key);
    }
  }
}, 60_000);
if (cleanupInterval.unref) {
  cleanupInterval.unref();
}

function normalize(username: string): string {
  return username.trim().toLowerCase();
}

function buildKey(username: string, clientIp: string): string {
  return `${normalize(username)}:${clientIp}`;
}

function pruneOldFailures(entry: LoginAttemptEntry, now: number): void {
  const cutoff = now - LOGIN_WINDOW_MS;
  entry.failures = entry.failures.filter((ts) => ts >= cutoff);
}

/**
 * Check whether a login attempt for the given username+IP is currently allowed.
 * Does NOT mutate state — call {@link recordLoginFailure} or {@link resetOnSuccess}
 * to update the counter.
 */
export function checkLoginAttempt(username: string, clientIp: string): LoginAttemptCheck {
  const key = buildKey(username, clientIp);
  const now = Date.now();
  const entry = store.get(key);

  if (!entry) {
    return { allowed: true, retryAfterSeconds: 0, failuresRemaining: LOGIN_MAX_FAILURES };
  }

  if (now < entry.lockedUntil) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
      failuresRemaining: 0,
    };
  }

  pruneOldFailures(entry, now);
  const failuresRemaining = Math.max(0, LOGIN_MAX_FAILURES - entry.failures.length);
  return { allowed: true, retryAfterSeconds: 0, failuresRemaining };
}

/**
 * Record a failed login attempt. If the failure count within the window crosses
 * the threshold, the key is locked for {@link LOGIN_LOCKOUT_MS}.
 */
export function recordLoginFailure(username: string, clientIp: string): void {
  const key = buildKey(username, clientIp);
  const now = Date.now();
  let entry = store.get(key);
  if (!entry) {
    entry = { failures: [], lockedUntil: 0 };
    store.set(key, entry);
  }
  pruneOldFailures(entry, now);
  entry.failures.push(now);
  if (entry.failures.length >= LOGIN_MAX_FAILURES) {
    entry.lockedUntil = now + LOGIN_LOCKOUT_MS;
  }
}

/**
 * Reset the failure counter for a key after a successful login. A successful
 * login proves the legitimate user still has the credential, so prior failures
 * should not accumulate toward a lockout.
 */
export function resetOnSuccess(username: string, clientIp: string): void {
  const key = buildKey(username, clientIp);
  store.delete(key);
}

/** Test-only: clear the in-memory store. Keeps tests independent. */
export function __resetLoginRateLimiterForTests(): void {
  store.clear();
}

/**
 * Clear all lockout entries for a username across every IP. Returns the
 * number of entries removed. Use from the admin-unlock route so a locked-out
 * user (typically the only admin who fat-fingered their password) can recover
 * without waiting 15 minutes or restarting the API.
 */
export function clearLoginLockout(username: string): number {
  const normalized = normalize(username);
  const prefix = `${normalized}:`;
  let removed = 0;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      removed += 1;
    }
  }
  return removed;
}
