#!/usr/bin/env npx tsx
/**
 * Run the web-research steward (R4) against an explicit target list.
 *
 * Modes:
 *   - `--fixture <json>`   offline mode: searches/scrapes served from the
 *     fixture file (forces the feature enabled with placeholder keys, so no
 *     provider keys or network calls are needed).
 *   - `--apply`            write proposal/evidence/state via Convex
 *     mutations (requires CONVEX_WRITE_SECRET env). Without it, writes are
 *     recorded as plannedWrites and dumped to output/industry-data/.
 *
 * Targets come from repeatable `--target "key:Name1|Name2"` flags and/or a
 * `--targets-file` JSON array of {companyKey, names}.
 *
 * Usage:
 *   npx tsx scripts/industry-data/web-steward-run.ts --target futai:富泰精机
 *   npx tsx scripts/industry-data/web-steward-run.ts --target futai:富泰精机 \
 *     --fixture scripts/industry-data/web-steward.fixture.json --apply
 *   npx tsx scripts/industry-data/web-steward-run.ts \
 *     --targets-file targets.json [--convex-url <url>] [--apply]
 */
import { parseArgs } from "node:util";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { loadWebResearchConfig } from "../../apps/api/src/services/web-research/config.js";
import { createTavilySearch } from "../../apps/api/src/services/web-research/tavily-client.js";
import {
  createSafeFirecrawlScrape,
  type SafeFirecrawlScrape,
} from "../../apps/api/src/services/web-research/firecrawl-client.js";
import {
  runWebResearch,
  type ResearchTarget,
  type TargetResearchResult,
  type WebResearchDeps,
  type ProposalWriteInput,
  type EvidenceSourceWriteInput,
  type ResearchStateWriteInput,
} from "../../apps/api/src/services/web-research/steward-service.js";
import type { TavilySearchResponse } from "../../apps/api/src/services/web-research/tavily-client.js";
import type { FirecrawlScrapeResult } from "../../apps/api/src/services/web-research/firecrawl-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebResearchFixture = {
  /** Exact query string -> Tavily-like response. */
  searches: Record<string, TavilySearchResponse>;
  /** Exact URL -> scrape result or error envelope. */
  scrapes: Record<string, FirecrawlScrapeResult | { error: string }>;
  /** Optional credit budget override (defaults to env/config). */
  budget?: number;
};

export type PlannedWrite = {
  op: "upsertProposal" | "upsertEvidenceSource" | "setResearchState";
  input: ProposalWriteInput | EvidenceSourceWriteInput | ResearchStateWriteInput;
};

export type WebResearchCliOptions = {
  targets: ResearchTarget[];
  apply: boolean;
  convexUrl: string;
  fixture?: WebResearchFixture;
  env?: Record<string, string | undefined>;
  logDir?: string;
  now?: () => number;
};

export type WebResearchCliResult = {
  results: TargetResearchResult[];
  plannedWrites: PlannedWrite[];
  logPath?: string;
};

// ---------------------------------------------------------------------------
// Target parsing
// ---------------------------------------------------------------------------

export function parseTargetSpec(spec: string): ResearchTarget {
  const colon = spec.indexOf(":");
  if (colon <= 0) {
    throw new Error(`Invalid --target "${spec}" (expected "key:Name1|Name2")`);
  }
  const companyKey = spec.slice(0, colon).trim();
  const names = spec
    .slice(colon + 1)
    .split("|")
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  if (!companyKey || names.length === 0) {
    throw new Error(`Invalid --target "${spec}" (expected "key:Name1|Name2")`);
  }
  return { companyKey, names };
}

