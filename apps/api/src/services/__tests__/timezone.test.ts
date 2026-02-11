import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TIMEZONE,
  formatDateInTimezone,
  formatIsoOffsetInTimezone,
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
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

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
});
