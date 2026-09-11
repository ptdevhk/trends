#!/usr/bin/env -S bunx tsx

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { parse as parseYaml } from "yaml";

import { SEARCH_PROFILE_TEMPLATES } from "../../packages/shared/src/generated/search-profile-templates.js";
import { isLocationMatch } from "../../packages/shared/src/location-tree.js";

const PROFILE_IDS = {
  MY: "seek-malaysia-talent-search-service-engineer",
  TH: "seek-thailand-talent-search-service-engineer",
} as const;

const CANONICAL_FILES = {
  MY: "config/search-profiles/seek-malaysia-talent-search-service-engineer.yaml",
  TH: "config/search-profiles/seek-thailand-talent-search-service-engineer.yaml",
} as const;

const STALE_SHORT_FILES = [
  "config/search-profiles/seek-malaysia-service-engineer.yaml",
  "config/search-profiles/seek-thailand-service-engineer.yaml",
] as const;

const WORKSPACES = ["dev", "hr"] as const;
const MARKETS = ["MY", "TH"] as const;
const ROLE_STACK = [
  "Services Engineer",
  "Service Technician",
  "Service Manager",
  "Service Coordinator",
  "Service Supervisor",
] as const;

const QUALITY_FLOORS = {
  serviceEvidence: 0.8,
  cncMachineEvidence: 0.6,
  locationConsistency: 0.8,
} as const;

const TITLE_FAMILIES = [
  "service_engineer",
  "service_technician",
  "service_leadership",
  "maintenance_or_application",
  "other_service",
  "other",
] as const;

type Market = keyof typeof PROFILE_IDS;
type Workspace = typeof WORKSPACES[number];
type JsonRecord = Record<string, unknown>;
type TitleFamily = typeof TITLE_FAMILIES[number];

type Fixture = {
  profileResponses: Array<{ workspace: Workspace; profile: JsonRecord }>;
  qualityResponses: Record<Market, JsonRecord>;
};

type SourceProfile = {
  workspaceSlugs: string[];
  profile: JsonRecord;
};

type SourceContractReport = {
  ok: boolean;
  canonicalFiles: string[];
  generatedWorkspaces: string[];
  failures: string[];
};

type LiveProfileContractReport = {
  ok: boolean;
  checked: number;
  failures: string[];
};

type QualityReport = {
  market: Market;
  ok: boolean;
  total: number;
  sampled: number;
  serviceEvidenceCount: number;
  serviceEvidenceRate: number;
  cncMachineEvidenceCount: number;
  cncMachineEvidenceRate: number;
  locationConsistencyCount: number;
  locationConsistencyRate: number;
  titleFamilies: Record<TitleFamily, number>;
  failures: string[];
};

type Report = {
  ok: boolean;
  mode: "fixture" | "preview";
  sourceContract: SourceContractReport;
  liveProfileContract: LiveProfileContractReport;
  quality: QualityReport[];
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim())
    : [];
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function sourceFor(profile: JsonRecord): JsonRecord | undefined {
  return Array.isArray(profile.sources)
    ? profile.sources.find((source): source is JsonRecord => isRecord(source) && source.type === "seek")
    : undefined;
}

function objectAt(record: JsonRecord, key: string): JsonRecord {
  return isRecord(record[key]) ? record[key] : {};
}

function normalizedUrl(value: unknown): string {
  const url = new URL(stringValue(value));
  url.searchParams.sort();
  return url.toString();
}

