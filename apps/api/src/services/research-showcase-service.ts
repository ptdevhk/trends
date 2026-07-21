import { isRecord } from "@trends/shared";

import { callConvexMutation, callConvexQuery } from "./convex-utils.js";
import { config } from "./config.js";
import {
  allShowcaseCompanies,
  loadResearchShowcasePack,
  showcaseContentHash,
  type ResearchShowcasePack,
  type ShowcaseCompanyTemplate,
} from "./research-showcase-pack.js";
import { findLegacyOverride } from "./research-industry-bridge.js";
import { getLatestIngestRun, listResearchNews } from "./research-service.js";

export const SHOWCASE_SEED_INGEST_RUN_ID = "showcase-seed-v1";

/** Deterministic timestamp from contentHash for idempotent evidence.seenAt */
export function stableSeenAtFromHash(contentHash: string): number {
  let h = 0;
  for (let i = 0; i < contentHash.length; i += 1) {
    h = (h * 31 + contentHash.charCodeAt(i)) >>> 0;
  }
  // Fixed epoch window so values stay stable across seeds
  return 1_700_000_000_000 + (h % 1_000_000_000);
}

export type ShowcaseCompanyCard = {
  companyKey: string;
  displayName: string;
  nameCn?: string;
  nameEn?: string;
  kindCounts: Record<string, number>;
  signalCount: number;
  showcase: boolean;
  href: string;
};

export type ResearchShowcaseResponse = {
  golden: ShowcaseCompanyCard[];
  fromResumeDesk: ShowcaseCompanyCard[];
  pulse: Array<{
    title: string;
    platform: string;
    url?: string;
    capturedAt: number;
  }>;
  meta: {
    lastIngest: unknown | null;
    showcaseSeedVersion: string;
    seedIngestRunId: string;
  };
};

export type SeedResearchShowcaseResult = {
  companiesUpserted: number;
  aliasesCreated: number;
  newsUpserted: number;
  newsCreated: number;
  signalsUpserted: number;
  /** Rows with created:true from research_signals:upsert (0 on pure re-seed) */
  signalsCreated: number;
  seedIngestRunId: string;
};

export function getShowcasePack(): ResearchShowcasePack {
  return loadResearchShowcasePack();
}

function seedAliasesForCompany(company: ShowcaseCompanyTemplate): string[] {
  const aliases = new Set<string>();
  for (const a of company.aliases) {
    if (a.trim()) {
      aliases.add(a.trim());
    }
  }
  if (company.nameCn?.trim()) {
    aliases.add(company.nameCn.trim());
  }
  if (company.nameEn?.trim()) {
    aliases.add(company.nameEn.trim());
  }
  // Bridge overrides: ensure 宝力/宝惠 surfaces land on legacy keys
  const override =
    findLegacyOverride(company.companyKey) ||
    (company.nameCn ? findLegacyOverride(company.nameCn) : null);
  if (override && override.companyKey === company.companyKey) {
    for (const s of override.surfaces) {
      aliases.add(s);
    }
  }
  return [...aliases];
}

async function upsertCompanyAndAliases(
  company: ShowcaseCompanyTemplate,
  counters: { companiesUpserted: number; aliasesCreated: number },
): Promise<void> {
  // Identity: pack companyKey is already bridge-aligned (canonicalKey or legacy override)
  await callConvexMutation("companies:upsert", {
    writeSecret: config.auth.convexWriteSecret,
    companyKey: company.companyKey,
    displayName: company.displayName,
    ...(company.nameCn ? { nameCn: company.nameCn } : {}),
    ...(company.nameEn ? { nameEn: company.nameEn } : {}),
    status: "confirmed",
    createdBy: "research-showcase-seed",
  });
  counters.companiesUpserted += 1;

  for (const alias of seedAliasesForCompany(company)) {
    const value = await callConvexMutation("companies:addAlias", {
      writeSecret: config.auth.convexWriteSecret,
      companyKey: company.companyKey,
      alias,
      source: "seed",
    });
    if (isRecord(value) && value.created === true) {
      counters.aliasesCreated += 1;
    }
  }
}

async function upsertShowcaseSignal(
  company: ShowcaseCompanyTemplate,
  signal: ShowcaseCompanyTemplate["signals"][number],
  seedIngestRunId: string,
  counters: {
    newsUpserted: number;
    newsCreated: number;
    signalsUpserted: number;
    signalsCreated: number;
  },
): Promise<void> {
  const contentHash = showcaseContentHash(company.companyKey, signal.kind);
  const seenAt = stableSeenAtFromHash(contentHash);
  const newsResult = await callConvexMutation("research_news:upsertItem", {
    writeSecret: config.auth.convexWriteSecret,
    sourceId: "showcase",
    platform: "showcase",
    title: signal.title,
    contentHash,
    capturedAt: seenAt,
    rawSnippet: signal.snippet,
    url: `https://showcase.local/research/${company.companyKey}/${signal.kind}`,
  });
  counters.newsUpserted += 1;
  if (isRecord(newsResult) && newsResult.created === true) {
    counters.newsCreated += 1;
  }

  // Soft-dedupe identity: companyKey + kind + ingestRunId (created:false on re-seed)
  const signalResult = await callConvexMutation("research_signals:upsert", {
    writeSecret: config.auth.convexWriteSecret,
    companyKey: company.companyKey,
    kind: signal.kind,
    title: signal.title,
    summary: signal.snippet,
    evidence: {
      title: signal.title,
      platform: "showcase",
      seenAt,
      snippet: signal.snippet,
      url: `https://showcase.local/research/${company.companyKey}/${signal.kind}`,
    },
    capturedAt: seenAt,
    ingestRunId: seedIngestRunId,
  });
  counters.signalsUpserted += 1;
  if (isRecord(signalResult) && signalResult.created === true) {
    counters.signalsCreated += 1;
  }
}

