import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

/**
 * Shared fixtures for the MY/TH SEEK Talent Search service-engineer batch
 * (apps/web/e2e/seek-my-th-profile.spec.ts + this package's contract test).
 *
 * Both consumers load the REAL config/search-profiles YAMLs, so the e2e
 * expectations cannot drift from the shipped profile files: if a YAML
 * changes, the contract test fails first with a precise message, and the e2e
 * then follows the YAML automatically.
 *
 * Lives in @trends/shared (ESM) — a repo-root scripts/ copy is compiled as
 * CommonJS by Playwright's loader (no root "type":"module") and named
 * imports from it throw (LXC run 20260902T040134Z). Lazy by design: profile
 * files are parsed on first call, never at module import, so a YAML problem
 * surfaces as a test failure, not a load error.
 */

const PROFILE_IDS: Record<"my" | "th", string> = {
  my: "seek-malaysia-talent-search-service-engineer",
  th: "seek-thailand-talent-search-service-engineer",
};

const PROFILE_MARKETS: Record<"my" | "th", "MY" | "TH"> = {
  my: "MY",
  th: "TH",
};

/** Landing quick-start ranks: MY card precedes TH. */
export const SEEK_MY_TH_QUICK_START_RANKS = { my: 5, th: 6 } as const;

export type SeekMyThApiProfile = {
  id: string;
  name: string;
  status: "active" | "paused" | "archived";
  location: string;
  keywords: string[];
  sources: Array<{
    type: string;
    mode?: string;
    enabled: boolean;
    priority?: number;
    jobUrl?: string;
    collectLimit?: number;
    maxPages?: number;
  }>;
  quickStart?: {
    enabled: boolean;
    rank?: number;
    label?: string;
    description?: string;
  };
};

function fail(which: "my" | "th", message: string): never {
  throw new Error(`seek ${PROFILE_IDS[which]} fixture: ${message}`);
}

export function seekMyThQuickStartRank(which: "my" | "th", rank: unknown): number {
  const expected = SEEK_MY_TH_QUICK_START_RANKS[which];
  if (!Number.isInteger(rank) || rank !== expected) {
    fail(which, `quickStart.rank is ${String(rank)}, expected ${expected}`);
  }
  return rank;
}

function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "config", "search-profiles"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(
    `seek fixture: no repo root found above ${start} (config/search-profiles missing)`,
  );
}

function repoRoot(): string {
  // packages/shared/src/ (vitest, typecheck) or packages/shared/dist/
  // (Playwright loading the built ESM) → walk up to the repo root.
  return findRepoRoot(resolve(dirname(fileURLToPath(import.meta.url))));
}

type SeekSourceYaml = {
  type?: string;
  mode?: string;
  enabled?: boolean;
  priority?: number;
  jobUrl?: string;
  collectLimit?: number;
  maxPages?: number;
};

type SeekProfileYaml = {
  id?: string;
  name?: string;
  status?: string;
  location?: string;
  keywords?: string[];
  sources?: SeekSourceYaml[];
  quickStart?: {
    enabled?: boolean;
    rank?: number;
    label?: string;
    description?: string;
  };
};

function loadProfileYaml(which: "my" | "th"): SeekProfileYaml {
  const file = join(repoRoot(), "config", "search-profiles", `${PROFILE_IDS[which]}.yaml`);
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(file, "utf8"));
  } catch (error) {
    return fail(which, `cannot parse ${file}: ${String(error)}`);
  }
  if (!parsed || typeof parsed !== "object") {
    return fail(which, `${file} is empty or not a YAML mapping`);
  }
  return parsed as SeekProfileYaml;
}

function parseJobUrl(which: "my" | "th", jobUrl: string): URL {
  try {
    return new URL(jobUrl);
  } catch {
    return fail(which, `sources[0].jobUrl is not a valid URL: ${jobUrl}`);
  }
}

const TALENTSEARCH_JOBURL_PARAMS = {
  searchQuery: "CNC",
  keywords: "CNC",
  pageNumber: "1",
  sortBy: "RELEVANCE",
  matchAll: "false",
  salaryType: "MONTHLY",
  minSalary: "0",
  salaryUnspecified: "true",
} as const;

