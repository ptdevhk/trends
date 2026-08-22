/**
 * Web-research steward orchestration: per-target research with credit
 * budget accounting, source classification (official/primary vs
 * directory/corroborating vs discovery), and writes to the industry
 * proposal/evidence pipeline. Hot-path invariant: known hits stay pure
 * deterministic — no invented origin, web evidence only.
 */
import type {
  IndustryClass,
  IndustryEvidenceSourceType,
  IndustryEvidenceTrustTier,
  IndustryMaintenanceTriggerReason,
} from "@trends/shared";
import { loadWebResearchConfig, type WebResearchConfig } from "./config.js";
import {
  createTavilySearch,
  type TavilySearch,
  type TavilySearchResponse,
} from "./tavily-client.js";
import {
  createSafeFirecrawlScrape,
  type SafeFirecrawlScrape,
} from "./firecrawl-client.js";
import {
  buildResearchQueries,
  createCreditLedger,
  extractIndustrySignal,
  filterCandidateUrls,
} from "./steward-utils.js";
import { upsertIndustryProposal } from "../company-industry-proposal-service.js";
import { upsertIndustryEvidenceSource } from "../company-industry-evidence-service.js";
import { callConvexMutation } from "../convex-utils.js";
import { getConvexWriteSecret } from "../config.js";

export interface ResearchTarget {
  companyKey: string;
  names: string[];
}

export type ResearchOutcome =
  | "disabled"
  | "skipped_budget"
  | "no_sources"
  | "drafted"
  | "error";

export interface TargetResearchResult {
  companyKey: string;
  proposalId: string;
  outcome: ResearchOutcome;
  queriesRun: number;
  scrapesRun: number;
  sources: Array<{
    sourceId: string;
    url: string;
    sourceType: string;
    trustTier: string;
    fetchStatus: string;
  }>;
  error?: string;
}

export interface ProposalWriteInput {
  proposalId: string;
  companyKey?: string;
  triggerReasons: string[];
  priority: number;
  suggestedVerificationLevel?: "verified" | "candidate" | "rejected";
  suggestedIndustryClass?: string;
  materialChangeSummary?: string;
  requestedBy?: string;
}

export interface EvidenceSourceWriteInput {
  sourceId: string;
  companyKey?: string;
  proposalId?: string;
  url: string;
  sourceType: string;
  trustTier: string;
  title?: string;
  evidenceExcerpt?: string;
  fetchedAt?: number;
  fetchStatus: "pending" | "fetched" | "failed" | "unavailable";
  suggestedIndustryClass?: string;
  workerConfidence?: number;
}

export interface ResearchStateWriteInput {
  proposalId: string;
  status: "researching" | "ready_for_review" | "needs_more_evidence";
  suggestedVerificationLevel?: "verified" | "candidate" | "rejected";
  suggestedIndustryClass?: string;
  materialChangeSummary?: string;
}

export interface WebResearchDeps {
  config: WebResearchConfig;
  tavilySearch: TavilySearch;
  firecrawlScrape: SafeFirecrawlScrape;
  upsertProposal: (
    input: ProposalWriteInput,
  ) => Promise<{ proposalId: string; created: boolean }>;
  upsertEvidenceSource: (
    input: EvidenceSourceWriteInput,
  ) => Promise<{ sourceId: string; created: boolean }>;
  setResearchState: (input: ResearchStateWriteInput) => Promise<unknown>;
  now: () => number;
}

export function proposalIdForCompany(companyKey: string): string {
  return `web-steward-${companyKey}`;
}

function suggestedClassFields(
  signal: { industryClass: string; confidence: number },
): { suggestedIndustryClass: string } | Record<string, never> {
  if (signal.industryClass === "unknown") return {};
  return { suggestedIndustryClass: signal.industryClass };
}

function signalFields(
  signal: { industryClass: string; confidence: number },
): { suggestedIndustryClass: string; workerConfidence: number } | Record<string, never> {
  if (signal.industryClass === "unknown") return {};
  return {
    suggestedIndustryClass: signal.industryClass,
    workerConfidence: signal.confidence,
  };
}

function summaryFor(
  candidateCount: number,
  queriesRun: number,
  signal: { industryClass: string; confidence: number },
): string {
  return `Web steward: ${candidateCount} candidate source(s) from ${queriesRun} query(s); signal ${signal.industryClass} @ ${signal.confidence}`;
}

