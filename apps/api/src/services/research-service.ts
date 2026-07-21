import {
  isRecord,
  normalizeResearchPersona,
  rankSignalsForPersona,
  type ResearchPersona,
} from "@trends/shared";

import { callConvexQuery } from "./convex-utils.js";
import { config } from "./config.js";
import { listCompanies } from "./company-policy-service.js";

export type ResearchNewsItem = {
  _id: string;
  sourceId: string;
  platform: string;
  title: string;
  contentHash: string;
  capturedAt: number;
  externalId?: string;
  url?: string;
  rank?: number;
  publishedAt?: number;
  rawSnippet?: string;
};

export type ResearchSignal = {
  _id: string;
  companyKey: string;
  kind: string;
  title: string;
  summary?: string;
  evidence: {
    newsItemId?: string;
    title: string;
    url?: string;
    platform: string;
    seenAt: number;
    snippet?: string;
  };
  score?: number;
  capturedAt: number;
  ingestRunId?: string;
};

function parseNewsItem(value: unknown): ResearchNewsItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const title = typeof value.title === "string" ? value.title : "";
  const contentHash = typeof value.contentHash === "string" ? value.contentHash : "";
  const platform = typeof value.platform === "string" ? value.platform : "";
  const sourceId = typeof value.sourceId === "string" ? value.sourceId : "";
  if (!title || !contentHash || !platform || !sourceId) {
    return null;
  }
  return {
    _id: typeof value._id === "string" ? value._id : String(value._id ?? ""),
    sourceId,
    platform,
    title,
    contentHash,
    capturedAt: typeof value.capturedAt === "number" ? value.capturedAt : 0,
    ...(typeof value.externalId === "string" ? { externalId: value.externalId } : {}),
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(typeof value.rank === "number" ? { rank: value.rank } : {}),
    ...(typeof value.publishedAt === "number" ? { publishedAt: value.publishedAt } : {}),
    ...(typeof value.rawSnippet === "string" ? { rawSnippet: value.rawSnippet } : {}),
  };
}

function parseSignal(value: unknown): ResearchSignal | null {
  if (!isRecord(value)) {
    return null;
  }
  const companyKey = typeof value.companyKey === "string" ? value.companyKey : "";
  const kind = typeof value.kind === "string" ? value.kind : "";
  const title = typeof value.title === "string" ? value.title : "";
  if (!companyKey || !kind || !title || !isRecord(value.evidence)) {
    return null;
  }
  const evidence = value.evidence;
  const evidenceTitle = typeof evidence.title === "string" ? evidence.title : title;
  const evidencePlatform = typeof evidence.platform === "string" ? evidence.platform : "";
  if (!evidencePlatform) {
    return null;
  }
  return {
    _id: typeof value._id === "string" ? value._id : String(value._id ?? ""),
    companyKey,
    kind,
    title,
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    evidence: {
      ...(typeof evidence.newsItemId === "string" ? { newsItemId: evidence.newsItemId } : {}),
      title: evidenceTitle,
      ...(typeof evidence.url === "string" ? { url: evidence.url } : {}),
      platform: evidencePlatform,
      seenAt: typeof evidence.seenAt === "number" ? evidence.seenAt : 0,
      ...(typeof evidence.snippet === "string" ? { snippet: evidence.snippet } : {}),
    },
    ...(typeof value.score === "number" ? { score: value.score } : {}),
    capturedAt: typeof value.capturedAt === "number" ? value.capturedAt : 0,
    ...(typeof value.ingestRunId === "string" ? { ingestRunId: value.ingestRunId } : {}),
  };
}

export async function listResearchNews(params: {
  limit?: number;
  platform?: string;
  since?: number;
}): Promise<ResearchNewsItem[]> {
  const value = await callConvexQuery("research_news:listRecent", {
    writeSecret: config.auth.convexWriteSecret,
    ...(params.limit != null ? { limit: params.limit } : {}),
    ...(params.platform ? { platform: params.platform } : {}),
    ...(params.since != null ? { since: params.since } : {}),
  });
  if (!Array.isArray(value)) {
    throw new Error("Invalid research_news:listRecent response");
  }
  return value.map(parseNewsItem).filter((item): item is ResearchNewsItem => item != null);
}

