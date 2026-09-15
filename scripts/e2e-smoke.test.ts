import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("e2e-smoke CDP teardown", () => {
  it("exits after closing the attached browser so Node does not linger", () => {
    const src = readFileSync(new URL("./e2e-smoke.ts", import.meta.url), "utf8");
    expect(src).toMatch(/export function e2eExitCode/);
    expect(src).toMatch(/process\.exit\(e2eExitCode\(failed\)\)/);
    expect(src).not.toMatch(/process\.exit\(1\)/);
  });
});
