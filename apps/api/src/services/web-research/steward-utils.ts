/**
 * Pure helpers for the web-research steward: query building, candidate URL
 * filtering/classification, industry signal extraction, and the credit
 * ledger (1 credit = 1 Tavily search or 1 Firecrawl scrape).
 */
import { normalizeIndustryEvidenceUrl } from "@trends/shared";

export interface TavilyLikeResult {
  title?: string;
  url: string;
  content?: string;
  score?: number;
}

export interface CandidateUrl {
  url: string;
  sourceDomain: string;
  isOfficial: boolean;
  score: number;
  title?: string;
  content?: string;
}

export interface IndustrySignal {
  industryClass: string;
  confidence: number;
  excerpt?: string;
}

export interface CreditLedger {
  spent: number;
  remaining: number;
  canSpend(cost: number): boolean;
  spend(cost: number): boolean;
}

const JUNK_SEARCH_DOMAINS = [
  "baidu.com",
  "sogou.com",
  "sm.cn",
  "360.cn",
  "bing.com",
  "google.com",
  "google.com.hk",
  "yandex.com",
  "duckduckgo.com",
  "ecosia.org",
];

/** Groups are ordered by tiebreak priority; ties go to the first group. */
const INDUSTRY_SIGNAL_GROUPS: ReadonlyArray<{
  industryClass: string;
  weight: number;
  keywords: readonly string[];
}> = [
  { industryClass: "cnc", weight: 2, keywords: ["数控", "机床", "cnc"] },
  {
    industryClass: "automation",
    weight: 1,
    keywords: ["自动化", "机器人", "plc"],
  },
  { industryClass: "metrology", weight: 1, keywords: ["三坐标", "计量"] },
  {
    industryClass: "industrial",
    weight: 1,
    keywords: ["加工", "设备", "机械", "制造", "工厂", "生产"],
  },
];

export function buildResearchQueries(
  names: string[],
  maxCandidates = 10,
): string[] {
  const queries: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed === "") continue;
    queries.push(`${trimmed} 主营 行业`, `${trimmed} 公司 简介 官网`);
  }
  return queries.slice(0, maxCandidates);
}

function isJunkSearchDomain(hostname: string): boolean {
  return JUNK_SEARCH_DOMAINS.some(
    (junk) => hostname === junk || hostname.endsWith(`.${junk}`),
  );
}

export function isOfficialDomain(
  hostname: string,
  officialDomains: string[],
): boolean {
  const lower = hostname.toLowerCase();
  return officialDomains.some((domain) => {
    const d = domain.toLowerCase();
    return lower === d || lower.endsWith(`.${d}`);
  });
}

export function filterCandidateUrls(
  results: TavilyLikeResult[],
  options: { maxCandidates: number; officialDomains?: string[] },
): CandidateUrl[] {
  const officialDomains = options.officialDomains ?? [];
  const seen = new Set<string>();
  const candidates: CandidateUrl[] = [];
  for (const result of results) {
    let normalized: { url: string; sourceDomain: string } | null = null;
    try {
      normalized = normalizeIndustryEvidenceUrl(result.url);
    } catch {
      normalized = null;
    }
    if (normalized === null) continue;
    if (isJunkSearchDomain(normalized.sourceDomain)) continue;
    if (seen.has(normalized.url)) continue;
    seen.add(normalized.url);
    candidates.push({
      url: normalized.url,
      sourceDomain: normalized.sourceDomain,
      isOfficial: isOfficialDomain(normalized.sourceDomain, officialDomains),
      score: typeof result.score === "number" ? result.score : 0,
      ...(result.title !== undefined ? { title: result.title } : {}),
      ...(result.content !== undefined ? { content: result.content } : {}),
    });
  }
  candidates.sort((a, b) => {
    if (a.isOfficial !== b.isOfficial) return a.isOfficial ? -1 : 1;
    return b.score - a.score;
  });
  return candidates.slice(0, options.maxCandidates);
}

export function extractIndustrySignal(text: string): IndustrySignal {
  const window = text.slice(0, 20000).toLowerCase();
  let best: { industryClass: string; weighted: number; firstIndex: number } | null =
    null;
  for (const group of INDUSTRY_SIGNAL_GROUPS) {
    let count = 0;
    let firstIndex = -1;
    for (const keyword of group.keywords) {
      let from = 0;
      for (;;) {
        const idx = window.indexOf(keyword, from);
        if (idx === -1) break;
        if (firstIndex === -1) firstIndex = idx;
        count += 1;
        from = idx + keyword.length;
      }
    }
    const weighted = count * group.weight;
    if (count > 0 && (best === null || weighted > best.weighted)) {
      best = { industryClass: group.industryClass, weighted, firstIndex };
    }
  }
  if (best === null) {
    return { industryClass: "unknown", confidence: 0 };
  }
  const confidence = Math.min(1, best.weighted / 4);
  const excerpt = text.slice(
    Math.max(0, best.firstIndex - 150),
    best.firstIndex + 150,
  );
  return { industryClass: best.industryClass, confidence, excerpt };
}

export function createCreditLedger(budget: number): CreditLedger {
  let spent = 0;
  const canSpend = (cost: number): boolean => cost >= 0 && cost <= budget - spent;
  return {
    get spent() {
      return spent;
    },
    get remaining() {
      return budget - spent;
    },
    canSpend,
    spend(cost: number): boolean {
      if (cost < 0) return false;
      if (cost === 0) return true;
      if (cost > budget - spent) return false;
      spent += cost;
      return true;
    },
  };
}