function validateProfileShape(profile: JsonRecord, market: Market, prefix: string): string[] {
  const failures: string[] = [];
  const expectedId = PROFILE_IDS[market];
  const expectedLocation = market === "MY" ? "Malaysia" : "Thailand";
  const expectedRank = market === "MY" ? 5 : 6;
  const filters = objectAt(profile, "filters");
  const schedule = objectAt(profile, "schedule");
  const quickStart = objectAt(profile, "quickStart");
  const source = sourceFor(profile);

  const check = (condition: boolean, message: string) => {
    if (!condition) failures.push(`${prefix}: ${message}`);
  };

  check(profile.id === expectedId, `id must be ${expectedId}`);
  check(profile.location === expectedLocation, `location must be ${expectedLocation}`);
  check(stringArray(profile.keywords).join("|") === "CNC|Service Engineer", "keywords must be CNC + Service Engineer");
  check(filters.minRoleYears === 1, "filters.minRoleYears must be 1");
  check(filters.roleFilterType === "engineer", "filters.roleFilterType must be engineer");
  check(stringArray(filters.locations).join("|") === expectedLocation, `filters.locations must be ${expectedLocation}`);
  check(schedule.enabled === false, "schedule.enabled must be false");
  check(schedule.maxCandidates === 50, "schedule.maxCandidates must be 50");
  check(quickStart.enabled === true, "quickStart.enabled must be true");
  check(quickStart.rank === expectedRank, `quickStart.rank must be ${expectedRank}`);
  check(Boolean(source), "enabled SEEK source is required");

  if (source) {
    check(source.enabled === true, "SEEK source must be enabled");
    check(source.mode === "talentsearch", "SEEK source mode must be talentsearch");
    check(source.collectLimit === 50, "SEEK collectLimit must be 50");
    check(source.maxPages === 25, "SEEK maxPages must be 25");
    try {
      const url = new URL(stringValue(source.jobUrl));
      check(url.protocol === "https:", "source URL must use HTTPS");
      check(url.host === "hk.employer.seek.com", "source URL host must be hk.employer.seek.com");
      check(url.pathname === "/talentsearch", "source URL path must be /talentsearch");
      check(url.searchParams.get("market") === market, `source URL market must be ${market}`);
      check(url.searchParams.get("searchQuery") === "CNC", "source URL searchQuery must be CNC");
      check(url.searchParams.get("keywords") === "CNC", "source URL keywords must be CNC");
      check(url.searchParams.get("matchAll") === "false", "source URL matchAll must be false");
      check(url.searchParams.get("roleTitles")?.split(",").join("|") === ROLE_STACK.join("|"), "source URL roleTitles must use the canonical service 5-stack");
      check(!/sales/iu.test(url.searchParams.get("roleTitles") ?? ""), "source URL must not contain Sales titles");
    } catch {
      failures.push(`${prefix}: source URL must be a valid URL`);
    }
  }

  return failures;
}

function readSourceProfiles(repoRoot: string): Record<Market, SourceProfile> {
  return Object.fromEntries(MARKETS.map((market) => {
    const raw = parseYaml(readFileSync(resolve(repoRoot, CANONICAL_FILES[market]), "utf8"));
    if (!isRecord(raw)) {
      throw new Error(`${CANONICAL_FILES[market]} is not a YAML object`);
    }
    const workspaceValue = raw.workspaceSlug;
    const workspaceSlugs = Array.isArray(workspaceValue)
      ? stringArray(workspaceValue)
      : [stringValue(workspaceValue)].filter(Boolean);
    const { workspaceSlug: _workspaceSlug, seedLastRunOffsetMs: _seedOffset, ...profile } = raw;
    return [market, { workspaceSlugs, profile }];
  })) as Record<Market, SourceProfile>;
}

