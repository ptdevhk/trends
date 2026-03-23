import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const makefile = readFileSync(new URL("../Makefile", import.meta.url), "utf8");
const installScript = readFileSync(new URL("./install.sh", import.meta.url), "utf8");

function getTargetRecipe(target: string): string {
  const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedTarget}:\\n((?:\\t.*\\n)+)`, "m");
  const match = makefile.match(pattern);
  if (!match || !match[1]) {
    throw new Error(`Missing Makefile recipe for target: ${target}`);
  }
  return match[1];
}

describe("install/deploy demo resume safety", () => {
  it("forces non-seeding wrappers to disable demo resumes explicitly", () => {
    expect(getTargetRecipe("install")).toContain("SEED_RESUMES=0");
    expect(getTargetRecipe("deploy")).toContain("SEED_RESUMES=0");
    expect(getTargetRecipe("deploy-check")).toContain("SEED_RESUMES=0");
  });

  it("keeps seed wrappers opt-in and explicit", () => {
    expect(getTargetRecipe("install-seed")).toContain("SEED_RESUMES=1");
    expect(getTargetRecipe("deploy-seed")).toContain("SEED_RESUMES=1");
  });

  it("uses strict truthiness checks in the installer instead of non-empty env checks", () => {
    const truthyChecks = installScript.match(/if is_truthy "\$\{SEED_RESUMES:-\}"; then/g) ?? [];

    expect(truthyChecks).toHaveLength(3);
    expect(installScript).not.toContain('[[ -n "${SEED_RESUMES:-}" ]]');
  });
});
