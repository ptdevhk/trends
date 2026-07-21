/**
 * Pure industry entity resolve helpers (R1).
 * No network / LLM — deterministic only.
 */

export type BrandOrigin = "international" | "domestic" | "agent";

export type ResolveMatchTier =
  | "exact"
  | "alias"
  | "partial"
  | "keyword"
  | "miss";

export type ResolvedEntityKind = "brand" | "company";

export interface ResolveBrandSource {
  id: number;
  nameCn: string;
  nameEn?: string;
  type: string;
  origin: BrandOrigin;
  familyId?: string;
  aliases?: string[];
  productClass?: string;
}

export interface ResolveCompanySource {
  id: number;
  nameCn: string;
  nameEn?: string;
  type: string;
  category: string;
}

export interface ResolvedEntity {
  entityId: string;
  kind: ResolvedEntityKind;
  origin?: BrandOrigin | "unknown";
  familyId?: string;
  nameCn: string;
  nameEn?: string;
  type?: string;
  productClass?: string;
  confidence: number;
  matchTier: ResolveMatchTier;
  /** Canonical brand/company key used by ingest (EN slug when available). */
  canonicalKey: string;
}

export function normalizeSurface(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u00A0]+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

export function brandEntityId(brand: ResolveBrandSource): string {
  const en = brand.nameEn?.trim();
  if (en && /^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(en)) {
    return `brand:${en.toLowerCase().replace(/\s+/g, "-")}`;
  }
  return `brand:${brand.id}`;
}

export function brandCanonicalKey(brand: ResolveBrandSource): string {
  const en = brand.nameEn?.trim();
  if (en && /^[A-Za-z0-9]+$/.test(en) && /[A-Za-z]/.test(en)) {
    return en.toLowerCase();
  }
  const cn = brand.nameCn.trim();
  return normalizeSurface(cn) || String(brand.id);
}

export function companyEntityId(company: ResolveCompanySource): string {
  return `company:${company.id}`;
}

function brandAliasSurfaces(brand: ResolveBrandSource): string[] {
  const surfaces = [
    brand.nameCn,
    brand.nameEn,
    ...(brand.aliases ?? []),
  ]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  return surfaces;
}

/**
 * Resolve a free-text surface form against brands + companies.
 * Brand exact/alias wins over company; company exact over brand partial.
 */
export function resolveEntity(
  surface: string,
  brands: ResolveBrandSource[],
  companies: ResolveCompanySource[] = []
): ResolvedEntity {
  const raw = surface?.trim() ?? "";
  if (!raw) {
    return {
      entityId: "miss:empty",
      kind: "brand",
      confidence: 0,
      matchTier: "miss",
      nameCn: "",
      canonicalKey: "",
    };
  }

  const normalized = normalizeSurface(raw);

  // 1) Brand exact name or alias
  for (const brand of brands) {
    for (const alias of brandAliasSurfaces(brand)) {
      if (normalizeSurface(alias) === normalized) {
        const isPrimary =
          normalizeSurface(brand.nameCn) === normalized ||
          (brand.nameEn && normalizeSurface(brand.nameEn) === normalized);
        return {
          entityId: brandEntityId(brand),
          kind: "brand",
          origin: brand.origin,
          familyId: brand.familyId,
          nameCn: brand.nameCn,
          nameEn: brand.nameEn,
          type: brand.type,
          productClass: brand.productClass,
          confidence: isPrimary ? 1 : 0.95,
          matchTier: isPrimary ? "exact" : "alias",
          canonicalKey: brandCanonicalKey(brand),
        };
      }
    }
  }

  // 2) Company exact CN/EN
  for (const company of companies) {
    const cn = normalizeSurface(company.nameCn);
    const en = company.nameEn ? normalizeSurface(company.nameEn) : "";
    if (cn === normalized || (en && en === normalized)) {
      const enKey = company.nameEn?.trim();
      const canonicalKey =
        enKey && /^[A-Za-z0-9]+$/.test(enKey) && /[A-Za-z]/.test(enKey)
          ? enKey.toLowerCase()
          : normalizeSurface(company.nameCn) || String(company.id);
      return {
        entityId: companyEntityId(company),
        kind: "company",
        nameCn: company.nameCn,
        nameEn: company.nameEn,
        type: company.type,
        confidence: 1,
        matchTier: "exact",
        canonicalKey,
      };
    }
  }

  // 3) Brand partial: surface contains brand surface or vice-versa (min length 2)
  let bestPartial: ResolvedEntity | null = null;
  for (const brand of brands) {
    for (const alias of brandAliasSurfaces(brand)) {
      const a = normalizeSurface(alias);
      if (a.length < 2) continue;
      if (normalized.includes(a) || a.includes(normalized)) {
        const shorter = Math.min(a.length, normalized.length);
        const longer = Math.max(a.length, normalized.length);
        if (shorter < 2) continue;
        const ratio = shorter / longer;
        if (ratio < 0.4 && shorter < 3) continue;
        const candidate: ResolvedEntity = {
          entityId: brandEntityId(brand),
          kind: "brand",
          origin: brand.origin,
          familyId: brand.familyId,
          nameCn: brand.nameCn,
          nameEn: brand.nameEn,
          type: brand.type,
          productClass: brand.productClass,
          confidence: Math.min(0.85, 0.5 + ratio * 0.4),
          matchTier: "partial",
          canonicalKey: brandCanonicalKey(brand),
        };
        if (!bestPartial || candidate.confidence > bestPartial.confidence) {
          bestPartial = candidate;
        }
      }
    }
  }
  if (bestPartial) return bestPartial;

  return {
    entityId: `miss:${normalized || "unknown"}`,
    kind: "brand",
    confidence: 0.1,
    matchTier: "miss",
    nameCn: raw,
    canonicalKey: normalized,
  };
}

/** Collect brands that share a familyId (e.g. JTEKT/TOYODA cluster). */
export function brandsInFamily(
  brands: ResolveBrandSource[],
  familyId: string
): ResolveBrandSource[] {
  return brands.filter((b) => b.familyId === familyId);
}
