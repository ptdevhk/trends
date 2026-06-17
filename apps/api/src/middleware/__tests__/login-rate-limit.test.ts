import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetLoginRateLimiterForTests,
  checkLoginAttempt,
  recordLoginFailure,
  resetOnSuccess,
  LOGIN_LOCKOUT_MS,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
} from "../login-rate-limit.js";

/**
 * Fake-timer based tests for the account-scoped login rate limiter.
 *
 * The module registers a module-level cleanup interval at import time; that
 * interval is harmless under fake timers (its delete condition preserves live
 * /locked entries, and a pruned-to-empty entry observes identically to a
 * deleted one through checkLoginAttempt). We still pair useFakeTimers with an
 * afterAll(unstubAllGlobals) so the fake Date cannot leak to later test files.
 */
describe("login-rate-limit", () => {
  beforeEach(() => {
    __resetLoginRateLimiterForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("allows a fresh key with the full failure budget", () => {
    expect(checkLoginAttempt("alice", "1.1.1.1")).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      failuresRemaining: LOGIN_MAX_FAILURES,
    });
  });

  it("is not mutating: checking repeatedly never counts as a failure", () => {
    for (let i = 0; i < 10; i++) {
      checkLoginAttempt("alice", "1.1.1.1");
    }
    expect(checkLoginAttempt("alice", "1.1.1.1").failuresRemaining).toBe(LOGIN_MAX_FAILURES);
  });

  describe("lockout threshold", () => {
    it("counts failuresRemaining down and locks exactly on the MAX-th failure", () => {
      // MAX-1 failures: still allowed, one failure remaining
      for (let i = 1; i < LOGIN_MAX_FAILURES; i++) {
        recordLoginFailure("alice", "1.1.1.1");
        expect(checkLoginAttempt("alice", "1.1.1.1")).toEqual({
          allowed: true,
          retryAfterSeconds: 0,
          failuresRemaining: LOGIN_MAX_FAILURES - i,
        });
      }

      // MAX-th failure trips the lockout
      recordLoginFailure("alice", "1.1.1.1");
      expect(checkLoginAttempt("alice", "1.1.1.1")).toEqual({
        allowed: false,
        retryAfterSeconds: LOGIN_LOCKOUT_MS / 1000,
        failuresRemaining: 0,
      });
    });
  });

  describe("lockout expiry", () => {
    it("is locked for LOGIN_LOCKOUT_MS then becomes allowed again", () => {
      for (let i = 0; i < LOGIN_MAX_FAILURES; i++) recordLoginFailure("alice", "1.1.1.1");
      expect(checkLoginAttempt("alice", "1.1.1.1").allowed).toBe(false);

      // One second before expiry: still locked, retryAfterSeconds counts down
      vi.advanceTimersByTime(LOGIN_LOCKOUT_MS - 1000);
      expect(checkLoginAttempt("alice", "1.1.1.1")).toEqual({
        allowed: false,
        retryAfterSeconds: 1,
        failuresRemaining: 0,
      });

      // At/after expiry: lockout lifts (old failures still counted, but no lock)
      vi.advanceTimersByTime(1000);
      const after = checkLoginAttempt("alice", "1.1.1.1");
      expect(after.allowed).toBe(true);
      expect(after.retryAfterSeconds).toBe(0);
    });
  });

  describe("sliding-window pruning", () => {
    it("drops failures older than LOGIN_WINDOW_MS so they no longer count toward lockout", () => {
      // 4 failures (one short of the threshold)
      for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) recordLoginFailure("alice", "1.1.1.1");

      // Advance just past the window — the 4 prior failures must be pruned
      vi.advanceTimersByTime(LOGIN_WINDOW_MS + 1);

      // One more failure now: only this single live failure counts → NOT locked
      recordLoginFailure("alice", "1.1.1.1");
      expect(checkLoginAttempt("alice", "1.1.1.1")).toEqual({
        allowed: true,
        retryAfterSeconds: 0,
        failuresRemaining: LOGIN_MAX_FAILURES - 1,
      });
    });

    it("counts a still-live failure straddling the window boundary", () => {
      recordLoginFailure("alice", "1.1.1.1");
      // Advance less than the window — the failure is still live
      vi.advanceTimersByTime(LOGIN_WINDOW_MS - 1);
      recordLoginFailure("alice", "1.1.1.1");
      expect(checkLoginAttempt("alice", "1.1.1.1").failuresRemaining).toBe(LOGIN_MAX_FAILURES - 2);
    });
  });

  describe("resetOnSuccess", () => {
    it("clears accrued failures so a legitimate user does not accumulate toward lockout", () => {
      for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) recordLoginFailure("alice", "1.1.1.1");
      expect(checkLoginAttempt("alice", "1.1.1.1").failuresRemaining).toBe(1);

      resetOnSuccess("alice", "1.1.1.1");

      expect(checkLoginAttempt("alice", "1.1.1.1")).toEqual({
        allowed: true,
        retryAfterSeconds: 0,
        failuresRemaining: LOGIN_MAX_FAILURES,
      });
    });

    it("lifts an active lockout-precursor; subsequent threshold starts fresh", () => {
      // Lock the key, then a successful login resets it entirely
      for (let i = 0; i < LOGIN_MAX_FAILURES; i++) recordLoginFailure("alice", "1.1.1.1");
      resetOnSuccess("alice", "1.1.1.1");
      expect(checkLoginAttempt("alice", "1.1.1.1").allowed).toBe(true);

      // Only 1 failure now — must not be locked
      recordLoginFailure("alice", "1.1.1.1");
      expect(checkLoginAttempt("alice", "1.1.1.1").allowed).toBe(true);
    });
  });

  describe("per-key isolation", () => {
    it("isolates by client IP: a locked account from one IP is unaffected from another", () => {
      for (let i = 0; i < LOGIN_MAX_FAILURES; i++) recordLoginFailure("alice", "1.1.1.1");
      expect(checkLoginAttempt("alice", "1.1.1.1").allowed).toBe(false);

      // Same account, different IP — independent key, fully allowed
      expect(checkLoginAttempt("alice", "2.2.2.2")).toEqual({
        allowed: true,
        retryAfterSeconds: 0,
        failuresRemaining: LOGIN_MAX_FAILURES,
      });
    });

    it("isolates by account: one attacker IP cannot lock out many accounts", () => {
      for (let i = 0; i < LOGIN_MAX_FAILURES; i++) recordLoginFailure("alice", "1.1.1.1");
      expect(checkLoginAttempt("alice", "1.1.1.1").allowed).toBe(false);

      // Same IP, different account — independent key, fully allowed
      expect(checkLoginAttempt("bob", "1.1.2.2")).toEqual({
        allowed: true,
        retryAfterSeconds: 0,
        failuresRemaining: LOGIN_MAX_FAILURES,
      });
    });
  });

  describe("username normalization", () => {
    it("keys on trimmed+lowercased username so case/whitespace variants collide", () => {
      // Accrue failures under a mixed-case, padded username
      for (let i = 0; i < LOGIN_MAX_FAILURES; i++) recordLoginFailure("  Alice  ", "1.1.1.1");

      // Checking under the canonical lowercase form sees the same locked entry
      expect(checkLoginAttempt("alice", "1.1.1.1").allowed).toBe(false);
      expect(checkLoginAttempt("ALICE", "1.1.1.1").allowed).toBe(false);
    });
  });
});
