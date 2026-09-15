import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { existingUatStateShouldSkip, skippedExistingUatStateReport } from "./setup-local-uat-state";

describe("existing industry-review UAT state", () => {
  it("skips when a matching namespace snapshot already exists", () => {
    expect(existingUatStateShouldSkip(true, { namespace: "cnc-cockpit-uat" }, "cnc-cockpit-uat")).toBe(true);
    expect(existingUatStateShouldSkip(true, { namespace: "other" }, "cnc-cockpit-uat")).toBe(false);
    expect(existingUatStateShouldSkip(false, { namespace: "cnc-cockpit-uat" }, "cnc-cockpit-uat")).toBe(false);
  });

  it("reports skipped so the nightly gate can exit 0 without overwriting", () => {
    expect(skippedExistingUatStateReport("/tmp/state.json", "cnc-cockpit-uat")).toEqual({
      status: "skipped",
      reason: "state-file-exists",
      stateFile: "/tmp/state.json",
      namespace: "cnc-cockpit-uat",
    });
  });

  it("setup-local-uat uses the skip helper instead of failing the gate", () => {
    const src = readFileSync(new URL("./setup-local-uat.ts", import.meta.url), "utf8");
    expect(src).toMatch(/existingUatStateShouldSkip/);
    expect(src).toMatch(/skippedExistingUatStateReport/);
    expect(src).not.toMatch(/fail\(`state file already exists/);
  });

  it("skips existing snapshots before requiring a Convex write secret", () => {
    const src = readFileSync(new URL("./setup-local-uat.ts", import.meta.url), "utf8");
    const skipIdx = src.indexOf("if (existingUatStateShouldSkip");
    const secretIdx = src.indexOf("CONVEX_WRITE_SECRET is required");
    expect(skipIdx).toBeGreaterThan(-1);
    expect(secretIdx).toBeGreaterThan(-1);
    expect(skipIdx).toBeLessThan(secretIdx);
  });
});
