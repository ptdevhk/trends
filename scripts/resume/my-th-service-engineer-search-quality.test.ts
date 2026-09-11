import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const scriptPath = join(repoRoot, "scripts", "resume", "my-th-service-engineer-search-quality.ts");
const fixturePath = join(
  repoRoot,
  "scripts",
  "resume",
  "__fixtures__",
  "my-th-service-engineer-search-quality.json",
);

function runFixture(path = fixturePath) {
  return spawnSync(
    "bunx",
    ["tsx", scriptPath, "--fixture", path, "--repo-root", repoRoot, "--format", "json"],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

describe("MY/TH Service Engineer search-quality harness", () => {
  it("passes a fixture whose source, generated, live-profile, and aggregate quality contracts meet the floors", () => {
    const result = runFixture();

    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      sourceContract: { ok: boolean; canonicalFiles: string[]; generatedWorkspaces: string[] };
      liveProfileContract: { ok: boolean; checked: number };
      quality: Array<{
        market: string;
        total: number;
        sampled: number;
        serviceEvidenceRate: number;
        cncMachineEvidenceRate: number;
        locationConsistencyRate: number;
        titleFamilies: Record<string, number>;
      }>;
    };

    expect(report.ok).toBe(true);
    expect(report.sourceContract).toMatchObject({
      ok: true,
      canonicalFiles: [
        "config/search-profiles/seek-malaysia-talent-search-service-engineer.yaml",
        "config/search-profiles/seek-thailand-talent-search-service-engineer.yaml",
      ],
      generatedWorkspaces: ["dev", "hr"],
    });
    expect(report.liveProfileContract).toEqual({ ok: true, checked: 4, failures: [] });
    expect(report.quality).toEqual([
      {
        market: "MY",
        ok: true,
        total: 5,
        sampled: 5,
        serviceEvidenceCount: 4,
        serviceEvidenceRate: 0.8,
        cncMachineEvidenceCount: 4,
        cncMachineEvidenceRate: 0.8,
        locationConsistencyCount: 4,
        locationConsistencyRate: 0.8,
        titleFamilies: {
          service_engineer: 1,
          service_technician: 1,
          service_leadership: 1,
          maintenance_or_application: 1,
          other_service: 0,
          other: 1,
        },
        failures: [],
      },
      {
        market: "TH",
        ok: true,
        total: 5,
        sampled: 5,
        serviceEvidenceCount: 4,
        serviceEvidenceRate: 0.8,
        cncMachineEvidenceCount: 4,
        cncMachineEvidenceRate: 0.8,
        locationConsistencyCount: 4,
        locationConsistencyRate: 0.8,
        titleFamilies: {
          service_engineer: 2,
          service_technician: 1,
          service_leadership: 1,
          maintenance_or_application: 0,
          other_service: 0,
          other: 1,
        },
        failures: [],
      },
    ]);
    expect(result.stdout).not.toMatch(/profileUrl|cookie|password|csrf|candidate/i);
  });

  it("fails with aggregate-only diagnostics when a quality floor is missed", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      qualityResponses: { TH: { data: unknown[] } };
    };
    fixture.qualityResponses.TH.data = fixture.qualityResponses.TH.data.slice(0, 3).map(() => ({
      location: "Unknown",
      workHistory: [{ jobTitle: "General Engineer", description: "Factory utilities" }],
    }));
    const dir = mkdtempSync(join(tmpdir(), "trends-my-th-quality-"));
    const failingFixture = join(dir, "fixture.json");
    writeFileSync(failingFixture, JSON.stringify(fixture), "utf8");

    const result = runFixture(failingFixture);

    expect(result.status).toBe(2);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      quality: Array<{ market: string; failures: string[] }>;
    };
    expect(report.ok).toBe(false);
    expect(report.quality.find((item) => item.market === "TH")?.failures).toEqual([
      "service evidence 0.0% is below 80.0%",
      "CNC/machine evidence 0.0% is below 60.0%",
      "location consistency 0.0% is below 80.0%",
    ]);
    expect(result.stdout).not.toContain("General Engineer");
    expect(result.stdout).not.toContain("Factory utilities");
  });

  it("fails when a live profile drifts from the canonical source URL contract", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      profileResponses: Array<{ workspace: string; profile: { sources: Array<{ jobUrl: string }> } }>;
    };
    fixture.profileResponses[0]!.profile.sources[0]!.jobUrl = fixture.profileResponses[0]!.profile.sources[0]!.jobUrl
      .replace("market=MY", "market=TH");
    const dir = mkdtempSync(join(tmpdir(), "trends-my-th-contract-"));
    const failingFixture = join(dir, "fixture.json");
    writeFileSync(failingFixture, JSON.stringify(fixture), "utf8");

    const result = runFixture(failingFixture);

    expect(result.status).toBe(2);
    const report = JSON.parse(result.stdout) as {
      liveProfileContract: { failures: string[] };
    };
    expect(report.liveProfileContract.failures).toEqual([
      "hr/seek-malaysia-talent-search-service-engineer: source URL market must be MY",
      "hr/seek-malaysia-talent-search-service-engineer: source URL differs from canonical YAML",
    ]);
  });

  it("keeps template regeneration byte-stable and detects generated drift", () => {
    const generatedPath = join(repoRoot, "packages", "shared", "src", "generated", "search-profile-templates.ts");
    const before = readFileSync(generatedPath, "utf8");

    execFileSync("bunx", ["tsx", "scripts/resume/sync-search-profile-templates.ts"], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    const afterFirst = readFileSync(generatedPath, "utf8");
    execFileSync("bunx", ["tsx", "scripts/resume/sync-search-profile-templates.ts"], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    const afterSecond = readFileSync(generatedPath, "utf8");

    expect(afterFirst).toBe(before);
    expect(afterSecond).toBe(afterFirst);
    const check = spawnSync("bunx", ["tsx", "scripts/resume/sync-search-profile-templates.ts", "--check"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain("Search profile template artifact is up to date");
  });
});
