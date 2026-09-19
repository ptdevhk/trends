import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ClientDiagnosticsLogger,
  parseClientDiagnosticEvent,
} from "../client-diagnostics-logger.js";

describe("parseClientDiagnosticEvent", () => {
  it("accepts a convex websocket degraded event", () => {
    expect(
      parseClientDiagnosticEvent({
        kind: "convex_ws_degraded",
        pathname: "/hr/resumes",
        hasEverConnected: true,
        connectionRetries: 4,
        visibility: "visible",
        workspace: "hr",
        timestamp: 1_747_000_000_000,
      }),
    ).toEqual({
      kind: "convex_ws_degraded",
      pathname: "/hr/resumes",
      hasEverConnected: true,
      connectionRetries: 4,
      visibility: "visible",
      workspace: "hr",
      timestamp: 1_747_000_000_000,
    });
  });

  it("accepts a Convex query timeout event", () => {
    expect(
      parseClientDiagnosticEvent({
        kind: "convex_query_timeout",
        pathname: "/hr/resumes",
        hasEverConnected: true,
        connectionRetries: 0,
        workspace: "hr",
        timestamp: 1,
      }),
    ).toEqual(
      expect.objectContaining({
        kind: "convex_query_timeout",
        pathname: "/hr/resumes",
      }),
    );
  });

  it("rejects unknown kinds and missing fields", () => {
    expect(parseClientDiagnosticEvent({ kind: "other", pathname: "/hr/resumes" })).toBeNull();
    expect(parseClientDiagnosticEvent({})).toBeNull();
  });
});

describe("ClientDiagnosticsLogger", () => {
  it("appends one JSONL line per event", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "client-diagnostics-"));
    const logger = new ClientDiagnosticsLogger(root);
    logger.logEvent({
      kind: "convex_ws_degraded",
      pathname: "/hr/resumes",
      hasEverConnected: false,
      connectionRetries: 2,
      workspace: "hr",
      timestamp: 100,
    });
    logger.logEvent({
      kind: "convex_ws_retry",
      pathname: "/hr/resumes",
      hasEverConnected: false,
      connectionRetries: 2,
      workspace: "hr",
      timestamp: 101,
    });

    const lines = fs
      .readFileSync(path.join(root, "output", "client-diagnostics.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).kind).toBe("convex_ws_degraded");
    expect(JSON.parse(lines[1]).kind).toBe("convex_ws_retry");
  });
});
