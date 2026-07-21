import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export const SHOWCASE_SIGNAL_KINDS = [
  "company_mention",
  "hiring_signal",
  "market_move",
  "sales_trigger",
] as const;

export type ShowcaseSignalKind = (typeof SHOWCASE_SIGNAL_KINDS)[number];

export type ShowcaseSignalTemplate = {
  kind: ShowcaseSignalKind;
  title: string;
  snippet?: string;
};

export type ShowcaseCompanyTemplate = {
  companyKey: string;
  displayName: string;
  nameCn?: string;
  nameEn?: string;
  aliases: string[];
  signals: ShowcaseSignalTemplate[];
};

export type ResearchShowcasePack = {
  version: string;
  seedIngestRunId: string;
  golden: ShowcaseCompanyTemplate[];
  fromResumeDesk: ShowcaseCompanyTemplate[];
};

function isKind(value: unknown): value is ShowcaseSignalKind {
  return typeof value === "string" && (SHOWCASE_SIGNAL_KINDS as readonly string[]).includes(value);
}

function parseCompany(raw: unknown, label: string): ShowcaseCompanyTemplate {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid showcase company in ${label}`);
  }
  const row = raw as Record<string, unknown>;
  const companyKey = typeof row.companyKey === "string" ? row.companyKey.trim() : "";
  const displayName = typeof row.displayName === "string" ? row.displayName.trim() : "";
  if (!companyKey || !displayName) {
    throw new Error(`Showcase company in ${label} requires companyKey and displayName`);
  }
  const aliases = Array.isArray(row.aliases)
    ? row.aliases.filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim())
    : [];
  const signalsRaw = Array.isArray(row.signals) ? row.signals : [];
  const signals: ShowcaseSignalTemplate[] = [];
  for (const s of signalsRaw) {
    if (!s || typeof s !== "object") {
      continue;
    }
    const sig = s as Record<string, unknown>;
    if (!isKind(sig.kind)) {
      throw new Error(`Invalid signal kind for ${companyKey}: ${String(sig.kind)}`);
    }
    const title = typeof sig.title === "string" ? sig.title.trim() : "";
    if (!title) {
      throw new Error(`Signal title required for ${companyKey}/${sig.kind}`);
    }
    signals.push({
      kind: sig.kind,
      title,
      ...(typeof sig.snippet === "string" ? { snippet: sig.snippet } : {}),
    });
  }
  if (signals.length === 0) {
    throw new Error(`Showcase company ${companyKey} needs at least one signal`);
  }
  return {
    companyKey,
    displayName,
    ...(typeof row.nameCn === "string" ? { nameCn: row.nameCn } : {}),
    ...(typeof row.nameEn === "string" ? { nameEn: row.nameEn } : {}),
    aliases,
    signals,
  };
}

export function parseResearchShowcasePack(doc: unknown): ResearchShowcasePack {
  if (!doc || typeof doc !== "object") {
    throw new Error("Showcase pack must be an object");
  }
  const root = doc as Record<string, unknown>;
  const version = typeof root.version === "string" ? root.version : "v1";
  const seedIngestRunId =
    typeof root.seedIngestRunId === "string" && root.seedIngestRunId.trim()
      ? root.seedIngestRunId.trim()
      : "showcase-seed-v1";
  const golden = (Array.isArray(root.golden) ? root.golden : []).map((c, i) =>
    parseCompany(c, `golden[${i}]`),
  );
  const fromResumeDesk = (Array.isArray(root.fromResumeDesk) ? root.fromResumeDesk : []).map((c, i) =>
    parseCompany(c, `fromResumeDesk[${i}]`),
  );
  if (golden.length === 0) {
    throw new Error("Showcase pack requires at least one golden company");
  }
  return { version, seedIngestRunId, golden, fromResumeDesk };
}

function defaultProjectRoot(): string {
  const cwd = resolve(process.cwd());
  // When running from apps/api (vitest workspace / tsx), monorepo root is ../..
  // When running from monorepo root, use cwd.
  try {
    readFileSync(resolve(cwd, "config/research_showcase.yaml"), "utf8");
    return cwd;
  } catch {
    const candidate = resolve(cwd, "../..");
    try {
      readFileSync(resolve(candidate, "config/research_showcase.yaml"), "utf8");
      return candidate;
    } catch {
      return cwd;
    }
  }
}

export function loadResearchShowcasePack(projectRoot?: string): ResearchShowcasePack {
  const root = projectRoot ?? defaultProjectRoot();
  const path = resolve(root, "config/research_showcase.yaml");
  const raw = readFileSync(path, "utf8");
  const doc = parseYaml(raw);
  return parseResearchShowcasePack(doc);
}

export function allShowcaseCompanies(pack: ResearchShowcasePack): ShowcaseCompanyTemplate[] {
  return [...pack.golden, ...pack.fromResumeDesk];
}

export function showcaseContentHash(companyKey: string, kind: string): string {
  return `showcase:v1:${companyKey}:${kind}`;
}
