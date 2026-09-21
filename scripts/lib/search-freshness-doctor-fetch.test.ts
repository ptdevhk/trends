import http from "node:http";

import { request } from "undici";
import { describe, expect, it } from "vitest";

import {
  SEARCH_FRESHNESS_DOCTOR_FALLBACK_FETCH_TIMEOUT_MS,
  SEARCH_FRESHNESS_DOCTOR_FETCH_TIMEOUT_MS,
  UNDICI_DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithSearchFreshnessDoctorTimeout,
  searchFreshnessDoctorUndiciTimeouts,
} from "./search-freshness-doctor-fetch.ts";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        resolve(address.port);
        return;
      }
      reject(new Error("server did not bind a port"));
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** Headers delayed past undici's ~1 s fast-timer resolution, under AbortSignal. */
const DELAYED_HEADERS_MS = 2_000;

describe("searchFreshnessDoctorUndiciTimeouts", () => {
  it("raises headersTimeout and bodyTimeout above undici's 300s fetch ceiling", () => {
    const preferred = searchFreshnessDoctorUndiciTimeouts(
      SEARCH_FRESHNESS_DOCTOR_FETCH_TIMEOUT_MS,
    );
    expect(preferred.headersTimeout).toBeGreaterThan(UNDICI_DEFAULT_FETCH_TIMEOUT_MS);
    expect(preferred.bodyTimeout).toBeGreaterThan(UNDICI_DEFAULT_FETCH_TIMEOUT_MS);
    expect(preferred.headersTimeout).toBe(SEARCH_FRESHNESS_DOCTOR_FETCH_TIMEOUT_MS);
    expect(preferred.bodyTimeout).toBe(SEARCH_FRESHNESS_DOCTOR_FETCH_TIMEOUT_MS);

    const fallback = searchFreshnessDoctorUndiciTimeouts(
      SEARCH_FRESHNESS_DOCTOR_FALLBACK_FETCH_TIMEOUT_MS,
    );
    expect(fallback.headersTimeout).toBeGreaterThan(UNDICI_DEFAULT_FETCH_TIMEOUT_MS);
    expect(fallback.bodyTimeout).toBeGreaterThan(UNDICI_DEFAULT_FETCH_TIMEOUT_MS);
  });
});

describe("fetchWithSearchFreshnessDoctorTimeout", () => {
  it("AbortSignal above undici headersTimeout still fails on delayed headers", async () => {
    const server = http.createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }, DELAYED_HEADERS_MS);
    });
    const port = await listen(server);
    try {
      // Same shape as the live leftover: AbortSignal.timeout(600s) with undici's
      // 300s headersTimeout still throws (here scaled to 10s vs 1ms).
      await expect(
        request(`http://127.0.0.1:${port}/`, {
          method: "GET",
          signal: AbortSignal.timeout(10_000),
          ...searchFreshnessDoctorUndiciTimeouts(1),
        }),
      ).rejects.toMatchObject({
        name: "HeadersTimeoutError",
        message: "Headers Timeout Error",
      });
    } finally {
      await closeServer(server);
    }
  });

  it("raised headersTimeout/bodyTimeout lets delayed headers complete", async () => {
    const server = http.createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, scan: "preferred" }));
      }, DELAYED_HEADERS_MS);
    });
    const port = await listen(server);
    try {
      const res = await fetchWithSearchFreshnessDoctorTimeout(
        `http://127.0.0.1:${port}/`,
        { timeoutMs: 10_000 },
      );
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true, scan: "preferred" });
    } finally {
      await closeServer(server);
    }
  });
});
