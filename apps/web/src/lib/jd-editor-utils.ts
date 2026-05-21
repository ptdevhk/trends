/**
 * Pure utility functions for JobDescriptionEditor.
 *
 * Extracted from JobDescriptionEditor.tsx for testability.
 */

import {
  normalizeIndustryTags,
  normalizeOptionalString,
  type StructuredJobDescriptionSeedFields,
} from "@trends/shared";

export type StructuredSeedFields = StructuredJobDescriptionSeedFields;

export function parseOptionalNumber(value: string): number | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.trunc(parsed);
}

export function sanitizeIndustryTags(values: string[] | undefined): string[] {
  return normalizeIndustryTags(values);
}

export function hasStructuredSeedFields(fields: StructuredSeedFields | undefined): boolean {
  if (!fields) {
    return false;
  }

  if (normalizeOptionalString(fields.location)) {
    return true;
  }

  if ((fields.industryTags?.length ?? 0) > 0) {
    return true;
  }

  if ((fields.customKeywords?.length ?? 0) > 0) {
    return true;
  }

  return (
    typeof fields.minExperience === "number"
    || typeof fields.maxExperience === "number"
    || typeof fields.minAge === "number"
    || typeof fields.maxAge === "number"
  );
}
