import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectBffPaths,
  collectConvexFunctions,
  verifyConvexCallPaths,
} from "./check-convex-function-paths.js";

/** Build a temp repo root. */
function ROOT(): string {
  return mkdtempSync(join(tmpdir(), "convex-path-check-"));
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

const apiCall = (path: string): string =>
  `import { callConvexQuery } from "./convex-utils.js";
export async function run() {
  const value = await callConvexQuery("${path}", { writeSecret: "s" });
  return value;
}`;

describe("collectConvexFunctions", () => {
  it("registers defining exports as module:name", () => {
    const root = ROOT();
    writeFileSync(join(root, "a.ts"), 'export const foo = query({ handler: async () => 1 });\nexport const bar = mutation({ handler: async () => 1 });');
    const paths = collectConvexFunctions(root);
    expect(paths.has("a:foo")).toBe(true);
    expect(paths.has("a:bar")).toBe(true);
    cleanup(root);
  });

  it("registers barrel re-exports as aliases under the re-exporting module (companies pattern)", () => {
    const root = ROOT();
    writeFileSync(join(root, "b.ts"), 'export const target = query({ handler: async () => 1 });');
    writeFileSync(
      join(root, "companies.ts"),
      'export {\n  target,\n} from "./b.js";\nexport { other as renamed } from "./b.js";',
    );
    const paths = collectConvexFunctions(root);
    expect(paths.has("b:target")).toBe(true);
    expect(paths.has("companies:target")).toBe(true);
    expect(paths.has("companies:renamed")).toBe(true);
    cleanup(root);
  });

  it("skips generated modules and does not match internal functions", () => {
    const root = ROOT();
    writeFileSync(join(root, "_generated.ts"), "export const fake = query({});");
    writeFileSync(join(root, "internal.ts"), "export const helper = internalMutation({});");
    const paths = collectConvexFunctions(root);
    expect(paths.has("_generated:fake")).toBe(false);
    expect(paths.has("internal:helper")).toBe(false);
    cleanup(root);
  });
});

describe("collectBffPaths", () => {
  it("collects string-literal paths and ignores test files", () => {
    const root = ROOT();
    writeFileSync(join(root, "svc.ts"), apiCall("companies:list"));
    writeFileSync(join(root, "svc.test.ts"), apiCall("companies:nonexistent"));
    const paths = collectBffPaths(root);
    expect(paths.has("companies:list")).toBe(true);
    expect(paths.has("companies:nonexistent")).toBe(false);
    cleanup(root);
  });
});

describe("verifyConvexCallPaths", () => {
  it("passes when every BFF path resolves", () => {
    const root = ROOT();
    writeFileSync(join(root, "a.ts"), 'export const foo = query({ handler: async () => 1 });');
    writeFileSync(join(root, "svc.ts"), apiCall("a:foo"));
    expect(verifyConvexCallPaths(root, root)).toEqual([]);
    cleanup(root);
  });

  it("fails on an unknown function path", () => {
    const root = ROOT();
    writeFileSync(join(root, "a.ts"), 'export const foo = query({ handler: async () => 1 });');
    writeFileSync(join(root, "svc.ts"), apiCall("a:bar"));
    const violations = verifyConvexCallPaths(root, root);
    expect(violations).toEqual([{ path: "a:bar", file: join(root, "svc.ts"), reason: "unresolved" }]);
    cleanup(root);
  });

  it("fails when a function moved modules and the barrel re-export was forgotten (incident 2026-08-10)", () => {
    const root = ROOT();
    writeFileSync(join(root, "industry_resume_impact.ts"), 'export const getIndustryResumeImpactByCompanyKey = query({ handler: async () => 1 });');
    writeFileSync(join(root, "companies.ts"), 'export { somethingElse } from "./industry_resume_impact.js";');
    writeFileSync(join(root, "svc.ts"), apiCall("companies:getIndustryResumeImpactByCompanyKey"));
    const violations = verifyConvexCallPaths(root, root);
    expect(violations).toEqual([
      { path: "companies:getIndustryResumeImpactByCompanyKey", file: join(root, "svc.ts"), reason: "unresolved" },
    ]);
    cleanup(root);
  });

  it("passes once the missing re-export is restored", () => {
    const root = ROOT();
    writeFileSync(join(root, "industry_resume_impact.ts"), 'export const getIndustryResumeImpactByCompanyKey = query({ handler: async () => 1 });');
    writeFileSync(join(root, "companies.ts"), 'export {\n  getIndustryResumeImpactByCompanyKey,\n} from "./industry_resume_impact.js";');
    writeFileSync(join(root, "svc.ts"), apiCall("companies:getIndustryResumeImpactByCompanyKey"));
    expect(verifyConvexCallPaths(root, root)).toEqual([]);
    cleanup(root);
  });

  it("fails on internal: paths from BFF code", () => {
    const root = ROOT();
    writeFileSync(join(root, "svc.ts"), apiCall("internal.ingest_agent:processNewResumes"));
    const violations = verifyConvexCallPaths(root, root);
    expect(violations).toEqual([{ path: "internal.ingest_agent:processNewResumes", file: join(root, "svc.ts"), reason: "internal" }]);
    cleanup(root);
  });
});