export async function researchTarget(
  deps: WebResearchDeps,
  target: ResearchTarget,
): Promise<TargetResearchResult> {
  const { config } = deps;
  const draftProposalId = proposalIdForCompany(target.companyKey);
  // The proposal table is upserted by company, so an existing open proposal
  // keeps its own id. Evidence/state writes must target the id the proposal
  // write actually returned; fresh companies get the drafted id.
  let proposalId = draftProposalId;
  const base: Omit<TargetResearchResult, "outcome" | "error"> = {
    companyKey: target.companyKey,
    proposalId: draftProposalId,
    queriesRun: 0,
    scrapesRun: 0,
    sources: [],
  };

  if (!config.enabled) {
    return { ...base, outcome: "disabled" };
  }

  const queries = buildResearchQueries(target.names, config.maxCandidates);
  const ledger = createCreditLedger(config.creditBudget);

  if (!ledger.canSpend(queries.length)) {
    return { ...base, outcome: "skipped_budget" };
  }
  ledger.spend(queries.length);

  let queriesRun = 0;
  let lastError: unknown = null;
  const responses: TavilySearchResponse[] = [];
  for (const query of queries) {
    try {
      responses.push(await deps.tavilySearch(query));
      queriesRun += 1;
    } catch (error) {
      lastError = error;
    }
  }

  if (queriesRun === 0) {
    return {
      ...base,
      outcome: "error",
      error: lastError instanceof Error ? lastError.message : String(lastError),
    };
  }

  const candidates = filterCandidateUrls(
    responses.flatMap((r) => r.results),
    { maxCandidates: config.maxCandidates, officialDomains: config.officialDomains },
  );

  if (candidates.length === 0) {
    return { ...base, queriesRun, outcome: "no_sources" };
  }

  const baseSignal = extractIndustrySignal(
    candidates
      .map((c) => `${c.title ?? ""} ${c.content ?? ""}`)
      .join(" "),
  );
  const summary = summaryFor(candidates.length, queriesRun, baseSignal);

  try {
    const applied = await deps.upsertProposal({
      proposalId: draftProposalId,
      companyKey: target.companyKey,
      triggerReasons: ["curated"],
      priority: 5,
      suggestedVerificationLevel: "candidate",
      ...suggestedClassFields(baseSignal),
      materialChangeSummary: summary,
      requestedBy: "web-steward",
    });
    if (applied?.proposalId) {
      proposalId = applied.proposalId;
    }

    let scrapesRun = 0;
    const sources: TargetResearchResult["sources"] = [];
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const sourceId = `${proposalId}-src-${i + 1}`;
      let sourceType: string;
      let trustTier: string;
      let fetchStatus: "pending" | "fetched" | "failed" | "unavailable";
      let fetchedAt: number | undefined;
      let evidenceExcerpt: string | undefined;
      let signal = baseSignal;

      if (candidate.isOfficial) {
        sourceType = "official_site";
        trustTier = "primary";
        fetchStatus = "pending";
      } else if (ledger.canSpend(1)) {
        ledger.spend(1);
        scrapesRun += 1;
        const scraped = await deps.firecrawlScrape(candidate.url);
        if ("error" in scraped) {
          sourceType = "search_result";
          trustTier = "discovery";
          fetchStatus = "failed";
        } else {
          sourceType = "directory";
          trustTier = "corroborating";
          fetchStatus = "fetched";
          fetchedAt = deps.now();
          const markdownSignal = extractIndustrySignal(scraped.markdown);
          if (markdownSignal.industryClass !== "unknown") {
            signal = markdownSignal;
            evidenceExcerpt = markdownSignal.excerpt;
          }
        }
      } else {
        sourceType = "search_result";
        trustTier = "discovery";
        fetchStatus = "pending";
      }

      await deps.upsertEvidenceSource({
        sourceId,
        companyKey: target.companyKey,
        proposalId,
        url: candidate.url,
        sourceType,
        trustTier,
        ...(candidate.title !== undefined ? { title: candidate.title } : {}),
        ...(fetchStatus === "fetched"
          ? {
              fetchStatus,
              fetchedAt,
              ...(evidenceExcerpt !== undefined ? { evidenceExcerpt } : {}),
            }
          : { fetchStatus }),
        ...signalFields(signal),
      });
      sources.push({ sourceId, url: candidate.url, sourceType, trustTier, fetchStatus });
    }

    await deps.setResearchState({
      proposalId,
      status: "ready_for_review",
      suggestedVerificationLevel: "candidate",
      ...suggestedClassFields(baseSignal),
      materialChangeSummary: summary,
    });

    return { ...base, proposalId, queriesRun, scrapesRun, sources, outcome: "drafted" };
  } catch (error) {
    return {
      ...base,
      proposalId,
      queriesRun,
      outcome: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runWebResearch(
  deps: WebResearchDeps,
  targets: ResearchTarget[],
): Promise<TargetResearchResult[]> {
  const results: TargetResearchResult[] = [];
  for (const target of targets) {
    try {
      results.push(await researchTarget(deps, target));
    } catch (error) {
      results.push({
        companyKey: target.companyKey,
        proposalId: proposalIdForCompany(target.companyKey),
        outcome: "error",
        queriesRun: 0,
        scrapesRun: 0,
        sources: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export function createDefaultWebResearchDeps(
  env: Record<string, string | undefined> = process.env,
): WebResearchDeps {
  const config = loadWebResearchConfig(env);
  if (!config.enabled) {
    throw new Error(
      "Web research is disabled: set WEB_RESEARCH_ENABLED=true with TAVILY_API_KEY and FIRECRAWL_API_KEY",
    );
  }
  const tavilyApiKey = config.tavilyApiKey as string;
  const firecrawlApiKey = config.firecrawlApiKey as string;
  return {
    config,
    tavilySearch: createTavilySearch({
      tavilyApiKey,
      tavilyBaseUrl: config.tavilyBaseUrl,
      timeoutMs: config.timeoutMs,
    }),
    firecrawlScrape: createSafeFirecrawlScrape({
      firecrawlApiKey,
      firecrawlBaseUrl: config.firecrawlBaseUrl,
      timeoutMs: config.timeoutMs,
    }),
    upsertProposal: (input) =>
      upsertIndustryProposal({
        ...input,
        triggerReasons: input.triggerReasons as IndustryMaintenanceTriggerReason[],
        suggestedIndustryClass: input.suggestedIndustryClass as IndustryClass | undefined,
      }),
    upsertEvidenceSource: (input) =>
      upsertIndustryEvidenceSource({
        ...input,
        sourceType: input.sourceType as IndustryEvidenceSourceType,
        trustTier: input.trustTier as IndustryEvidenceTrustTier,
        suggestedIndustryClass: input.suggestedIndustryClass as IndustryClass | undefined,
      }),
    setResearchState: async (input) => {
      const value = await callConvexMutation(
        "industry_proposals:setIndustryProposalResearchState",
        {
          writeSecret: getConvexWriteSecret(),
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
        },
      );
      return value;
    },
    now: () => Date.now(),
  };
}
