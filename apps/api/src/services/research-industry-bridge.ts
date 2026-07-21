/**
 * Industry-data → research adapter bridge.
 * Pure projection: resolveEntity inventory → research companyKey + nameCn-first DTO.
 * Identity: new keys use canonicalKey; legacy pro-technic-machinery / polywell via overrides.
 */

import {
  brandCanonicalKey,
  resolveEntity,
  type ResolveBrandSource,
  type ResolveCompanySource,
  type ResolvedEntity,
} from "./industry-entity-resolve.js";

/** Existing K3 keys that must not be force-renamed (policy + prior showcase). */
export type LegacyCompanyOverride = {
  companyKey: string;
  nameCn: string;
  nameEn?: string;
  surfaces: string[];
  type?: string;
};

export const LEGACY_COMPANY_OVERRIDES: LegacyCompanyOverride[] = [
  {
    companyKey: "pro-technic-machinery",
    nameCn: "宝力机械",
    nameEn: "Pro-Technic Machinery",
    type: "金属切削机床",
    surfaces: ["宝力机械", "宝力机械有限公司", "Pro-Technic", "Pro-Technic Machinery"],
  },
  {
    companyKey: "polywell",
    nameCn: "宝惠",
    nameEn: "Polywell",
    type: "金属切削机床",
    surfaces: ["宝惠", "Polywell", "Polywell Machinery"],
  },
];

const CNC_TYPE_RE = /加工中心|数控|机床|火花|走心|线切割|车床|测量|刀塔|数控系统/;

export type BridgeEntity = {
  companyKey: string;
  nameCn: string;
  nameEn?: string;
  /** nameCn primary; "nameCn / nameEn" when EN present */
  displayName: string;
  entityId: string;
  kind: "brand" | "company" | "override";
  origin?: string;
  type?: string;
  aliases: string[];
  cnc: boolean;
};

export type BridgeResolveHit = {
  companyKey: string;
  nameCn: string;
  nameEn?: string;
  displayName: string;
  matchTier: string;
  entityId?: string;
  source: "override" | "resolveEntity";
};

export function displayNameCnFirst(nameCn: string, nameEn?: string): string {
  const cn = nameCn.trim();
  const en = nameEn?.trim();
  if (cn && en) {
    return `${cn} / ${en}`;
  }
  return cn || en || "";
}

export function isCncType(type?: string): boolean {
  if (!type || !type.trim()) {
    return false;
  }
  return CNC_TYPE_RE.test(type);
}

function normalizeSurfaceKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u00A0]+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

/** Lookup legacy override by free-text surface (exact after normalize). */
export function findLegacyOverride(surface: string): LegacyCompanyOverride | null {
  const key = normalizeSurfaceKey(surface);
  if (!key) {
    return null;
  }
  for (const row of LEGACY_COMPANY_OVERRIDES) {
    for (const s of row.surfaces) {
      if (normalizeSurfaceKey(s) === key) {
        return row;
      }
    }
    if (normalizeSurfaceKey(row.companyKey) === key) {
      return row;
    }
    if (normalizeSurfaceKey(row.nameCn) === key) {
      return row;
    }
    if (row.nameEn && normalizeSurfaceKey(row.nameEn) === key) {
      return row;
    }
  }
  return null;
}

export function projectLegacyOverride(row: LegacyCompanyOverride): BridgeEntity {
  return {
    companyKey: row.companyKey,
    nameCn: row.nameCn,
    ...(row.nameEn ? { nameEn: row.nameEn } : {}),
    displayName: displayNameCnFirst(row.nameCn, row.nameEn),
    entityId: `override:${row.companyKey}`,
    kind: "override",
    type: row.type,
    aliases: [...row.surfaces],
    cnc: true,
  };
}