function validateSourceContract(repoRoot: string, sourceProfiles: Record<Market, SourceProfile>): SourceContractReport {
  const failures: string[] = [];
  for (const market of MARKETS) {
    const source = sourceProfiles[market];
    failures.push(...validateProfileShape(source.profile, market, CANONICAL_FILES[market]));
    if ([...source.workspaceSlugs].sort().join("|") !== "dev|hr") {
      failures.push(`${CANONICAL_FILES[market]}: workspaceSlug must fan out to dev and hr`);
    }
  }

  for (const stalePath of STALE_SHORT_FILES) {
    try {
      readFileSync(resolve(repoRoot, stalePath));
      failures.push(`${stalePath}: stale short-path YAML must not exist`);
    } catch (error) {
      const code = isRecord(error) ? error.code : undefined;
      if (code !== "ENOENT") throw error;
    }
  }

  const generatedWorkspaces = Array.from(new Set(
    SEARCH_PROFILE_TEMPLATES
      .filter((template) => Object.values(PROFILE_IDS).includes(template.profile.id as typeof PROFILE_IDS[Market]))
      .map((template) => template.workspaceSlug ?? "dev"),
  )).sort();

  for (const workspace of WORKSPACES) {
    for (const market of MARKETS) {
      const generated = SEARCH_PROFILE_TEMPLATES.find((template) => (
        (template.workspaceSlug ?? "dev") === workspace && template.profile.id === PROFILE_IDS[market]
      ));
      if (!generated) {
        failures.push(`${workspace}/${PROFILE_IDS[market]}: missing from generated templates`);
        continue;
      }
      failures.push(...validateProfileShape(generated.profile as unknown as JsonRecord, market, `${workspace}/${PROFILE_IDS[market]} generated`));
      const canonicalSource = sourceFor(sourceProfiles[market].profile);
      const generatedSource = sourceFor(generated.profile as unknown as JsonRecord);
      if (!canonicalSource || !generatedSource || normalizedUrl(canonicalSource.jobUrl) !== normalizedUrl(generatedSource.jobUrl)) {
        failures.push(`${workspace}/${PROFILE_IDS[market]} generated: source URL differs from canonical YAML`);
      }
    }
  }

  return {
    ok: failures.length === 0,
    canonicalFiles: MARKETS.map((market) => CANONICAL_FILES[market]),
    generatedWorkspaces,
    failures,
  };
}

function validateLiveProfiles(
  responses: Array<{ workspace: Workspace; profile: JsonRecord }>,
  sourceProfiles: Record<Market, SourceProfile>,
): LiveProfileContractReport {
  const failures: string[] = [];
  let checked = 0;
  for (const workspace of WORKSPACES) {
    for (const market of MARKETS) {
      const response = responses.find((item) => item.workspace === workspace && item.profile.id === PROFILE_IDS[market]);
      if (!response) {
        failures.push(`${workspace}/${PROFILE_IDS[market]}: profile missing`);
        continue;
      }
      checked += 1;
      failures.push(...validateProfileShape(response.profile, market, `${workspace}/${PROFILE_IDS[market]}`));
      const canonicalSource = sourceFor(sourceProfiles[market].profile);
      const liveSource = sourceFor(response.profile);
      if (!canonicalSource || !liveSource || normalizedUrl(canonicalSource.jobUrl) !== normalizedUrl(liveSource.jobUrl)) {
        failures.push(`${workspace}/${PROFILE_IDS[market]}: source URL differs from canonical YAML`);
      }
    }
  }
  return { ok: failures.length === 0, checked, failures };
}

const SERVICE_EVIDENCE = /\bservice(?:s|d|ing)?\b|\btechnician\b|\bmaintenance\b|after[ -]?sales|售後|售后|维修|維修|บริการ|ซ่อมบำรุง/iu;
const CNC_MACHINE_EVIDENCE = /\bcnc\b|machin(?:e|ing)|lathe|milling|fanuc|mazak|haas|makino|okuma|mitsubishi|siemens|เครื่องจักร|กลึง|กัด/iu;

function resumeEvidenceText(row: JsonRecord): string {
  const workHistory = Array.isArray(row.workHistory) ? row.workHistory : [];
  const snippet = isRecord(row.resumeSnippet) ? row.resumeSnippet.text : row.resumeSnippet;
  const skills = Array.isArray(row.skills)
    ? row.skills.map((skill) => isRecord(skill) ? skill.name : skill)
    : [];
  return [
    row.jobIntention,
    row.selfIntro,
    snippet,
    ...skills,
    ...workHistory.flatMap((entry) => isRecord(entry) ? [entry.jobTitle, entry.description, entry.raw] : []),
  ].filter((value): value is string => typeof value === "string").join(" ");
}

