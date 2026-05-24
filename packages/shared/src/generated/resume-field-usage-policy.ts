/* eslint-disable */
// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.
// Source: config/resume/field-usage-policy.json5
// Run: make sync-resume-field-usage-policy

export const RESUME_FIELD_USAGE_SURFACES = ["analysis","presentation","outreach","audit","debug"] as const;

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
  "version": 2,
  "updatedAt": "2026-05-24",
  "description": "Controls which canonical resume fields participate in analysis, presentation, outreach, audit, and debug surfaces without deleting raw stored resume data. The 'audit' surface allows protected attributes for compliance logging while keeping them scrubbed from AI analysis.",
  "sourceFileRelativePath": "config/resume/field-usage-policy.json5",
  "fields": {
    "age": {
      "surfaces": {
        "analysis": false,
        "presentation": false,
        "outreach": false,
        "audit": true,
        "debug": false
      }
    },
    "gender": {
      "surfaces": {
        "analysis": false,
        "presentation": false,
        "outreach": false,
        "audit": true,
        "debug": false
      }
    },
    "jobIntention": {
      "surfaces": {
        "analysis": false,
        "presentation": false,
        "outreach": false,
        "audit": false,
        "debug": false
      }
    },
    "resumeSnippet": {
      "surfaces": {
        "analysis": false
      }
    },
    "selfIntro": {
      "surfaces": {
        "analysis": false,
        "presentation": false,
        "outreach": false,
        "audit": false,
        "debug": false
      }
    }
  }
} as const satisfies ResumeFieldUsagePolicy;
