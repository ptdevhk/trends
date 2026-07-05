import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "../logger";
import {
  DEFAULT_TIMEZONE,
  formatDateInTimezone,
  formatIsoOffsetInTimezone,
  getLocalDatePartsInTimezone,
  resolveLocalMidnightUtc,
  resolveTimezone,
} from "../timezone";

function createProjectConfig(timezone: string): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trends-timezone-"));
  const configDir = path.join(projectRoot, "config");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "config.yaml"),
    `app:\n  timezone: "${timezone}"\n`,
    "utf8",
  );
  return projectRoot;
}

function createMalformedProjectConfig(): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trends-timezone-"));
  const configDir = path.join(projectRoot, "config");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "config.yaml"), "app:\n  timezone: [", "utf8");
  return projectRoot;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveTimezone", () => {
  it("uses Asia/Hong_Kong as default", () => {
    expect(DEFAULT_TIMEZONE).toBe("Asia/Hong_Kong");
    expect(resolveTimezone()).toBe("Asia/Hong_Kong");
  });

  it("prefers env timezone over config timezone", () => {
    const projectRoot = createProjectConfig("Europe/London");
    try {
      const resolved = resolveTimezone({
        envTimezone: "America/New_York",
        projectRoot,
      });
      expect(resolved).toBe("America/New_York");
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("uses config timezone when env is not provided", () => {
    const projectRoot = createProjectConfig("Europe/London");
    try {
      const resolved = resolveTimezone({ projectRoot });
      expect(resolved).toBe("Europe/London");
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("falls back to default timezone when inputs are invalid", () => {
    const projectRoot = createProjectConfig("Invalid/Config");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    try {
      const resolved = resolveTimezone({
        envTimezone: "Invalid/Env",
        projectRoot,
      });

      expect(resolved).toBe("Asia/Hong_Kong");
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("logs malformed config before falling back to default timezone", () => {
    const projectRoot = createMalformedProjectConfig();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(resolveTimezone({ projectRoot })).toBe("Asia/Hong_Kong");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        "[timezone] Failed to read timezone from config",
        expect.any(Error),
      );
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("timezone formatting helpers", () => {
  it("formats ISO datetime with explicit timezone offset", () => {
    const formatted = formatIsoOffsetInTimezone("2026-02-11T07:03:47Z", "Asia/Hong_Kong");
    expect(formatted).toBe("2026-02-11T15:03:47+08:00");
  });

  it("formats date key in target timezone to avoid UTC day shifts", () => {
    const dateKey = formatDateInTimezone("2026-02-11T23:30:00Z", "Asia/Hong_Kong");
    expect(dateKey).toBe("2026-02-12");
  });

  it("reads local date parts in the target timezone", () => {
    expect(getLocalDatePartsInTimezone("2026-02-11T23:30:00Z", "Asia/Hong_Kong")).toEqual({
      year: 2026,
      month: 2,
      day: 12,
    });
  });

  it("resolves local midnight in a non-DST timezone", () => {
    const resolved = resolveLocalMidnightUtc(
      { year: 2026, month: 3, day: 23 },
      "Asia/Hong_Kong",
    );

    expect(resolved.toISOString()).toBe("2026-03-22T16:00:00.000Z");
    expect(formatIsoOffsetInTimezone(resolved, "Asia/Hong_Kong")).toBe("2026-03-23T00:00:00+08:00");
  });

  it("resolves local midnight across the spring DST transition", () => {
    const resolved = resolveLocalMidnightUtc(
      { year: 2026, month: 3, day: 30 },
      "Europe/London",
    );

    expect(resolved.toISOString()).toBe("2026-03-29T23:00:00.000Z");
    expect(formatIsoOffsetInTimezone(resolved, "Europe/London")).toBe("2026-03-30T00:00:00+01:00");
  });

  it("resolves local midnight after the fall DST transition", () => {
    const resolved = resolveLocalMidnightUtc(
      { year: 2026, month: 10, day: 26 },
      "Europe/London",
    );

    expect(resolved.toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(formatIsoOffsetInTimezone(resolved, "Europe/London")).toBe("2026-10-26T00:00:00+00:00");
  });
});
