import { IndustryDataService, type BrandEntry } from "./industry-data-service.js";
import {
  SkillsKnowledgeService,
  buildCompanyPatternAliasLookup,
  normalizeCompanyPatternIdentifier,
} from "./skills-knowledge.js";

export type BrandDisplayEntry = {
  displayName: string;
  zhHans: string;
};

function hasChinese(value: string): boolean {
  // Basic CJK Unified Ideographs range; sufficient for our alias data.
  return /[\u4e00-\u9fff]/u.test(value);
}

function normalizeBrandId(value: string): string {
  return normalizeCompanyPatternIdentifier(value);
}

function pickPreferredZhHansFromAliases(aliases: string[]): string | null {
  const candidates = aliases.map((alias) => alias.trim()).filter((alias) => alias && hasChinese(alias));
  if (candidates.length === 0) return null;

  // Prefer the shortest Chinese alias ("精雕" over "北京精雕", "德马吉" over "德马吉森精机").
  let best = candidates[0]!;
  for (const candidate of candidates) {
    if (candidate.length < best.length) best = candidate;
  }
  return best;
}

function brandEntryToDisplay(brand: BrandEntry): BrandDisplayEntry {
  const displayName = brand.nameEn?.trim() || brand.nameCn.trim();
  return { displayName, zhHans: brand.nameCn.trim() };
}

export class BrandDisplayResolver {
  private readonly map: Map<string, BrandDisplayEntry>;

  constructor(projectRoot: string, companyPatterns?: ReturnType<SkillsKnowledgeService["getCompanyPatterns"]>) {
    const skills = new SkillsKnowledgeService(projectRoot);
    const industry = new IndustryDataService(projectRoot);

    const patterns = companyPatterns ?? skills.getCompanyPatterns();
    const brands = industry.loadBrands();

    this.map = new Map<string, BrandDisplayEntry>();

    const aliasLookup = buildCompanyPatternAliasLookup(patterns);
    const brandsByEn = new Map<string, BrandDisplayEntry>();
    for (const brand of brands) {
      const nameEn = typeof brand.nameEn === "string" ? brand.nameEn.trim() : "";
      if (!nameEn) continue;
      brandsByEn.set(normalizeBrandId(nameEn), brandEntryToDisplay(brand));
    }

    // Seed mapping from brands.json so purely-industry brands resolve even if skills.md is missing an entry.
    for (const brand of brands) {
      const nameEn = typeof brand.nameEn === "string" ? brand.nameEn.trim() : "";
      if (!nameEn) continue;
      const brandId = normalizeBrandId(nameEn);
      this.map.set(brandId, brandEntryToDisplay(brand));
    }

    // Overlay skills.md company patterns (preferred source for stable IDs + alias selection).
    for (const pattern of patterns) {
      const brandId = aliasLookup.get(normalizeBrandId(pattern.name)) ?? normalizeBrandId(pattern.name);
      if (!brandId) continue;

      const displayName = pattern.displayName.trim() || pattern.name.trim();
      const preferredZh = pickPreferredZhHansFromAliases(pattern.displayAliases);
      const brandFallback = brandsByEn.get(normalizeBrandId(displayName));

      const zhHans = preferredZh
        ?? (hasChinese(displayName) ? displayName : null)
        ?? brandFallback?.zhHans
        ?? displayName;

      this.map.set(brandId, { displayName, zhHans });
    }
  }

  resolveZhHans(brandId: string): string {
    const raw = typeof brandId === "string" ? brandId : "";
    const normalized = normalizeBrandId(raw);
    if (!normalized) return "";

    const entry = this.map.get(normalized);
    if (entry) return entry.zhHans || entry.displayName || raw.toUpperCase();

    // Domestic/unknown brands may already be Chinese in stored IDs.
    if (hasChinese(raw)) return raw.trim();

    // Preserve prior UI/export behavior for unknowns.
    return raw.trim().toUpperCase();
  }

  toJSON(): Record<string, BrandDisplayEntry> {
    const out: Record<string, BrandDisplayEntry> = {};
    for (const [brandId, entry] of this.map.entries()) {
      out[brandId] = { displayName: entry.displayName, zhHans: entry.zhHans };
    }
    return out;
  }
}

