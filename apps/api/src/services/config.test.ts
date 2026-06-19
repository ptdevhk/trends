import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// config.ts reads process.env at module load. To exercise the
// AUTH_ADMIN_RESET_ENABLED default semantics (default true; opt-out
// only via explicit "false"), reset the module registry between cases
// so each sees a fresh env on import.
async function loadConfig() {
  vi.resetModules();
  const { config } = await import("./config.js");
  return config as { auth: { adminResetEnabled: boolean } };
}

const ENV_KEY = "AUTH_ADMIN_RESET_ENABLED";

describe("AUTH_ADMIN_RESET_ENABLED default", () => {
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
  });

  it("defaults to true when unset", async () => {
    const config = await loadConfig();
    expect(config.auth.adminResetEnabled).toBe(true);
  });

  it("is true when set to 'true'", async () => {
    process.env[ENV_KEY] = "true";
    const config = await loadConfig();
    expect(config.auth.adminResetEnabled).toBe(true);
  });

  it("is false only when explicitly set to 'false'", async () => {
    process.env[ENV_KEY] = "false";
    const config = await loadConfig();
    expect(config.auth.adminResetEnabled).toBe(false);
  });

  it("is true for any non-'false' value (e.g. '1')", async () => {
    process.env[ENV_KEY] = "1";
    const config = await loadConfig();
    expect(config.auth.adminResetEnabled).toBe(true);
  });
});
