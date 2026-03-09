import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JobDescriptionService } from "./job-description-service.js";

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "job-description-service-"));
  fs.mkdirSync(path.join(root, "config", "job-descriptions"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "config", "job-descriptions", "lathe-sales.md"),
    `---
id: jd-lathe-sales
title: 车床销售工程师
status: active
location: 东莞
auto_match:
  keywords: [车床, 销售]
  locations: [广东]
  priority: 60
  suggested_filters:
    minExperience: 1
---
# 车床销售工程师
`,
    "utf8",
  );
  return root;
}

function cleanupFixtureRoot(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

describe("JobDescriptionService keyword-only auto match", () => {
  const roots: string[] = [];

  afterEach(() => {
    while (roots.length > 0) {
      const root = roots.pop();
      if (root) {
        cleanupFixtureRoot(root);
      }
    }
  });

  it("strips legacy auto_match fields and keeps keywords only", () => {
    const root = createFixtureRoot();
    roots.push(root);

    const service = new JobDescriptionService(root);
    const jd = service.loadFile("lathe-sales");

    expect(jd.autoMatch).toEqual({
      keywords: ["车床", "销售"],
    });
    expect(jd.location).toBe("东莞");
    expect(jd.suggestedFilters).toEqual({
      minExperience: 1,
    });
  });

  it("matches JDs from keywords only", () => {
    const root = createFixtureRoot();
    roots.push(root);

    const service = new JobDescriptionService(root);
    const match = service.findMatch(["车床", "销售"]);

    expect(match.matched?.id).toBe("jd-lathe-sales");
    expect(match.confidence).toBe(1);
    expect(match.matchedKeywords).toEqual(["车床", "销售"]);
    expect(match.suggestedFilters).toEqual({ minExperience: 1 });
  });
});
