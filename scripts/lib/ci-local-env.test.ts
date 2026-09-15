import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CI_LOCAL_SCRUB_KEYS, scrubCiLocalEnv } from "./ci-local-env.ts";

const makefile = readFileSync(new URL("../../Makefile", import.meta.url), "utf8");

function getTargetRecipe(target: string): string {
  const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedTarget}:\\n((?:\\t.*\\n)+)`, "m");
  const match = makefile.match(pattern);
  if (!match || !match[1]) {
    throw new Error(`Missing Makefile recipe for target: ${target}`);
  }
  return match[1];
}

describe("scrubCiLocalEnv", () => {
  it("drops profile-exported vars that made ci-local non-deterministic", () => {
    expect(
      scrubCiLocalEnv({
        CONVEX_DEPLOYMENT: "anonymous",
        AI_FALLBACK_MODEL: "openai/leaky-profile-model",
        AUTH_HR_DEMO_TOKEN: "desk-token",
        PATH: "/usr/bin",
        CI: "true",
      }),
    ).toEqual({
      PATH: "/usr/bin",
      CI: "true",
    });
  });

  it("exports the same keys Makefile unsets", () => {
    expect([...CI_LOCAL_SCRUB_KEYS]).toEqual([
      "CONVEX_DEPLOYMENT",
      "AI_FALLBACK_MODEL",
      "AUTH_HR_DEMO_TOKEN",
    ]);
  });
});

describe("make ci-local env isolation", () => {
  it("unsets the polluted keys before CI-parity gates", () => {
    const recipe = getTargetRecipe("ci-local");
    for (const key of CI_LOCAL_SCRUB_KEYS) {
      expect(recipe).toContain(`-u ${key}`);
    }
  });
});