export function projectBrandToBridge(brand: ResolveBrandSource): BridgeEntity {
  const companyKey = brandCanonicalKey(brand);
  const aliases = [
    brand.nameCn,
    ...(brand.nameEn ? [brand.nameEn] : []),
    ...(brand.aliases ?? []),
  ].filter((a) => typeof a === "string" && a.trim().length > 0);
  return {
    companyKey,
    nameCn: brand.nameCn,
    ...(brand.nameEn ? { nameEn: brand.nameEn } : {}),
    displayName: displayNameCnFirst(brand.nameCn, brand.nameEn),
    entityId: brand.nameEn
      ? `brand:${brand.nameEn.toLowerCase().replace(/\s+/g, "-")}`
      : `brand:${brand.id}`,
    kind: "brand",
    origin: brand.origin,
    type: brand.type,
    aliases,
    cnc: isCncType(brand.type),
  };
}

/**
 * Map free-text mention → research companyKey.
 * Overrides first (宝力→pro-technic-machinery), then resolveEntity.canonicalKey.
 * Miss / empty → null (do not invent keys from weak miss).
 */
export function mapSurfaceToResearchCompany(
  surface: string,
  brands: ResolveBrandSource[],
  companies: ResolveCompanySource[] = [],
): BridgeResolveHit | null {
  const raw = surface?.trim() ?? "";
  if (!raw) {
    return null;
  }

  const override = findLegacyOverride(raw);
  if (override) {
    return {
      companyKey: override.companyKey,
      nameCn: override.nameCn,
      ...(override.nameEn ? { nameEn: override.nameEn } : {}),
      displayName: displayNameCnFirst(override.nameCn, override.nameEn),
      matchTier: "override",
      entityId: `override:${override.companyKey}`,
      source: "override",
    };
  }

  const resolved: ResolvedEntity = resolveEntity(raw, brands, companies);
  if (resolved.matchTier === "miss" || !resolved.canonicalKey) {
    return null;
  }

  return {
    companyKey: resolved.canonicalKey,
    nameCn: resolved.nameCn,
    ...(resolved.nameEn ? { nameEn: resolved.nameEn } : {}),
    displayName: displayNameCnFirst(resolved.nameCn, resolved.nameEn),
    matchTier: resolved.matchTier,
    entityId: resolved.entityId,
    source: "resolveEntity",
  };
}

export function filterBridgeEntities(entities: BridgeEntity[], q: string): BridgeEntity[] {
  const raw = q.trim().toLowerCase();
  if (!raw) return entities;
  const norm = raw.replace(/[\s\u00A0]+/g, "");
  return entities.filter((e) => {
    const hay = [
      e.companyKey,
      e.nameCn,
      e.nameEn ?? "",
      e.displayName,
      ...e.aliases,
    ]
      .join(" ")
      .toLowerCase()
      .replace(/[\s\u00A0]+/g, "");
    return hay.includes(norm) || hay.includes(raw);
  });
}

/**
 * CNC-first browse inventory: legacy overrides + CNC brands.
 * Overrides win on companyKey collision.
 */
export function listCncBridgeEntities(
  brands: ResolveBrandSource[],
  _companies: ResolveCompanySource[] = [],
  options?: { limit?: number; includeNonCnc?: boolean; q?: string },
): BridgeEntity[] {
  const byKey = new Map<string, BridgeEntity>();

  for (const row of LEGACY_COMPANY_OVERRIDES) {
    const entity = projectLegacyOverride(row);
    byKey.set(entity.companyKey, entity);
  }

  for (const brand of brands) {
    if (!options?.includeNonCnc && !isCncType(brand.type)) {
      continue;
    }
    const entity = projectBrandToBridge(brand);
    if (byKey.has(entity.companyKey)) {
      continue;
    }
    // Do not overwrite override keys if brandCanonicalKey collides
    byKey.set(entity.companyKey, entity);
  }

  let list = [...byKey.values()].sort((a, b) => a.nameCn.localeCompare(b.nameCn, "zh-CN"));
  // Filter before limit so q is not applied only to a truncated prefix.
  if (options?.q?.trim()) {
    list = filterBridgeEntities(list, options.q);
  }
  const limit = options?.limit;
  if (limit != null && limit > 0) {
    return list.slice(0, limit);
  }
  return list;
}

/** Default golden CNC seed companyKeys (canonical + legacy). */
export const DEFAULT_CNC_SEED_COMPANY_KEYS = [
  "pro-technic-machinery",
  "polywell",
  "fanuc",
  "mazak",
  "makino",
  "brother",
  "qiaofeng",
  "cgj",
] as const;
