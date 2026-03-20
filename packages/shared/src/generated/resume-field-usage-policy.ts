/* eslint-disable */
// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.
// Source: config/resume/field-usage-policy.json5
// Run: make sync-resume-field-usage-policy

export const RESUME_FIELD_USAGE_SURFACES = ["analysis","presentation","outreach","debug"] as const;

export type ResumeFieldUsageSurface = (typeof RESUME_FIELD_USAGE_SURFACES)[number];

export interface ResumeFieldUsageFieldPolicy {
  surfaces?: Partial<Record<ResumeFieldUsageSurface, boolean>>;
}

export interface ResumeFieldUsagePolicy {
  version: number;
  updatedAt?: string;
  description?: string;
  sourceFileRelativePath: string;
  fields: Record<string, ResumeFieldUsageFieldPolicy>;
}

export const DEFAULT_RESUME_FIELD_USAGE_POLICY = {
  "version": 1,
  "updatedAt": "2026-03-20",
  "description": "Controls which canonical resume fields participate in analysis, presentation, outreach, and debug surfaces without deleting raw stored resume data.",
  "sourceFileRelativePath": "config/resume/field-usage-policy.json5",
  "fields": {
    "jobIntention": {
      "surfaces": {
        "analysis": false,
        "presentation": false,
        "outreach": false,
        "debug": false
      }
    },
    "selfIntro": {
      "surfaces": {
        "analysis": false,
        "presentation": false,
        "outreach": false,
        "debug": false
      }
    }
  }
} as const satisfies ResumeFieldUsagePolicy;
