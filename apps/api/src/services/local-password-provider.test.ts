import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./local-password-provider.js";

describe("local password provider", () => {
  it("verifies the original password and rejects a different password", async () => {
    const credential = await hashPassword("Correct Horse Battery Staple 1");

    await expect(verifyPassword("Correct Horse Battery Staple 1", credential)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", credential)).resolves.toBe(false);
  });
});
