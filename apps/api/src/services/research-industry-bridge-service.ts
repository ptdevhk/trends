/**
 * I/O facade: industry-data loaders → research bridge DTOs.
 */

import { IndustryDataService } from "./industry-data-service.js";
import {
  listCncBridgeEntities,
  mapSurfaceToResearchCompany,
  type BridgeEntity,
  type BridgeResolveHit,
} from "./research-industry-bridge.js";

const defaultService = new IndustryDataService();

export function listResearchIndustryBrowse(options?: {
  limit?: number;
  includeNonCnc?: boolean;
  industry?: IndustryDataService;
}): BridgeEntity[] {
  const industry = options?.industry ?? defaultService;
  const brands = industry.loadBrands();
  const companies = industry.loadAll().companies;
  return listCncBridgeEntities(brands, companies, {
    limit: options?.limit ?? 60,
    includeNonCnc: options?.includeNonCnc,
  });
}

export function resolveResearchCompanySurface(
  surface: string,
  industry: IndustryDataService = defaultService,
): BridgeResolveHit | null {
  const brands = industry.loadBrands();
  const companies = industry.loadAll().companies;
  return mapSurfaceToResearchCompany(surface, brands, companies);
}