/** If pre-fix data left multiple showcase-seed rows per kind, wipe and re-apply pack once. */
async function repairShowcaseSeedDuplicates(
  company: ShowcaseCompanyTemplate,
  seedIngestRunId: string,
  counters: {
    newsUpserted: number;
    newsCreated: number;
    signalsUpserted: number;
    signalsCreated: number;
  },
): Promise<void> {
  const value = await callConvexQuery("research_signals:listByCompany", {
    writeSecret: config.auth.convexWriteSecret,
    companyKey: company.companyKey,
    limit: 100,
  });
  const rows = Array.isArray(value) ? value : [];
  const byKind = new Map<string, number>();
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const ingestRunId = typeof row.ingestRunId === "string" ? row.ingestRunId : "";
    if (!ingestRunId.startsWith("showcase-seed")) {
      continue;
    }
    const kind = typeof row.kind === "string" ? row.kind : "";
    if (!kind) {
      continue;
    }
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }
  const needsRepair = [...byKind.values()].some((n) => n > 1);
  if (!needsRepair) {
    return;
  }
  await callConvexMutation("research_signals:deleteByCompanyIngestRunPrefix", {
    writeSecret: config.auth.convexWriteSecret,
    companyKey: company.companyKey,
    ingestRunIdPrefix: "showcase-seed",
  });
  for (const signal of company.signals) {
    await upsertShowcaseSignal(company, signal, seedIngestRunId, counters);
  }
}

export async function seedResearchShowcase(
  pack: ResearchShowcasePack = getShowcasePack(),
): Promise<SeedResearchShowcaseResult> {
  const seedIngestRunId = pack.seedIngestRunId || SHOWCASE_SEED_INGEST_RUN_ID;
  const counters = {
    companiesUpserted: 0,
    aliasesCreated: 0,
    newsUpserted: 0,
    newsCreated: 0,
    signalsUpserted: 0,
    signalsCreated: 0,
  };
  const companies = allShowcaseCompanies(pack);

  for (const company of companies) {
    await upsertCompanyAndAliases(company, counters);

    for (const signal of company.signals) {
      await upsertShowcaseSignal(company, signal, seedIngestRunId, counters);
    }

    // One-time repair for historical dups (pre company+kind+ingestRunId dedupe)
    await repairShowcaseSeedDuplicates(company, seedIngestRunId, counters);
  }

  return {
    companiesUpserted: counters.companiesUpserted,
    aliasesCreated: counters.aliasesCreated,
    newsUpserted: counters.newsUpserted,
    newsCreated: counters.newsCreated,
    signalsUpserted: counters.signalsUpserted,
    signalsCreated: counters.signalsCreated,
    seedIngestRunId,
  };
}

async function cardForCompany(
  company: ShowcaseCompanyTemplate,
  teamSlug: string,
  seedIngestRunId: string,
): Promise<ShowcaseCompanyCard> {
  const value = await callConvexQuery("research_signals:listByCompany", {
    writeSecret: config.auth.convexWriteSecret,
    companyKey: company.companyKey,
    limit: 100,
  });
  const rows = Array.isArray(value) ? value : [];
  const kindCounts: Record<string, number> = {};
  let showcase = false;
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const ingestRunId = typeof row.ingestRunId === "string" ? row.ingestRunId : "";
    // Hub density cards only count curated showcase-seed rows (not live hotlist noise)
    if (!ingestRunId.startsWith("showcase-seed")) {
      continue;
    }
    showcase = true;
    const kind = typeof row.kind === "string" ? row.kind : "";
    if (kind) {
      kindCounts[kind] = (kindCounts[kind] ?? 0) + 1;
    }
  }
  const signalCount = Object.values(kindCounts).reduce((a, b) => a + b, 0);
  return {
    companyKey: company.companyKey,
    displayName: company.displayName,
    ...(company.nameCn ? { nameCn: company.nameCn } : {}),
    ...(company.nameEn ? { nameEn: company.nameEn } : {}),
    kindCounts,
    signalCount,
    // Only curated seed rows — never label live-only density as showcase
    showcase,
    href: `/${teamSlug}/research/${encodeURIComponent(company.companyKey)}?persona=hr`,
  };
}

export async function getResearchShowcase(teamSlug: string): Promise<ResearchShowcaseResponse> {
  const pack = getShowcasePack();
  const slug = teamSlug.trim() || "hr";
  const seedIngestRunId = pack.seedIngestRunId || SHOWCASE_SEED_INGEST_RUN_ID;

  const golden = await Promise.all(
    pack.golden.map((c) => cardForCompany(c, slug, seedIngestRunId)),
  );
  const fromResumeDesk = await Promise.all(
    pack.fromResumeDesk.map((c) => cardForCompany(c, slug, seedIngestRunId)),
  );

  const news = await listResearchNews({ limit: 12 });
  const pulse = news.map((n) => ({
    title: n.title,
    platform: n.platform,
    ...(n.url ? { url: n.url } : {}),
    capturedAt: n.capturedAt,
  }));

  const lastIngest = await getLatestIngestRun();

  return {
    golden,
    fromResumeDesk,
    pulse,
    meta: {
      lastIngest,
      showcaseSeedVersion: pack.version,
      seedIngestRunId,
    },
  };
}
