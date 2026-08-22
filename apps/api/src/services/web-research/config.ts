/**
 * Env-driven configuration for the web-research steward. The feature is
 * opt-in (WEB_RESEARCH_ENABLED=true) and refuses to start without both
 * provider API keys once enabled.
 */
export interface WebResearchConfig {
  enabled: boolean;
  tavilyApiKey?: string;
  firecrawlApiKey?: string;
  tavilyBaseUrl: string;
  firecrawlBaseUrl: string;
  /** Max credits per run (1 credit = 1 Tavily search or 1 Firecrawl scrape). */
  creditBudget: number;
  /** Max candidate URLs kept per target. */
  maxCandidates: number;
  /** Per-HTTP-call timeout in milliseconds. */
  timeoutMs: number;
  /** Domains treated as official company sites (lowercase, no scheme). */
  officialDomains: string[];
}

const DEFAULTS = {
  tavilyBaseUrl: "https://api.tavily.com",
  firecrawlBaseUrl: "https://api.firecrawl.dev",
  creditBudget: 100,
  maxCandidates: 10,
  timeoutMs: 15000,
} as const;

const BOUNDS = {
  creditBudget: { min: 1, max: 100000 },
  maxCandidates: { min: 1, max: 50 },
  timeoutMs: { min: 1000, max: 120000 },
} as const;

function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function loadWebResearchConfig(
  env: Record<string, string | undefined>,
): WebResearchConfig {
  const enabled = env.WEB_RESEARCH_ENABLED === "true";
  const tavilyApiKey = env.TAVILY_API_KEY?.trim() || undefined;
  const firecrawlApiKey = env.FIRECRAWL_API_KEY?.trim() || undefined;

  if (enabled) {
    const missing: string[] = [];
    if (!tavilyApiKey) missing.push("TAVILY_API_KEY");
    if (!firecrawlApiKey) missing.push("FIRECRAWL_API_KEY");
    if (missing.length > 0) {
      throw new Error(
        `Web research is enabled but missing required env: ${missing.join(", ")}`,
      );
    }
  }

  const officialDomains = (env.WEB_RESEARCH_OFFICIAL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);

  return {
    enabled,
    ...(tavilyApiKey ? { tavilyApiKey } : {}),
    ...(firecrawlApiKey ? { firecrawlApiKey } : {}),
    tavilyBaseUrl: env.WEB_RESEARCH_TAVILY_BASE_URL?.trim() || DEFAULTS.tavilyBaseUrl,
    firecrawlBaseUrl:
      env.WEB_RESEARCH_FIRECRAWL_BASE_URL?.trim() || DEFAULTS.firecrawlBaseUrl,
    creditBudget: parseBoundedInt(
      env.WEB_RESEARCH_CREDIT_BUDGET,
      DEFAULTS.creditBudget,
      BOUNDS.creditBudget.min,
      BOUNDS.creditBudget.max,
    ),
    maxCandidates: parseBoundedInt(
      env.WEB_RESEARCH_MAX_CANDIDATES,
      DEFAULTS.maxCandidates,
      BOUNDS.maxCandidates.min,
      BOUNDS.maxCandidates.max,
    ),
    timeoutMs: parseBoundedInt(
      env.WEB_RESEARCH_TIMEOUT_MS,
      DEFAULTS.timeoutMs,
      BOUNDS.timeoutMs.min,
      BOUNDS.timeoutMs.max,
    ),
    officialDomains,
  };
}