export async function listCompanySignals(params: {
  companyKey: string;
  persona?: string;
  limit?: number;
}): Promise<{ persona: ResearchPersona; items: ResearchSignal[] }> {
  const persona = normalizeResearchPersona(params.persona);
  const value = await callConvexQuery("research_signals:listByCompany", {
    writeSecret: config.auth.convexWriteSecret,
    companyKey: params.companyKey,
    ...(params.limit != null ? { limit: params.limit } : {}),
  });
  if (!Array.isArray(value)) {
    throw new Error("Invalid research_signals:listByCompany response");
  }
  const items = value
    .map(parseSignal)
    .filter((item): item is ResearchSignal => item != null);
  return {
    persona,
    items: rankSignalsForPersona(items, persona),
  };
}

export async function searchResearchCompanies(q: string): Promise<
  Array<{ companyKey: string; displayName: string; nameCn?: string; nameEn?: string }>
> {
  const query = q.trim().toLowerCase();
  const companies = await listCompanies();
  if (!query) {
    return companies.slice(0, 20).map((c) => ({
      companyKey: c.companyKey,
      displayName: c.displayName,
      ...(c.nameCn ? { nameCn: c.nameCn } : {}),
      ...(c.nameEn ? { nameEn: c.nameEn } : {}),
    }));
  }

  // Prefer exact alias resolve when possible
  try {
    const resolved = await callConvexQuery("companies:resolveAlias", {
      writeSecret: config.auth.convexWriteSecret,
      alias: q.trim(),
    });
    if (isRecord(resolved) && typeof resolved.companyKey === "string") {
      return [
        {
          companyKey: resolved.companyKey,
          displayName:
            typeof resolved.displayName === "string"
              ? resolved.displayName
              : resolved.companyKey,
          ...(typeof resolved.nameCn === "string" ? { nameCn: resolved.nameCn } : {}),
          ...(typeof resolved.nameEn === "string" ? { nameEn: resolved.nameEn } : {}),
        },
      ];
    }
  } catch {
    // fall through to fuzzy list
  }

  return companies
    .filter((c) => {
      const hay = `${c.companyKey} ${c.displayName} ${c.nameCn ?? ""} ${c.nameEn ?? ""}`.toLowerCase();
      return hay.includes(query) || c.aliases.some((a) => a.aliasNormalized.includes(query) || a.aliasDisplay.toLowerCase().includes(query));
    })
    .slice(0, 20)
    .map((c) => ({
      companyKey: c.companyKey,
      displayName: c.displayName,
      ...(c.nameCn ? { nameCn: c.nameCn } : {}),
      ...(c.nameEn ? { nameEn: c.nameEn } : {}),
    }));
}

export async function triggerResearchIngest(): Promise<{
  success: boolean;
  mode: string;
  started_at?: string;
  finished_at?: string;
  message: string;
}> {
  const workerUrl = (process.env.WORKER_URL || process.env.TRENDS_WORKER_URL || "http://localhost:8000").replace(
    /\/$/,
    "",
  );
  const response = await fetch(`${workerUrl}/worker/research/ingest`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Worker research ingest failed (${response.status}): ${text}`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  return {
    success: payload.success !== false,
    mode: typeof payload.mode === "string" ? payload.mode : "research-ingest",
    ...(typeof payload.started_at === "string" ? { started_at: payload.started_at } : {}),
    ...(typeof payload.finished_at === "string" ? { finished_at: payload.finished_at } : {}),
    message: typeof payload.message === "string" ? payload.message : "Research ingest completed",
  };
}

export async function getLatestParity(): Promise<unknown | null> {
  const value = await callConvexQuery("research_ops:latestParity", {
    writeSecret: config.auth.convexWriteSecret,
  });
  return value ?? null;
}
