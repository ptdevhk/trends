import { IndustryDataService, type BrandEntry } from "./industry-data-service.js";
import { SkillsKnowledgeService, type CompanyPattern } from "./skills-knowledge.js";

export type BrandDisplayItem = {
  displayName: string;
  zhHans: string;
};

const HAS_HAN_RE = /\p{Script=Han}/u;

function normalizeBrandId(value: string): string {
  return value.trim().toLowerCase();
}

function pickPreferredZhHansAlias(aliases: string[]): string | null {
  const candidates = aliases
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0 && HAS_HAN_RE.test(alias));
  if (candidates.length === 0) {
    return null;
  }

  // Prefer shorter names (e.g. 精雕 vs 北京精雕) while keeping input order stable for ties.
  const indexed = candidates.map((value, idx) => ({ value, idx }));
  indexed.sort((left, right) => {
    if (left.value.length !== right.value.length) {
      return left.value.length - right.value.length;
    }
    return left.idx - right.idx;
  });
  return indexed[0]?.value ?? null;
}

function buildBrandsByNameEn(brands: BrandEntry[]): Map<string, BrandEntry> {
  const map = new Map<string, BrandEntry>();
  for (const brand of brands) {
    const nameEn = brand.nameEn?.trim();
    if (!nameEn) continue;
    map.set(nameEn.toLowerCase(), brand);
  }
  return map;
}

function resolveZhHansForPattern(
  pattern: CompanyPattern,
  brandsByNameEn: Map<string, BrandEntry>
): string {
  const displayName = pattern.displayName.trim();
  if (displayName && HAS_HAN_RE.test(displayName)) {
    return displayName;
  }

  const aliasCandidate = pickPreferredZhHansAlias(pattern.displayAliases);
  const brandCandidate = brandsByNameEn.get(displayName.toLowerCase())?.nameCn?.trim() || null;

  if (aliasCandidate && brandCandidate) {
    // If both sources provide zh-Hans, prefer the shorter (more UI-friendly) label.
    return aliasCandidate.length <= brandCandidate.length ? aliasCandidate : brandCandidate;
  }

  return aliasCandidate || brandCandidate || displayName || pattern.name;
}

export class BrandDisplayResolver {
  private readonly map: Map<string, BrandDisplayItem>;

  constructor(projectRoot?: string) {
    const skillsService = new SkillsKnowledgeService(projectRoot);
    const industryService = new IndustryDataService(projectRoot);

    const patterns = skillsService.getCompanyPatterns();
    const brandsByNameEn = buildBrandsByNameEn(industryService.loadBrands());

    const map = new Map<string, BrandDisplayItem>();
    for (const pattern of patterns) {
      const brandId = normalizeBrandId(pattern.name);
      if (!brandId) continue;

      const displayName = pattern.displayName.trim() || pattern.name;
      const zhHans = resolveZhHansForPattern(pattern, brandsByNameEn);
      map.set(brandId, { displayName, zhHans });
    }

    this.map = map;
  }

  resolveZhHans(brandId: string): string {
    const normalized = normalizeBrandId(brandId);
    if (!normalized) {
      return "";
    }
    return this.map.get(normalized)?.zhHans ?? brandId.toUpperCase();
  }

  toJSON(): Record<string, BrandDisplayItem> {
    const obj: Record<string, BrandDisplayItem> = {};
    for (const [brandId, value] of this.map.entries()) {
      obj[brandId] = value;
    }
    return obj;
  }
}

