import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Pulse keyword seed = industry database catalog, not just the YAML seed.
 *
 * v1 pulse stays a read-path filter on already-ingested NewsNow/RSS, but the
 * effective default keyword set is a runtime union of:
 *   - keyword-tags.json categories (enabled by default via YAML enabledGroupIds)
 *   - brands.json surfaces (nameCn / nameEn / aliases)
 *   - company names from keywords-structured.md (Key Companies / ITES / agents)
 *   - the YAML hiring-sales overlay (招聘 / 扩产 / 中标 / 采购 / 订单 / 签约)
 * minus the YAML `defaults.excludedKeywords` drop list.
 *
 * Keep the YAML file as the curated category catalog (it already mirrors
 * keyword-tags.json 1:1) and only augment defaults at load time so we do NOT
 * hand-copy 400+ names into YAML.
 *
 * Owner decision 2026-09-19 ("exclude_conglomerates_keep_cnc"): matching is
 * substring (OR) on title/snippet, so famous-conglomerate / generic short
 * surfaces (三菱, 松下, 西部, 山善, …) drown the pulse in unrelated business news.
 * They are removed from the DEFAULT set only. The full catalog keeps them —
 * brands.json / keyword-tags.json are untouched, and the `industry-catalog`
 * group below still exposes every dropped surface, so the catalog (and the
 * workspace `enabled` overlay) remains the re-enable source.
 */

/** Same contract as MAX_KEYWORD_LENGTH in research-pulse-keywords.ts (kept local to avoid a circular import). */
const MAX_KEYWORD_LENGTH = 32;

/**
 * Catalog group exposed alongside the YAML groups. It holds the FULL industry
 * catalog (brand + company surfaces) and deliberately keeps the surfaces the
 * default set excludes, so a re-enable source survives. It is not listed in
 * `defaults.enabledGroupIds` (that list stays purely YAML-curated): the catalog
 * is folded into defaultKeywords directly by loadResearchPulseKeywordsSeed and
 * then filtered by the exclusion list. The 管理关键词 dialog offers the catalog
 * surfaces that are not already in defaults as a re-enable checkbox list, and
 * the workspace `enabled` overlay (mergePulseKeywords / PUT) is the effective
 * re-enable mechanism.
 */
export const PULSE_CATALOG_GROUP_ID = "industry-catalog";
const PULSE_CATALOG_GROUP_LABEL = "行业全量目录";

export type PulseKeywordGroup = {
  id: string;
  label: string;
  keywords: string[];
};

export type PulseKeywordsSeed = {
  version: string;
  groups: PulseKeywordGroup[];
  defaultKeywords: string[];
  /**
   * `defaults.excludedKeywords` — exact-token drop list applied to defaults only.
   * The full catalog (and every group) keeps these surfaces, so they stay
   * re-enableable via the workspace `enabled` overlay.
   */
  excludedKeywords: string[];
};

