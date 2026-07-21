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
  signalsUpserted: number;
  seedIngestRunId: string;
};

export function getShowcasePack(): ResearchShowcasePack {
  return loadResearchShowcasePack();
}

async function upsertCompanyAndAliases(
  company: ShowcaseCompanyTemplate,
  counters: { companiesUpserted: number; aliasesCreated: number },
): Promise<void> {
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

  for (const alias of company.aliases) {
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

export async function seedResearchShowcase(
  pack: ResearchShowcasePack = getShowcasePack(),
): Promise<SeedResearchShowcaseResult> {
  const seedIngestRunId = pack.seedIngestRunId || SHOWCASE_SEED_INGEST_RUN_ID;
  const counters = {
    companiesUpserted: 0,
    aliasesCreated: 0,
    newsUpserted: 0,
    signalsUpserted: 0,
  };
  const companies = allShowcaseCompanies(pack);

  for (const company of companies) {
    await upsertCompanyAndAliases(company, counters);

    for (const signal of company.signals) {
      const contentHash = showcaseContentHash(company.companyKey, signal.kind);
      // Stable seenAt from hash so re-seeds match Convex soft-dedupe keys exactly
      const seenAt = stableSeenAtFromHash(contentHash);
      await callConvexMutation("research_news:upsertItem", {
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

      await callConvexMutation("research_signals:upsert", {
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
    }
  }

  return {
    companiesUpserted: counters.companiesUpserted,
    aliasesCreated: counters.aliasesCreated,
    newsUpserted: counters.newsUpserted,
    signalsUpserted: counters.signalsUpserted,
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
    const kind = typeof row.kind === "string" ? row.kind : "";
    if (kind) {
      kindCounts[kind] = (kindCounts[kind] ?? 0) + 1;
    }
    if (typeof row.ingestRunId === "string" && row.ingestRunId.startsWith("showcase-seed")) {
      showcase = true;
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