export function seekMyThTalentsearchJobUrl(which: "my" | "th", jobUrl: unknown): URL {
  if (typeof jobUrl !== "string" || !jobUrl.trim()) {
    fail(which, "sources[0].jobUrl missing");
  }
  const url = parseJobUrl(which, jobUrl);
  const market = PROFILE_MARKETS[which];
  if (url.protocol !== "https:") {
    fail(which, `jobUrl must use HTTPS, got ${url.protocol}`);
  }
  if (url.host !== "hk.employer.seek.com") {
    fail(which, `jobUrl host is ${url.host}, expected hk.employer.seek.com`);
  }
  if (url.pathname !== "/talentsearch") {
    fail(which, `jobUrl path is ${url.pathname}, expected /talentsearch`);
  }
  if (url.searchParams.get("market") !== market) {
    fail(which, `jobUrl market is ${url.searchParams.get("market")}, expected ${market}`);
  }
  for (const [key, expected] of Object.entries(TALENTSEARCH_JOBURL_PARAMS)) {
    const actual = url.searchParams.get(key);
    if (actual !== expected) {
      fail(which, `jobUrl ${key} is ${actual}, expected ${expected}`);
    }
  }
  return url;
}

export function seekMyThApiProfile(which: "my" | "th"): SeekMyThApiProfile {
  const yaml = loadProfileYaml(which);
  const expectedId = PROFILE_IDS[which];
  if (yaml.id !== expectedId) {
    fail(which, `id is ${String(yaml.id)}, expected ${expectedId}`);
  }
  if (yaml.status !== "active") {
    fail(which, `status is ${String(yaml.status)}, expected active`);
  }
  if (!Array.isArray(yaml.keywords) || yaml.keywords.length === 0) {
    fail(which, "keywords missing");
  }
  if (typeof yaml.name !== "string" || !yaml.name) {
    fail(which, "name missing");
  }
  if (typeof yaml.location !== "string" || !yaml.location) {
    fail(which, "location missing");
  }
  const source = yaml.sources?.[0];
  if (!source) {
    fail(which, "sources[0] missing");
  }
  if (source.type !== "seek") {
    fail(which, `sources[0].type is ${String(source.type)}, expected seek`);
  }
  if (source.enabled !== true) {
    fail(which, "sources[0].enabled must be true");
  }
  if (source.mode !== "talentsearch") {
    fail(which, `sources[0].mode is ${String(source.mode)}, expected talentsearch`);
  }
  const jobUrl = source.jobUrl;
  seekMyThTalentsearchJobUrl(which, jobUrl);
  if (!yaml.quickStart || yaml.quickStart.enabled !== true) {
    fail(which, "quickStart.enabled must be true");
  }
  const rank = seekMyThQuickStartRank(which, yaml.quickStart.rank);
  return {
    id: yaml.id,
    name: yaml.name,
    status: "active",
    location: yaml.location,
    keywords: yaml.keywords,
    sources: [
      {
        type: source.type,
        mode: source.mode,
        enabled: true,
        priority: source.priority,
        jobUrl,
        collectLimit: source.collectLimit,
        maxPages: source.maxPages,
      },
    ],
    quickStart: {
      enabled: true,
      rank,
      label: yaml.quickStart.label,
      description: yaml.quickStart.description,
    },
  };
}

export function seekMyThServiceProfileFixtures(): SeekMyThApiProfile[] {
  return [seekMyThApiProfile("my"), seekMyThApiProfile("th")];
}

function roleTitlesOf(profile: SeekMyThApiProfile): string {
  const jobUrl = profile.sources[0]?.jobUrl;
  if (!jobUrl) {
    throw new Error(`seek fixture: ${profile.id} has no jobUrl to derive roleTitles from`);
  }
  const roleTitles = new URL(jobUrl).searchParams.get("roleTitles");
  if (!roleTitles) {
    throw new Error(`seek fixture: ${profile.id} jobUrl has no roleTitles param`);
  }
  return roleTitles;
}

/** Comma-joined service role 5-stack parsed from the profile's jobUrl. */
export function seekServiceStackRoleTitles(which: "my" | "th"): string {
  return roleTitlesOf(seekMyThApiProfile(which));
}

/**
 * The URL the landing collect button opens for this profile, per the real
 * app chain (useIndustryKeywords maps the seek source to {type, jobUrl} only;
 * SearchHero → buildCollectionLaunchUrl preserves the exactUrl verbatim and
 * appends just tr_auto_sync=true). Asserting against this pins the whole
 * YAML→launch-URL contract, not a hand-copied expectation.
 */
export function expectedCollectLaunchUrl(profile: SeekMyThApiProfile): URL {
  const jobUrl = profile.sources[0]?.jobUrl;
  if (!jobUrl) {
    throw new Error(`seek fixture: ${profile.id} has no jobUrl`);
  }
  const url = new URL(jobUrl);
  // Mirrors removeTrendsParams + the tr_auto_sync set in buildSeekCollectUrl.
  for (const key of Array.from(url.searchParams.keys())) {
    if (key.startsWith("tr_")) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.set("tr_auto_sync", "true");
  return url;
}