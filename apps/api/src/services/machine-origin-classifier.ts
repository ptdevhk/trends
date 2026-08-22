import { isRecord, type MachineOrigin } from "@trends/shared";
import { config } from "./config.js";
import { callConvexQuery } from "./convex-utils.js";
import {
  IndustryDataService,
  type BrandEntry,
  type CompanyEntry,
} from "./industry-data-service.js";
import {
  resolveEntity,
  type ResolveBrandSource,
  type ResolveCompanySource,
} from "./industry-entity-resolve.js";
import { logger } from "./logger.js";
import type { ResumeIngestBrandHit, ResumeItem, ResumeWorkHistoryItem } from "../types/resume.js";
import { extractCompanyFromWorkHistory } from "./work-history.js";

export interface VerifiedCompanyProfileSummary {
  companyKey: string;
  machineOrigin: MachineOrigin;
  industryClass?: string;
  updatedAt?: number;
}

export type MachineOriginResolutionTier = "tier1_verified" | "tier2_surface" | "tier3_brand_hits";

export interface MachineOriginClassification {
  machineOrigin: MachineOrigin;
  tier: MachineOriginResolutionTier;
  matchedKey?: string;
}

/**
 * Maps resolveEntity origin ('agent' | 'international' | 'domestic') to MachineOrigin.
 * 'agent' -> 'international'
 * 'international' -> 'international'
 * 'domestic' -> 'domestic'
 */
export function mapBrandOriginToMachineOrigin(origin: string | undefined): MachineOrigin | null {
  if (origin === "agent" || origin === "international") {
    return "international";
  }
  if (origin === "domestic") {
    return "domestic";
  }
  return null;
}

export async function fetchVerifiedCompanyProfiles(
  keys: string[],
): Promise<Map<string, VerifiedCompanyProfileSummary>> {
  const map = new Map<string, VerifiedCompanyProfileSummary>();
  const normalizedKeys = Array.from(
    new Set(
      keys
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean),
    ),
  ).slice(0, 200);

  if (normalizedKeys.length === 0) {
    return map;
  }

  try {
    const value = await callConvexQuery("companies:listVerifiedCompanyProfiles", {
      keys: normalizedKeys,
      writeSecret: config.auth.convexWriteSecret,
    });

    if (Array.isArray(value)) {
      for (const item of value) {
        if (!isRecord(item)) continue;
        const companyKey = typeof item.companyKey === "string" ? item.companyKey.trim().toLowerCase() : "";
        const machineOrigin = typeof item.machineOrigin === "string" ? (item.machineOrigin as MachineOrigin) : undefined;
        if (
          companyKey &&
          machineOrigin &&
          machineOrigin !== "unknown" &&
          (machineOrigin === "international" || machineOrigin === "domestic")
        ) {
          map.set(companyKey, {
            companyKey,
            machineOrigin,
            industryClass: typeof item.industryClass === "string" ? item.industryClass : undefined,
            updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : undefined,
          });
        }
      }
    }
  } catch (error) {
    logger.warn("MachineOriginClassifier failed to load verified company profiles; failing open", {
      keys: normalizedKeys,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return map;
}

export class MachineOriginClassifier {
  private readonly brands: ResolveBrandSource[];
  private readonly companies: ResolveCompanySource[];

  constructor(
    brandsOrIndustryDataService?: ResolveBrandSource[] | IndustryDataService,
    companies: ResolveCompanySource[] = [],
  ) {
    if (brandsOrIndustryDataService instanceof IndustryDataService) {
      const data = brandsOrIndustryDataService.loadAll();
      this.brands = data.brands;
      this.companies = data.companies;
    } else if (Array.isArray(brandsOrIndustryDataService)) {
      this.brands = brandsOrIndustryDataService;
      this.companies = companies;
    } else {
      const defaultService = new IndustryDataService();
      const data = defaultService.loadAll();
      this.brands = data.brands;
      this.companies = data.companies;
    }
  }

  /**
   * Load verified profiles map for a batch of candidate company keys or resumes.
   */
  async loadVerifiedProfiles(
    keys: string[],
  ): Promise<Map<string, VerifiedCompanyProfileSummary>> {
    return fetchVerifiedCompanyProfiles(keys);
  }

  /**
   * Classify a single resume given an optional preloaded verified profiles map.
   *
   * Resolution precedence:
   * Tier 1 — Verified employer profile (companyKeyProjection.companyKeys -> first verified machineOrigin != unknown)
   * Tier 2 — Employer surface resolve (workHistory employer names -> resolveEntity; mixed -> unknown)
   * Tier 3 — brandHits fallback (ingestData.brandOrigin)
   */
  classify(
    resume: {
      workHistory?: ResumeWorkHistoryItem[] | null;
      companyKeyProjection?: { companyKeys?: string[] } | null;
      ingestData?: {
        brandOrigin?: string;
        brandHits?: ResumeIngestBrandHit[];
      } | null;
    },
    verifiedProfilesMap: Map<string, VerifiedCompanyProfileSummary> = new Map(),
  ): MachineOriginClassification {
    // -------------------------------------------------------------
    // Tier 1 — Verified employer profile
    // -------------------------------------------------------------
    const projectionKeys = resume.companyKeyProjection?.companyKeys ?? [];
    for (const rawKey of projectionKeys) {
      const key = rawKey.trim().toLowerCase();
      const profile = verifiedProfilesMap.get(key);
      if (profile && profile.machineOrigin && profile.machineOrigin !== "unknown") {
        return {
          machineOrigin: profile.machineOrigin,
          tier: "tier1_verified",
          matchedKey: key,
        };
      }
    }

    // -------------------------------------------------------------
    // Tier 2 — Employer surface resolve
    // -------------------------------------------------------------
    const workHistory = resume.workHistory ?? [];
    const employerSurfaces: string[] = [];
    for (const entry of workHistory) {
      if (!entry) continue;
      const companyName = entry.companyName?.trim() || extractCompanyFromWorkHistory(entry)?.trim();
      if (companyName) {
        employerSurfaces.push(companyName);
      }
    }

    const surfaceOrigins = new Set<MachineOrigin>();
    let lastMatchedKey: string | undefined;

    for (const surface of employerSurfaces) {
      const resolved = resolveEntity(surface, this.brands, this.companies);
      if (resolved.kind === "brand" && resolved.matchTier !== "miss" && resolved.origin) {
        const mapped = mapBrandOriginToMachineOrigin(resolved.origin);
        if (mapped) {
          surfaceOrigins.add(mapped);
          lastMatchedKey = resolved.canonicalKey;
        }
      }
    }

    if (surfaceOrigins.size === 1) {
      const [origin] = Array.from(surfaceOrigins);
      return {
        machineOrigin: origin,
        tier: "tier2_surface",
        matchedKey: lastMatchedKey,
      };
    } else if (surfaceOrigins.size > 1) {
      // Mixed domestic and international employers -> unknown
      return {
        machineOrigin: "unknown",
        tier: "tier2_surface",
      };
    }

    // -------------------------------------------------------------
    // Tier 3 — brandHits fallback
    // -------------------------------------------------------------
    const brandOrigin = resume.ingestData?.brandOrigin;
    if (brandOrigin === "international" || brandOrigin === "domestic") {
      return {
        machineOrigin: brandOrigin,
        tier: "tier3_brand_hits",
      };
    }

    return {
      machineOrigin: "unknown",
      tier: "tier3_brand_hits",
    };
  }
}
