import { afterEach, describe, expect, it, vi } from "vitest";

import {
  logger,
  formatTimestamp,
  serializeError,
} from "./logger.js";

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------

describe("formatTimestamp", () => {
  it("returns an ISO 8601 string", () => {
    const ts = formatTimestamp();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("returns a parseable date", () => {
    const ts = formatTimestamp();
    const parsed = new Date(ts);
    expect(parsed.getTime()).not.toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// serializeError
// ---------------------------------------------------------------------------

describe("serializeError", () => {
  it("serializes Error instances with name, message, and stack", () => {
    const error = new Error("test error");
    const result = serializeError(error);
    expect(result.name).toBe("Error");
    expect(result.message).toBe("test error");
    expect(result.stack).toBeTypeOf("string");
  });

  it("serializes custom error types", () => {
    const error = new TypeError("type error");
    const result = serializeError(error);
    expect(result.name).toBe("TypeError");
    expect(result.message).toBe("type error");
  });

  it("serializes non-Error values as string", () => {
    expect(serializeError("string error")).toEqual({ value: "string error" });
    expect(serializeError(42)).toEqual({ value: "42" });
    expect(serializeError(null)).toEqual({ value: "null" });
    expect(serializeError(undefined)).toEqual({ value: "undefined" });
    expect(serializeError({ foo: "bar" })).toEqual({ value: "[object Object]" });
  });
});

// ---------------------------------------------------------------------------
// logger.error
// ---------------------------------------------------------------------------

describe("logger.error", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes JSON to stderr with error level", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.error("Something failed", new Error("boom"));
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.level).toBe("error");
    expect(parsed.message).toBe("Something failed");
    expect(parsed.error.message).toBe("boom");
  });

  it("includes context fields", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.error("Failed", new Error("x"), { route: "resumes/export" });
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.route).toBe("resumes/export");
  });

  it("includes timestamp", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.error("Failed", new Error("x"));
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// logger.warn
// ---------------------------------------------------------------------------

describe("logger.warn", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes JSON to stderr with warn level", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.warn("Slow query");
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.level).toBe("warn");
    expect(parsed.message).toBe("Slow query");
  });

  it("includes context fields", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.warn("Deprecated", { route: "old-endpoint" });
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.route).toBe("old-endpoint");
  });
});

// ---------------------------------------------------------------------------
// logger.info
// ---------------------------------------------------------------------------

describe("logger.info", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes JSON to stderr with info level", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.info("Server started");
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("Server started");
  });

  it("includes context fields", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.info("Request", { method: "GET", path: "/api/health" });
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.method).toBe("GET");
    expect(parsed.path).toBe("/api/health");
  });
});
