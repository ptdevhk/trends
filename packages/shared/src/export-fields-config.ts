/**
 * Export fields configuration — per-workspace control over which columns
 * appear in resume export (CSV/XLSX).
 */

export const EXPORT_FIELD_KEYS = [
  "resumeId",
  "name",
  "jobIntention",
  "location",
  "experience",
  "education",
  "age",
  "expectedSalary",
  "expectedSalaryMinCny",
  "expectedSalaryMaxCny",
  "aiScore",
  "finalAiScore",
  "relatedExpAuditFactor",
  "relatedExpContribution",
  "industryDb",
  "relatedExp",
  "recommendation",
  "ruleScore",
  "scoreSource",
  "status",
  "action",
  "industryTags",
  "brandHits",
  "companyHits",
  "profileUrl",
  "workHistory",
  "selfIntro",
  "aiSummary",
  "userComment",
  "referenceNote",
  "externalId",
  "source",
  "industryDbV2Raw",
  "industryDbV2Normalized",
  "roleEvidence",
  "matchedWorkEntries",
  "userRating",
] as const;

export type ExportFieldKey = (typeof EXPORT_FIELD_KEYS)[number];

export const EXPORT_CORE_FIELDS = [
  "resumeId",
  "name",
  "userComment",
  "location",
  "education",
  "age",
  "expectedSalary",
  "expectedSalaryMinCny",
  "expectedSalaryMaxCny",
  "aiScore",
  "aiSummary",
  "profileUrl",
  "source",
  "status",
  "userRating",
] as const satisfies readonly ExportFieldKey[];

export const EXPORT_DETAIL_FIELDS = [
  "experience",
  "workHistory",
  "selfIntro",
  "jobIntention",
  "action",
  "finalAiScore",
  "relatedExpAuditFactor",
  "relatedExpContribution",
  "industryDb",
  "relatedExp",
  "recommendation",
  "ruleScore",
  "scoreSource",
  "industryTags",
  "brandHits",
  "companyHits",
  "referenceNote",
] as const satisfies readonly ExportFieldKey[];

export const EXPORT_DEBUG_FIELDS = [
  "externalId",
  "industryDbV2Raw",
  "industryDbV2Normalized",
  "roleEvidence",
  "matchedWorkEntries",
] as const satisfies readonly ExportFieldKey[];

export const EXPORT_CANONICAL_FIELDS = [
  ...EXPORT_CORE_FIELDS,
  ...EXPORT_DETAIL_FIELDS,
  ...EXPORT_DEBUG_FIELDS,
] as const satisfies readonly ExportFieldKey[];

const LEGACY_EXPORT_DEFAULT_FIELDS = [
  "resumeId",
  "name",
  "jobIntention",
  "location",
  "education",
  "age",
  "expectedSalary",
  "expectedSalaryMinCny",
  "expectedSalaryMaxCny",
  "aiScore",
  "aiSummary",
  "profileUrl",
  "source",
  "status",
  "userRating",
  "userComment",
] as const satisfies readonly ExportFieldKey[];

const EXPORT_FIELD_KEY_SET = new Set<ExportFieldKey>(EXPORT_FIELD_KEYS);
const EXPORT_CANONICAL_INDEX = new Map<ExportFieldKey, number>(
  EXPORT_CANONICAL_FIELDS.map((field, index) => [field, index]),
);

export type ExportFieldsConfig = {
  /** Ordered list of fields to include in export. Empty array = use defaults. */
  fields: ExportFieldKey[];
  /** If true, debug fields are appended when debug mode is active, even if not in fields list */
  includeDebugWhenEnabled?: boolean;
};

export function isExportFieldKey(value: unknown): value is ExportFieldKey {
  return typeof value === "string" && EXPORT_FIELD_KEY_SET.has(value as ExportFieldKey);
}

function dedupeExportFields(fields: readonly ExportFieldKey[]): ExportFieldKey[] {
  const deduped: ExportFieldKey[] = [];
  const seen = new Set<ExportFieldKey>();
  for (const field of fields) {
    if (seen.has(field)) {
      continue;
    }
    seen.add(field);
    deduped.push(field);
  }
  return deduped;
}

function hasLegacyDefaultPrefix(fields: readonly ExportFieldKey[]): boolean {
  if (fields.length < LEGACY_EXPORT_DEFAULT_FIELDS.length) {
    return false;
  }
  return LEGACY_EXPORT_DEFAULT_FIELDS.every((field, index) => fields[index] === field);
}

export function sortExportFieldsInCanonicalOrder(fields: readonly ExportFieldKey[]): ExportFieldKey[] {
  return dedupeExportFields(fields).sort(
    (left, right) => (EXPORT_CANONICAL_INDEX.get(left) ?? 0) - (EXPORT_CANONICAL_INDEX.get(right) ?? 0),
  );
}

function withDebugFlag(
  fields: ExportFieldKey[],
  includeDebugWhenEnabled: boolean | undefined,
): ExportFieldsConfig {
  return typeof includeDebugWhenEnabled === "boolean"
    ? { fields, includeDebugWhenEnabled }
    : { fields };
}

export function normalizeExportFieldsConfig(config: ExportFieldsConfig): ExportFieldsConfig {
  const dedupedFields = dedupeExportFields(config.fields);
  if (hasLegacyDefaultPrefix(dedupedFields)) {
    return withDebugFlag(sortExportFieldsInCanonicalOrder(dedupedFields), config.includeDebugWhenEnabled);
  }
  return withDebugFlag(dedupedFields, config.includeDebugWhenEnabled);
}

export function isDefaultExportFieldsSelection(
  fields: readonly ExportFieldKey[],
  includeDebugWhenEnabled?: boolean,
): boolean {
  if (includeDebugWhenEnabled === true) {
    return false;
  }
  const dedupedFields = dedupeExportFields(fields);
  return (
    dedupedFields.length === EXPORT_CORE_FIELDS.length
    && EXPORT_CORE_FIELDS.every((field, index) => dedupedFields[index] === field)
  );
}

export function collapseDefaultExportFieldsConfig(config: ExportFieldsConfig): ExportFieldsConfig {
  const normalized = normalizeExportFieldsConfig(config);
  if (normalized.fields.length === 0 || isDefaultExportFieldsSelection(normalized.fields, normalized.includeDebugWhenEnabled)) {
    return { fields: [] };
  }
  return normalized;
}

export function resolveStoredExportFieldsConfig(config: ExportFieldsConfig | null | undefined): ExportFieldsConfig | null {
  if (!config || config.fields.length === 0) {
    return null;
  }
  const normalized = normalizeExportFieldsConfig(config);
  if (normalized.fields.length === 0 || isDefaultExportFieldsSelection(normalized.fields, normalized.includeDebugWhenEnabled)) {
    return null;
  }
  return normalized;
}
