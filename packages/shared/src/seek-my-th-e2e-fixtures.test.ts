import { describe, expect, it } from "vitest";

import {
  expectedCollectLaunchUrl,
  seekMyThApiProfile,
  seekMyThServiceProfileFixtures,
  seekServiceStackRoleTitles,
} from "./seek-my-th-e2e-fixtures";

/**
 * Contract test: the MY/TH SEEK Talent Search service-engineer profile YAMLs
 * must keep the exact shape the landing quick-start flow (and its e2e spec)
 * depends on. The Playwright spec consumes the same fixtures, so this test is
 * the first line of defense: any YAML change lands here with a precise diff
 * before it can silently diverge from the e2e expectations.
 */

const EXPECTED_SERVICE_STACK = [
  "Services Engineer",
  "Service Technician",
  "Service Manager",
  "Service Coordinator",
  "Service Supervisor",
];

describe("seek MY/TH service-engineer profile contract", () => {
  it("loads both profiles from the real YAML files", () => {
    const profiles = seekMyThServiceProfileFixtures();
    expect(profiles.map((profile) => profile.id)).toEqual([
      "seek-malaysia-talent-search-service-engineer",
      "seek-thailand-talent-search-service-engineer",
    ]);
  });

  it("pins MY rank 5 and TH rank 6 active quick starts", () => {
    const my = seekMyThApiProfile("my");
    const th = seekMyThApiProfile("th");
    expect(my.status).toBe("active");
    expect(th.status).toBe("active");
    expect(my.quickStart?.enabled).toBe(true);
    expect(th.quickStart?.enabled).toBe(true);
    expect(my.quickStart?.rank).toBe(5);
    expect(th.quickStart?.rank).toBe(6);
  });

  it("pins the service role 5-stack for both markets", () => {
    for (const which of ["my", "th"] as const) {
      expect(seekServiceStackRoleTitles(which).split(",")).toEqual(EXPECTED_SERVICE_STACK);
    }
  });

  it("pins the talentsearch jobUrl contract per market", () => {
    const cases = [
      { profile: seekMyThApiProfile("my"), market: "MY" },
      { profile: seekMyThApiProfile("th"), market: "TH" },
    ];
    for (const { profile, market } of cases) {
      const url = new URL(profile.sources[0]?.jobUrl ?? "");
      expect(url.host).toBe("hk.employer.seek.com");
      expect(url.pathname).toBe("/talentsearch");
      expect(url.searchParams.get("market")).toBe(market);
      expect(url.searchParams.get("searchQuery")).toBe("CNC");
      expect(url.searchParams.get("keywords")).toBe("CNC");
      expect(url.searchParams.get("pageNumber")).toBe("1");
      expect(url.searchParams.get("sortBy")).toBe("RELEVANCE");
      expect(url.searchParams.get("matchAll")).toBe("false");
      expect(url.searchParams.get("salaryType")).toBe("MONTHLY");
      expect(url.searchParams.get("minSalary")).toBe("0");
      expect(url.searchParams.get("salaryUnspecified")).toBe("true");
    }
  });

  it("pins worker-side collect limits and the landing launch tr_* contract", () => {
    for (const profile of seekMyThServiceProfileFixtures()) {
      const seek = profile.sources[0];
      expect(seek?.collectLimit).toBe(50);
      expect(seek?.maxPages).toBe(25);

      const launch = expectedCollectLaunchUrl(profile);
      expect(launch.searchParams.get("tr_auto_sync")).toBe("true");
      // useIndustryKeywords maps the seek source to { type, jobUrl } only, so
      // source-level collectLimit/maxPages never reach the landing quick-start
      // launch URL — only tr_auto_sync survives the real builder.
      const trKeys = Array.from(launch.searchParams.keys()).filter((key) => key.startsWith("tr_"));
      expect(trKeys).toEqual(["tr_auto_sync"]);
    }
  });

  it("pins labels, locations and keywords", () => {
    const my = seekMyThApiProfile("my");
    const th = seekMyThApiProfile("th");
    expect(my.location).toBe("Malaysia");
    expect(th.location).toBe("Thailand");
    expect(my.quickStart?.label).toContain("Malaysia");
    expect(th.quickStart?.label).toContain("Thailand");
    expect(my.keywords).toEqual(["CNC", "Service Engineer"]);
    expect(th.keywords).toEqual(["CNC", "Service Engineer"]);
  });
});