function titleText(row: JsonRecord): string {
  return (Array.isArray(row.workHistory) ? row.workHistory : [])
    .flatMap((entry) => isRecord(entry) ? [entry.jobTitle] : [])
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function titleFamily(row: JsonRecord): TitleFamily {
  const title = titleText(row);
  if (/service(?:s)? engineer|field service engineer|วิศวกรบริการ|售後工程師|售后工程师/iu.test(title)) return "service_engineer";
  if (/service technician|ช่างบริการ|维修技师|維修技師/iu.test(title)) return "service_technician";
  if (/service (?:manager|coordinator|supervisor)/iu.test(title)) return "service_leadership";
  if (/maintenance|application engineer/iu.test(title)) return "maintenance_or_application";
  if (SERVICE_EVIDENCE.test(title)) return "other_service";
  return "other";
}

function locationIsConsistent(row: JsonRecord, market: Market): boolean {
  const hierarchy = objectAt(row, "locationHierarchy");
  const ingestData = objectAt(row, "ingestData");
  const evidence = [
    row.location,
    hierarchy.country,
    hierarchy.province,
    hierarchy.city,
    ingestData.market,
  ].filter((value): value is string => typeof value === "string").join(" ");
  return isLocationMatch(evidence, market === "MY" ? "Malaysia" : "Thailand");
}

function qualityReport(market: Market, response: JsonRecord): QualityReport {
  const summary = objectAt(response, "summary");
  const rows = Array.isArray(response.data) ? response.data.filter(isRecord) : [];
  const total = numberValue(summary.total) ?? 0;
  const sampled = rows.length;
  const serviceEvidenceCount = rows.filter((row) => SERVICE_EVIDENCE.test(resumeEvidenceText(row))).length;
  const cncMachineEvidenceCount = rows.filter((row) => CNC_MACHINE_EVIDENCE.test(resumeEvidenceText(row))).length;
  const locationConsistencyCount = rows.filter((row) => locationIsConsistent(row, market)).length;
  const serviceEvidenceRate = sampled > 0 ? serviceEvidenceCount / sampled : 0;
  const cncMachineEvidenceRate = sampled > 0 ? cncMachineEvidenceCount / sampled : 0;
  const locationConsistencyRate = sampled > 0 ? locationConsistencyCount / sampled : 0;
  const titleFamilies = Object.fromEntries(TITLE_FAMILIES.map((family) => [family, 0])) as Record<TitleFamily, number>;
  for (const row of rows) titleFamilies[titleFamily(row)] += 1;

  const failures: string[] = [];
  if (total < 1) failures.push("total results must be at least 1");
  if (sampled < 1) failures.push("sampled results must be at least 1");
  if (serviceEvidenceRate < QUALITY_FLOORS.serviceEvidence) {
    failures.push(`service evidence ${percentage(serviceEvidenceRate)} is below ${percentage(QUALITY_FLOORS.serviceEvidence)}`);
  }
  if (cncMachineEvidenceRate < QUALITY_FLOORS.cncMachineEvidence) {
    failures.push(`CNC/machine evidence ${percentage(cncMachineEvidenceRate)} is below ${percentage(QUALITY_FLOORS.cncMachineEvidence)}`);
  }
  if (locationConsistencyRate < QUALITY_FLOORS.locationConsistency) {
    failures.push(`location consistency ${percentage(locationConsistencyRate)} is below ${percentage(QUALITY_FLOORS.locationConsistency)}`);
  }

  return {
    market,
    ok: failures.length === 0,
    total,
    sampled,
    serviceEvidenceCount,
    serviceEvidenceRate,
    cncMachineEvidenceCount,
    cncMachineEvidenceRate,
    locationConsistencyCount,
    locationConsistencyRate,
    titleFamilies,
    failures,
  };
}

function parseEnvFile(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/u);
    if (!match) continue;
    let value = match[2] ?? "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[match[1]!] = value;
  }
  return result;
}

function cookieHeader(headers: Headers): string {
  const withSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const values = typeof withSetCookie.getSetCookie === "function"
    ? withSetCookie.getSetCookie()
    : [headers.get("set-cookie")].filter((value): value is string => Boolean(value));
  const cookie = values.map((value) => value.split(";", 1)[0] ?? "").filter(Boolean).join("; ");
  if (!cookie) throw new Error("preview login did not return session cookies");
  return cookie;
}

