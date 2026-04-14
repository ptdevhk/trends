import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const makefile = readFileSync(new URL("../Makefile", import.meta.url), "utf8");
const installScript = readFileSync(new URL("./install.sh", import.meta.url), "utf8");
const removedSeedEnvVar = "SEED_" + "RESUMES";

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
  it("uses prod wrappers that never pass the removed resume-seed env var", () => {
    expect(getTargetRecipe("prod-install")).toContain("./scripts/install.sh install");
    expect(getTargetRecipe("prod-deploy")).toContain("./scripts/install.sh upgrade");
    expect(getTargetRecipe("prod-deploy-check")).toContain("./scripts/install.sh upgrade-check");
    expect(getTargetRecipe("prod-install")).not.toContain(removedSeedEnvVar);
    expect(getTargetRecipe("prod-deploy")).not.toContain(removedSeedEnvVar);
    expect(getTargetRecipe("prod-deploy-check")).not.toContain(removedSeedEnvVar);
  });

  it("keeps compatibility aliases mapped to prod wrappers", () => {
    expect(makefile).toMatch(/^install:\s+prod-install$/m);
    expect(makefile).toMatch(/^deploy:\s+prod-deploy$/m);
    expect(makefile).toMatch(/^deploy-check:\s+prod-deploy-check$/m);
  });

  it("removes dead install script logic for that env var", () => {
    expect(installScript).not.toContain(removedSeedEnvVar);
    expect(installScript).not.toContain('[[ -n "${SEED_' + 'RESUMES:-}" ]]');
  });
});