export function loadTargetsFile(path: string): ResearchTarget[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (error) {
    throw new Error(`Cannot read targets file ${path}: ${(error as Error).message}`);
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Targets file ${path} must contain a JSON array`);
  }
  return parsed.map((entry, index) => {
    const record = entry as { companyKey?: unknown; names?: unknown };
    if (
      typeof record.companyKey !== "string" ||
      !Array.isArray(record.names) ||
      record.names.some((n) => typeof n !== "string") ||
      record.names.length === 0
    ) {
      throw new Error(`Targets file ${path} entry ${index} must have companyKey + non-empty names`);
    }
    return { companyKey: record.companyKey, names: record.names as string[] };
  });
}

// ---------------------------------------------------------------------------
// Convex plumbing (local copy — do not import from promote-curated-my-proposals)
// ---------------------------------------------------------------------------

function getWriteSecret(): string {
  const writeSecret = process.env.CONVEX_WRITE_SECRET;
  if (!writeSecret) {
    throw new Error("CONVEX_WRITE_SECRET env var is required");
  }
  return writeSecret;
}

async function convexRun<T>(
  convexUrl: string,
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const writeSecret = getWriteSecret();
  const fullArgs = { ...args, writeSecret };
  const argsJson = JSON.stringify(fullArgs);

  const tmpDir = mkdtempSync(join(tmpdir(), "convex-run-"));
  const tmpFile = join(tmpDir, "args.json");
  writeFileSync(tmpFile, argsJson, { mode: 0o600 });

  const urlFlag = convexUrl ? ` --url "${convexUrl}"` : "";
  const cmd = `npx convex run ${functionName} "$(cat '${tmpFile}')"${urlFlag} 2>&1`;

  let output: string;
  try {
    output = execSync(cmd, {
      cwd: `${process.cwd()}/packages/convex`,
      encoding: "utf-8",
      timeout: 120000,
      maxBuffer: 100 * 1024 * 1024,
      env: { ...process.env },
      shell: "/bin/bash",
    });
  } catch (err) {
    const errMsg = (err as Error).message.slice(0, 300);
    throw new Error(`Convex ${functionName} command failed: ${errMsg}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  const lines = output.trim().split("\n");
  let jsonStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      jsonStart = i;
      break;
    }
  }
  if (jsonStart === -1) {
    throw new Error(`Could not find JSON in Convex output: ${output.slice(-200)}`);
  }
  return JSON.parse(lines.slice(jsonStart).join("\n")) as T;
}

// ---------------------------------------------------------------------------
// Deps construction
// ---------------------------------------------------------------------------