async function loadPreviewResponses(baseUrl: string, envFile: string): Promise<Fixture> {
  const env = parseEnvFile(envFile);
  const password = env.AUTH_HR_DEMO_PASSWORD || process.env.AUTH_HR_DEMO_PASSWORD;
  if (!password) throw new Error("AUTH_HR_DEMO_PASSWORD is missing from the selected env file");
  const username = env.BOOTSTRAP_HR_DEMO_USER || "hr-demo";
  const normalizedBase = baseUrl.replace(/\/+$/u, "");
  const login = await fetch(`${normalizedBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-workspace-slug": "hr" },
    body: JSON.stringify({ username, password }),
  });
  if (!login.ok) throw new Error(`preview login failed with HTTP ${login.status}`);
  const loginBody: unknown = await login.json();
  const csrfToken = isRecord(loginBody) ? stringValue(loginBody.csrfToken) : "";
  if (!csrfToken) throw new Error("preview login did not return a CSRF token");
  const cookie = cookieHeader(login.headers);

  async function getJson(path: string, workspace: Workspace): Promise<JsonRecord> {
    const response = await fetch(`${normalizedBase}${path}`, {
      headers: {
        accept: "application/json",
        cookie,
        "x-csrf-token": csrfToken,
        "x-workspace-slug": workspace,
      },
    });
    if (!response.ok) throw new Error(`${path} (${workspace}) failed with HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (!isRecord(body)) throw new Error(`${path} (${workspace}) returned a non-object response`);
    return body;
  }

  const profileResponses: Fixture["profileResponses"] = [];
  for (const workspace of WORKSPACES) {
    // The list route is the public profile contract and also runs the existing
    // safe additive seed migration before detail reads.
    await getJson("/api/search-profiles", workspace);
    for (const market of MARKETS) {
      const response = await getJson(`/api/search-profiles/${PROFILE_IDS[market]}`, workspace);
      if (!isRecord(response.profile)) throw new Error(`${workspace}/${PROFILE_IDS[market]} returned no profile`);
      profileResponses.push({ workspace, profile: response.profile });
    }
  }

  const qualityResponses = {} as Record<Market, JsonRecord>;
  for (const market of MARKETS) {
    const location = market === "MY" ? "Malaysia" : "Thailand";
    const query = new URLSearchParams({
      source: "convex",
      q: '"CNC" OR "Service Engineer"',
      locations: location,
      status: "all",
      minRoleYears: "1",
      roleFilterType: "engineer",
      limit: "50",
    });
    qualityResponses[market] = await getJson(`/api/resumes?${query.toString()}`, "hr");
  }

  return { profileResponses, qualityResponses };
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const repoRoot = resolve(argumentValue("--repo-root") ?? process.cwd());
  const fixturePath = argumentValue("--fixture");
  const preview = process.argv.includes("--preview");
  if (!fixturePath && !preview) {
    throw new Error("choose --fixture <path> or --preview --env-file <path>");
  }
  if (fixturePath && preview) throw new Error("--fixture and --preview are mutually exclusive");

  const sourceProfiles = readSourceProfiles(repoRoot);
  const sourceContract = validateSourceContract(repoRoot, sourceProfiles);
  let input: Fixture;
  let mode: Report["mode"];
  if (fixturePath) {
    const parsed: unknown = JSON.parse(readFileSync(resolve(fixturePath), "utf8"));
    if (!isRecord(parsed) || !Array.isArray(parsed.profileResponses) || !isRecord(parsed.qualityResponses)) {
      throw new Error("fixture must contain profileResponses and qualityResponses");
    }
    input = parsed as unknown as Fixture;
    mode = "fixture";
  } else {
    const envFile = argumentValue("--env-file");
    if (!envFile) throw new Error("--preview requires --env-file <path>");
    input = await loadPreviewResponses(argumentValue("--base-url") ?? "https://preview.pt-mes.com", resolve(envFile));
    mode = "preview";
  }

  const liveProfileContract = validateLiveProfiles(input.profileResponses, sourceProfiles);
  const quality = MARKETS.map((market) => qualityReport(market, input.qualityResponses[market] ?? {}));
  const report: Report = {
    ok: sourceContract.ok && liveProfileContract.ok && quality.every((item) => item.ok),
    mode,
    sourceContract,
    liveProfileContract,
    quality,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 2;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`MY/TH search-quality harness error: ${message}\n`);
  process.exitCode = 1;
});
