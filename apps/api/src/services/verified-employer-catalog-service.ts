/**
 * Verified-employer catalog for the keyword-expansion bridge.
 *
 * Read-only feed of canonical companies whose current governed verdict is
 * `verified`. Used by UnifiedSearchService to inject employer names/aliases
 * into industry-scoped keyword groups so evidence-verified candidates
 * surface in industry keyword searches.
 *
 * Degrades silently to an empty catalog when Convex is unreachable — the
 * expansion then behaves exactly as before (synonyms only).
 */

import { isRecord } from "@trends/shared";

import { callConvexQuery } from "./convex-utils.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type {
  VerifiedEmployerCatalog,
  VerifiedIndustryEmployer,
} from "./unified-search-service.js";

const CACHE_TTL_MS = 60_000;
const MAX_ROWS = 500;

function parseEmployer(value: unknown): VerifiedIndustryEmployer | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.companyKey !== "string" ||
    typeof value.industryClass !== "string" ||
    typeof value.displayName !== "string" ||
    !Array.isArray(value.aliases) ||
    typeof value.updatedAt !== "number"
  ) {
    return null;
  }
  return {
    companyKey: value.companyKey.trim().toLowerCase(),
    industryClass: value.industryClass.trim().toLowerCase(),
    displayName: value.displayName,
    aliases: value.aliases.filter(
      (alias): alias is string => typeof alias === "string" && alias.trim().length > 0,
    ),
    updatedAt: value.updatedAt,
  };
}

export class ConvexVerifiedEmployerCatalog implements VerifiedEmployerCatalog {
  private cache: { at: number; employers: VerifiedIndustryEmployer[] } | null = null;

  getVerifiedEmployers(): VerifiedIndustryEmployer[] {
    const cached = this.cache;
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.employers;
    }
    // Synchronous consumer: trigger an async refresh; this call uses the
    // previous (possibly empty) snapshot. First call after process start
    // returns empty until warmCatalog() completes at startup.
    void this.refresh();
    return cached?.employers ?? [];
  }

  /** Eagerly load/refresh the catalog (called once at service startup). */
  async warm(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<VerifiedIndustryEmployer[]> {
    try {
      const value = await callConvexQuery(
        "companies:listVerifiedIndustryEmployerAliases",
        { writeSecret: config.auth.convexWriteSecret },
      );
      if (!Array.isArray(value)) {
        throw new Error(
          "Invalid companies:listVerifiedIndustryEmployerAliases response",
        );
      }
      const employers = value
        .map(parseEmployer)
        .filter((item): item is VerifiedIndustryEmployer => item !== null)
        .slice(0, MAX_ROWS);
      if (value.length > MAX_ROWS) {
        logger.warn("Verified employer catalog truncated", {
          rows: value.length,
          cap: MAX_ROWS,
        });
      }
      this.cache = { at: Date.now(), employers };
      return employers;
    } catch (error) {
      logger.warn("Verified employer catalog degraded; bridge disabled", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.cache?.employers ?? [];
    }
  }
}

export const verifiedEmployerCatalog = new ConvexVerifiedEmployerCatalog();