function buildCliDeps(options: WebResearchCliOptions): {
  deps: WebResearchDeps;
  plannedWrites: PlannedWrite[];
} {
  const { fixture, convexUrl, apply } = options;
  const env = options.env ?? process.env;
  const now = options.now ?? (() => Date.now());

  let config = loadWebResearchConfig(env);
  let tavilySearch: WebResearchDeps["tavilySearch"];
  let firecrawlScrape: SafeFirecrawlScrape;

  if (fixture) {
    config = {
      ...config,
      enabled: true,
      tavilyApiKey: "fixture-key",
      firecrawlApiKey: "fixture-key",
      ...(fixture.budget !== undefined ? { creditBudget: fixture.budget } : {}),
    };
    tavilySearch = async (query) => {
      const hit = fixture.searches[query];
      if (!hit) {
        throw new Error(`fixture has no search response for query: ${query}`);
      }
      return hit;
    };
    firecrawlScrape = async (url) => {
      const hit = fixture.scrapes[url];
      if (!hit) {
        return { error: `fixture has no scrape response for url: ${url}` };
      }
      return hit;
    };
  } else if (config.enabled) {
    const tavilyApiKey = config.tavilyApiKey as string;
    const firecrawlApiKey = config.firecrawlApiKey as string;
    tavilySearch = createTavilySearch({
      tavilyApiKey,
      tavilyBaseUrl: config.tavilyBaseUrl,
      timeoutMs: config.timeoutMs,
    });
    firecrawlScrape = createSafeFirecrawlScrape({
      firecrawlApiKey,
      firecrawlBaseUrl: config.firecrawlBaseUrl,
      timeoutMs: config.timeoutMs,
    });
  } else {
    // Feature off: researchTarget returns "disabled" before any of these run.
    tavilySearch = async () => {
      throw new Error("web research disabled");
    };
    firecrawlScrape = async () => ({ error: "web research disabled" });
  }

  const plannedWrites: PlannedWrite[] = [];
  const upsertProposal = async (input: ProposalWriteInput) => {
    if (apply) {
      return convexRun<{ proposalId: string; created: boolean }>(
        convexUrl,
        "companies:upsertIndustryProposal",
        { ...input },
      );
    }
    plannedWrites.push({ op: "upsertProposal", input });
    return { proposalId: input.proposalId, created: true };
  };
  const upsertEvidenceSource = async (input: EvidenceSourceWriteInput) => {
    if (apply) {
      return convexRun<{ sourceId: string; created: boolean }>(
        convexUrl,
        "companies:upsertIndustryEvidenceSource",
        { ...input },
      );
    }
    plannedWrites.push({ op: "upsertEvidenceSource", input });
    return { sourceId: input.sourceId, created: true };
  };
  const setResearchState = async (input: ResearchStateWriteInput) => {
    if (apply) {
      return convexRun(convexUrl, "industry_proposals:setIndustryProposalResearchState", {
        proposalId: input.proposalId,
        status: input.status,
        ...(input.suggestedVerificationLevel !== undefined
          ? { suggestedVerificationLevel: input.suggestedVerificationLevel }
          : {}),
        ...(input.suggestedIndustryClass !== undefined
          ? { suggestedIndustryClass: input.suggestedIndustryClass }
          : {}),
        ...(input.materialChangeSummary !== undefined
          ? { materialChangeSummary: input.materialChangeSummary }
          : {}),
      });
    }
    plannedWrites.push({ op: "setResearchState", input });
    return { applied: false };
  };

  return {
    deps: {
      config,
      tavilySearch,
      firecrawlScrape,
      upsertProposal,
      upsertEvidenceSource,
      setResearchState,
      now,
    },
    plannedWrites,
  };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function runWebResearchCli(
  options: WebResearchCliOptions,
  depsOverride?: WebResearchDeps,
): Promise<WebResearchCliResult> {
  const { deps, plannedWrites } = depsOverride
    ? { deps: depsOverride, plannedWrites: [] as PlannedWrite[] }
    : buildCliDeps(options);

  const results = await runWebResearch(deps, options.targets);

  let logPath: string | undefined;
  if (options.logDir) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    logPath = join(options.logDir, `web-steward-run-${ts}.json`);
    mkdirSync(options.logDir, { recursive: true });
    writeFileSync(
      logPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          apply: options.apply,
          targets: options.targets,
          results,
          plannedWrites,
        },
        null,
        2,
      ),
    );
  }

  return { results, plannedWrites, logPath };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      target: { type: "string", multiple: true, default: [] as string[] },
      "targets-file": { type: "string" },
      fixture: { type: "string" },
      apply: { type: "boolean", default: false },
      "convex-url": {
        type: "string",
        default: process.env.CONVEX_URL ?? "http://127.0.0.1:3210",
      },
    },
  });

  const targets: ResearchTarget[] = [
    ...(values.target ?? []).map(parseTargetSpec),
    ...(values["targets-file"] ? loadTargetsFile(values["targets-file"]) : []),
  ];
  if (targets.length === 0) {
    throw new Error("Provide at least one --target or a --targets-file");
  }

  let fixture: WebResearchFixture | undefined;
  if (values.fixture) {
    fixture = JSON.parse(readFileSync(values.fixture, "utf-8")) as WebResearchFixture;
    if (!fixture || typeof fixture !== "object" || !fixture.searches) {
      throw new Error(`Fixture ${values.fixture} must contain a "searches" record`);
    }
  }

  const apply = values.apply === true;
  const convexUrl = values["convex-url"]!;
  console.log(
    `\n${apply ? "🔧 APPLYING" : "👀 DRY RUN"} - Web-research steward (${targets.length} target(s))`,
  );
  console.log(`   Convex: ${convexUrl}   Fixture: ${fixture ? "yes" : "no"}\n`);

  const result = await runWebResearchCli({
    targets,
    apply,
    convexUrl,
    fixture,
    logDir: "output/industry-data",
  });

  let errors = 0;
  for (const r of result.results) {
    const mark = r.outcome === "error" ? "[✗]" : "[·]";
    if (r.outcome === "error") errors += 1;
    console.log(
      `  ${mark} ${r.companyKey}  ->  ${r.outcome}  (${r.queriesRun} query(s), ${r.scrapesRun} scrape(s), ${r.sources.length} source(s))`,
    );
    if (r.error) {
      console.error(`       ${r.error.slice(0, 200)}`);
    }
  }

  if (result.logPath) {
    console.log(`\nLog: ${result.logPath}`);
  }
  console.log(
    `\n${apply ? "Applied" : "Dry-run"}: ${result.results.length} target(s), ${errors} error(s)${
      result.plannedWrites.length > 0 ? `, ${result.plannedWrites.length} planned write(s)` : ""
    }`,
  );
  if (!apply) {
    console.log("\nPass --apply to write proposal/evidence/state to Convex.");
  }
  process.exitCode = errors > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
