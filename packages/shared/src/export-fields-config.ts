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

export type ExportFieldsConfig = {
  /** Ordered list of fields to include in export. Empty array = use defaults. */
  fields: ExportFieldKey[];
  /** If true, debug fields are appended when debug mode is active, even if not in fields list */
  includeDebugWhenEnabled?: boolean;
};