function parseGroup(raw: unknown, label: string): PulseKeywordGroup {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid pulse keyword group in ${label}`);
  }
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const groupLabel = typeof row.label === "string" ? row.label.trim() : "";
  if (!id || !groupLabel) {
    throw new Error(`Pulse keyword group in ${label} requires id and label`);
  }
  const keywordsRaw = Array.isArray(row.keywords) ? row.keywords : [];
  const keywords = keywordsRaw
    .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    .map((k) => k.trim());
  if (keywords.length === 0) {
    throw new Error(`Pulse keyword group ${id} needs at least one keyword`);
  }
  return { id, label: groupLabel, keywords };
}

export function parseResearchPulseKeywordsSeed(doc: unknown): PulseKeywordsSeed {
  if (!doc || typeof doc !== "object") {
    throw new Error("Pulse keywords seed must be an object");
  }
  const root = doc as Record<string, unknown>;
  const version = typeof root.version === "string" && root.version.trim() ? root.version.trim() : "v1";
  const groups = (Array.isArray(root.groups) ? root.groups : []).map((g, i) =>
    parseGroup(g, `groups[${i}]`),
  );
  if (groups.length === 0) {
    throw new Error("Pulse keywords seed requires at least one group");
  }

  const defaults =
    root.defaults && typeof root.defaults === "object"
      ? (root.defaults as Record<string, unknown>)
      : {};
  const enabledGroupIds = Array.isArray(defaults.enabledGroupIds)
    ? defaults.enabledGroupIds
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
    : groups.map((g) => g.id);
  const excludedKeywords = readExcludedKeywords(defaults);
  const dropped = new Set(excludedKeywords.map(seedNormalizeKeyword));

  const byId = new Map(groups.map((g) => [g.id, g]));
  const defaultKeywords: string[] = [];
  const seen = new Set<string>();
  for (const groupId of enabledGroupIds) {
    const group = byId.get(groupId);
    if (!group) {
      throw new Error(`Pulse keywords defaults.enabledGroupIds references unknown group: ${groupId}`);
    }
    for (const kw of group.keywords) {
      const norm = seedNormalizeKeyword(kw);
      if (dropped.has(norm)) continue;
      // Unique by normalized identity in seed order (CJK identity; Latin lowercased)
      if (seen.has(norm)) continue;
      seen.add(norm);
      defaultKeywords.push(kw);
    }
  }
  if (defaultKeywords.length === 0) {
    throw new Error("Pulse keywords seed defaultKeywords must be non-empty");
  }

  return { version, groups, defaultKeywords, excludedKeywords };
}

/**
 * Read `defaults.excludedKeywords` — the exact-token, default-only drop list from the
 * 2026-09-19 owner decision. Kept as display strings on the seed so
 * loadResearchPulseKeywordsSeed can apply the same exclusion to appended catalog
 * surfaces with the matching (NFKC + Latin-lowercase) identity.
 */
function readExcludedKeywords(defaults: Record<string, unknown>): string[] {
  return Array.isArray(defaults.excludedKeywords)
    ? defaults.excludedKeywords
        .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
        .map((k) => k.trim())
    : [];
}

/**
 * Path-agnostic industry-data catalog reader used to build the runtime union.
 * Keep this decoupled from IndustryDataService so the pack module does not
 * import resume-ingest machinery.
 */
function loadIndustryCatalog(projectRoot: string): {
  surfaces: string[];
} {
  const dir = resolve(projectRoot, "config", "industry-data");
  const surfaces: string[] = [];

  // brands.json: nameCn + nameEn + aliases (display order: brand order, CN first)
  try {
    const raw = JSON.parse(readFileSync(resolve(dir, "brands.json"), "utf8")) as unknown;
    if (Array.isArray(raw)) {
      for (const entry of raw as Record<string, unknown>[]) {
        for (const field of ["nameCn", "nameEn"]) {
          const v = entry?.[field];
          if (typeof v === "string" && v.trim()) surfaces.push(v.trim());
        }
        const aliases = entry?.aliases;
        if (Array.isArray(aliases)) {
          for (const a of aliases) {
            if (typeof a === "string" && a.trim()) surfaces.push(a.trim());
          }
        }
      }
    }
  } catch {
    // brands.json missing/parse error → fall back to no brands; do not fail hard.
  }

  // keywords-structured.md company tables (Key Companies / ITES / agents).
  // Mirrors IndustryDataService.loadCompanies section selection so the union
  // matches what the industry bridge browses, without importing that service.
  try {
    const md = readFileSync(resolve(dir, "keywords-structured.md"), "utf8");
    for (const section of extractCompanySections(md)) {
      surfaces.push(...section.names);
    }
  } catch {
    // Markdown missing → fall back to no companies; do not fail hard.
  }

  return { surfaces };
}

type CompanySection = { names: string[] };

/**
 * Minimal markdown table extractor for the company tables we care about
 * (重点企业 / Key Companies, ITES 参展商, 进口代理商 / agents). Only emits the
 * company-name column. Reimplements the small slice of extractTablesFromMarkdown
 * we need so the pack module stays self-contained.
 */
function extractCompanySections(content: string): CompanySection[] {
  const lines = content.split("\n");
  const sections: Array<CompanySection & { heading: string }> = [];
  let currentSection = "";
  const headingStack: Array<string | undefined> = [];
  let tableLines: string[] = [];
  let inTable = false;

  const flush = () => {
    if (tableLines.length > 0) {
      sections.push({ heading: currentSection, names: companyNamesFromTableLines(tableLines) });
      tableLines = [];
    }
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,6})\s+(.*)$/);
    if (headingMatch) {
      flush();
      const level = headingMatch[1].length;
      headingStack[level] = headingMatch[2].trim();
      for (let i = level + 1; i < headingStack.length; i += 1) headingStack[i] = undefined;
      const parts: string[] = [];
      for (let i = 2; i < headingStack.length; i += 1) {
        const part = headingStack[i];
        if (part) parts.push(part);
      }
      currentSection = parts.join(" / ");
      inTable = false;
    } else if (line.includes("|") && line.trim().startsWith("|")) {
      inTable = true;
      tableLines.push(line);
    } else if (inTable && line.includes("|")) {
      tableLines.push(line);
    } else if (inTable && !line.includes("|")) {
      flush();
      inTable = false;
    }
  }
  flush();

  // Only keep table sections that are company lists.
  return sections
    .filter(
      (s) =>
        currentIsCompanyHeading(s.heading) ||
        s.names.some((n) => /公司|机械|机床|有限|集团|设备|精机|测量|仪器/.test(n)),
    )
    .map((s) => ({ names: s.names }));
}

function companyNamesFromTableLines(tableLines: string[]): string[] {
  if (tableLines.length < 3) return [];
  const headers = tableLines[0]!
    .split("|")
    .map((h) => h.trim())
    .filter(Boolean);
  const dataRows = tableLines.slice(2);
  const out: string[] = [];
  for (const row of dataRows) {
    const cells = row
      .split("|")
      .map((c) => c.trim())
      .filter((_, i) => i > 0);
    const name = headers.includes("代理商名称 (Agent Name)")
      ? (cells[headers.indexOf("代理商名称 (Agent Name)")] ?? cells[0] ?? "")
      : headers.includes("公司名称 (Company Name)")
        ? (cells[headers.indexOf("公司名称 (Company Name)")] ?? "")
        : "";
    if (name) out.push(name);
  }
  return out;
}

function currentIsCompanyHeading(section: string): boolean {
  return (
    /重点企业|Key Companies|ITES|参展商|代理商|Agent/.test(section)
  );
}

function defaultProjectRoot(): string {
  const cwd = resolve(process.cwd());
  try {
    readFileSync(resolve(cwd, "config/research_pulse_keywords.yaml"), "utf8");
    return cwd;
  } catch {
    const candidate = resolve(cwd, "../..");
    try {
      readFileSync(resolve(candidate, "config/research_pulse_keywords.yaml"), "utf8");
      return candidate;
    } catch {
      return cwd;
    }
  }
}

export function loadResearchPulseKeywordsSeed(projectRoot?: string): PulseKeywordsSeed {
  const root = projectRoot ?? defaultProjectRoot();
  const path = resolve(root, "config/research_pulse_keywords.yaml");
  const raw = readFileSync(path, "utf8");
  const doc = parseYaml(raw);
  const seed = parseResearchPulseKeywordsSeed(doc);

  // Runtime union with the industry database catalog. YAML `defaults.enabledGroupIds`
  // already includes all six tag categories (machining/lathe/edm/measurement/smt/3d-printing);
  // we append brand surfaces + company names so the pulse defaults reflect the full catalog
  // without hand-copying 400+ names into YAML.
  //
  // Defaults are exact-token filtered by `defaults.excludedKeywords`. The catalog GROUP keeps
  // every surface (including the excluded ones) so they stay re-enableable; only
  // defaultKeywords is filtered.
  const { surfaces } = loadIndustryCatalog(root);
  const catalog = dedupKeywords(surfaces, MAX_KEYWORD_LENGTH);
  const dropped = new Set(seed.excludedKeywords.map(seedNormalizeKeyword));
  // Catalog group keeps every surface (incl. dropped ones). Only the appended
  // defaults are exact-token filtered, so excluded tokens do not seed defaults.
  const appended = dedupKeywords(
    catalog.filter((s) => !dropped.has(seedNormalizeKeyword(s))),
    MAX_KEYWORD_LENGTH,
    seed.defaultKeywords,
  );
  const groups: PulseKeywordGroup[] = [...seed.groups];
  if (catalog.length > 0) {
    groups.push({ id: PULSE_CATALOG_GROUP_ID, label: PULSE_CATALOG_GROUP_LABEL, keywords: catalog });
  }
  return { ...seed, groups, defaultKeywords: appended };
}

/**
 * Dedupe + length-cap a surface list, preserving order.
 * An empty `seed` (or a pre-deduped `extra`) is the caller's way to reuse the
 * same identity+length policy for a raw list only — both halves share one policy.
 */
function dedupKeywords(raw: string[], maxLength: number, seed: string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    const norm = seedNormalizeKeyword(t);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    out.push(t.trim());
  };
  for (const kw of seed) {
    const t = kw.trim();
    if (t) push(t);
  }
  for (const value of raw) {
    const t = value.trim();
    if (!t || [...t].length > maxLength) continue;
    push(t);
  }
  return out;
}

/** Same identity as normalizePulseKeyword (trim + NFKC + Latin lowercase). */
function seedNormalizeKeyword(k: string): string {
  const nfkc = k.trim().normalize("NFKC");
  return nfkc.replace(/[A-Za-z]+/g, (m) => m.toLowerCase());
}
