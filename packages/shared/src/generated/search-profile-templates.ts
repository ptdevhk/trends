/* eslint-disable */
// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.
// Source: config/search-profiles/*.yaml
// Run: make sync-search-profile-templates

export const DEFAULT_TEMPLATE_WORKSPACE_SLUG = "dev";

export type SharedSearchProfileTemplate = {
  workspaceSlug?: string;
  profile: {
    id: string;
    name: string;
    description?: string;
    createdAt?: string;
    updatedAt?: string;
    status: "active" | "paused" | "archived";
    location: string;
    keywords: string[];
    requiredKeywords?: string[];
    jobDescription?: string;
    filterPreset?: string;
    filters?: {
      minExperience?: number;
      maxExperience?: number | null;
      minAge?: number;
      maxAge?: number;
      education?: string[];
      salaryRange?: {
        min?: number;
        max?: number;
        currency?: string;
        period?: string;
      };
      locations?: string[];
    };
    schedule?: {
      enabled: boolean;
      cron?: string;
      timezone?: string;
      maxCandidates?: number;
      notifyOnlyOnNew?: boolean;
    };
    sources?: Array<{
      type: string;
      enabled: boolean;
      priority?: number;
      jobUrl?: string;
      collectLimit?: number;
      maxPages?: number;
    }>;
    quickStart?: {
      enabled: boolean;
      rank?: number;
      label?: string;
      description?: string;
    };
    session?: {
      scope?: string;
      resetTriggers?: string[];
      retention?: {
        mode?: string;
        archiveAfterDays?: number;
      };
    };
  };
  seedLastRunOffsetMs?: number;
};

export const SEARCH_PROFILE_TEMPLATES: SharedSearchProfileTemplate[] = [
  {
    "workspaceSlug": "dev",
    "seedLastRunOffsetMs": 3600000,
    "profile": {
      "id": "job5156-cn-cnc-sales",
      "name": "China Job5156 CNC Sales",
      "description": "China-wide Job5156 CNC sales search profile used for the landing quick start",
      "createdAt": "2026-03-28",
      "updatedAt": "2026-03-28",
      "status": "active",
      "location": "China",
      "keywords": [
        "CNC",
        "销售"
      ],
      "jobDescription": "lathe-sales",
      "filters": {
        "minExperience": 1,
        "maxExperience": null,
        "minAge": 25,
        "maxAge": 40,
        "locations": [
          "China"
        ],
        "salaryRange": {
          "max": 25000
        }
      },
      "schedule": {
        "enabled": false,
        "cron": "0 9 * * 1-5",
        "timezone": "Asia/Shanghai",
        "maxCandidates": 200
      },
      "sources": [
        {
          "type": "job5156",
          "enabled": true,
          "priority": 1,
          "collectLimit": 200,
          "maxPages": 10
        },
        {
          "type": "seek",
          "enabled": false,
          "priority": 2
        }
      ],
      "quickStart": {
        "enabled": true,
        "rank": 1,
        "label": "China · Job5156 · CNC 销售",
        "description": "CNC, 销售 · China"
      }
    }
  },
  {
    "workspaceSlug": "hr",
    "seedLastRunOffsetMs": 3600000,
    "profile": {
      "id": "job5156-cn-cnc-sales",
      "name": "China Job5156 CNC Sales",
      "description": "China-wide Job5156 CNC sales search profile used for the landing quick start",
      "createdAt": "2026-03-28",
      "updatedAt": "2026-03-28",
      "status": "active",
      "location": "China",
      "keywords": [
        "CNC",
        "销售"
      ],
      "jobDescription": "lathe-sales",
      "filters": {
        "minExperience": 1,
        "maxExperience": null,
        "minAge": 25,
        "maxAge": 40,
        "locations": [
          "China"
        ],
        "salaryRange": {
          "max": 25000
        }
      },
      "schedule": {
        "enabled": false,
        "cron": "0 9 * * 1-5",
        "timezone": "Asia/Shanghai",
        "maxCandidates": 200
      },
      "sources": [
        {
          "type": "job5156",
          "enabled": true,
          "priority": 1,
          "collectLimit": 200,
          "maxPages": 10
        },
        {
          "type": "seek",
          "enabled": false,
          "priority": 2
        }
      ],
      "quickStart": {
        "enabled": true,
        "rank": 1,
        "label": "China · Job5156 · CNC 销售",
        "description": "CNC, 销售 · China"
      }
    }
  },
  {
    "workspaceSlug": "dev",
    "seedLastRunOffsetMs": 900000,
    "profile": {
      "id": "51job-cn-cnc-sales",
      "name": "China 51job CNC Sales",
      "description": "China-wide 51job CNC sales search profile used for the landing quick start",
      "createdAt": "2026-04-02",
      "updatedAt": "2026-04-09",
      "status": "active",
      "location": "China",
      "keywords": [
        "CNC",
        "销售"
      ],
      "filters": {
        "minExperience": 1,
        "maxExperience": null,
        "minAge": 25,
        "maxAge": 40,
        "locations": [
          "China"
        ],
        "salaryRange": {
          "max": 25000
        }
      },
      "schedule": {
        "enabled": false,
        "cron": "0 9 * * 1-5",
        "timezone": "Asia/Shanghai",
        "maxCandidates": 200
      },
      "sources": [
        {
          "type": "51job",
          "enabled": true,
          "priority": 1
        },
        {
          "type": "job5156",
          "enabled": false,
          "priority": 2
        }
      ],
      "quickStart": {
        "enabled": true,
        "rank": 2,
        "label": "China · 51job · CNC 销售",
        "description": "CNC, 销售 · China"
      }
    }
  },
  {
    "workspaceSlug": "hr",
    "seedLastRunOffsetMs": 900000,
    "profile": {
      "id": "51job-cn-cnc-sales",
      "name": "China 51job CNC Sales",
      "description": "China-wide 51job CNC sales search profile used for the landing quick start",
      "createdAt": "2026-04-02",
      "updatedAt": "2026-04-09",
      "status": "active",
      "location": "China",
      "keywords": [
        "CNC",
        "销售"
      ],
      "filters": {
        "minExperience": 1,
        "maxExperience": null,
        "minAge": 25,
        "maxAge": 40,
        "locations": [
          "China"
        ],
        "salaryRange": {
          "max": 25000
        }
      },
      "schedule": {
        "enabled": false,
        "cron": "0 9 * * 1-5",
        "timezone": "Asia/Shanghai",
        "maxCandidates": 200
      },
      "sources": [
        {
          "type": "51job",
          "enabled": true,
          "priority": 1
        },
        {
          "type": "job5156",
          "enabled": false,
          "priority": 2
        }
      ],
      "quickStart": {
        "enabled": true,
        "rank": 2,
        "label": "China · 51job · CNC 销售",
        "description": "CNC, 销售 · China"
      }
    }
  },
  {
    "workspaceSlug": "dev",
    "seedLastRunOffsetMs": 1800000,
    "profile": {
      "id": "seek-malaysia-sales",
      "name": "SEEK Malaysia CNC Sales",
      "description": "Malaysia SEEK workflow for nationwide CNC sales hiring",
      "createdAt": "2026-03-17",
      "updatedAt": "2026-04-24",
      "status": "active",
      "location": "Malaysia",
      "keywords": [
        "CNC",
        "Sales"
      ],
      "requiredKeywords": [
        "machine tools"
      ],
      "jobDescription": "seek-malaysia-sales",
      "filters": {
        "minExperience": 1,
        "maxExperience": null,
        "maxAge": 45,
        "locations": [
          "Malaysia"
        ]
      },
      "schedule": {
        "enabled": false,
        "timezone": "Asia/Kuala_Lumpur",
        "maxCandidates": 120
      },
      "sources": [
        {
          "type": "seek",
          "enabled": true,
          "priority": 1,
          "jobUrl": "https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1",
          "collectLimit": 100,
          "maxPages": 5
        },
        {
          "type": "job5156",
          "enabled": false,
          "priority": 2
        }
      ],
      "quickStart": {
        "enabled": true,
        "rank": 3,
        "label": "Malaysia · SEEK · CNC Sales",
        "description": "CNC, Sales · Malaysia"
      },
      "session": {
        "scope": "per-position",
        "retention": {
          "mode": "until-closed",
          "archiveAfterDays": 90
        }
      }
    }
  },
  {
    "workspaceSlug": "hr",
    "seedLastRunOffsetMs": 1800000,
    "profile": {
      "id": "seek-malaysia-sales",
      "name": "SEEK Malaysia CNC Sales",
      "description": "Malaysia SEEK workflow for nationwide CNC sales hiring",
      "createdAt": "2026-03-17",
      "updatedAt": "2026-04-24",
      "status": "active",
      "location": "Malaysia",
      "keywords": [
        "CNC",
        "Sales"
      ],
      "requiredKeywords": [
        "machine tools"
      ],
      "jobDescription": "seek-malaysia-sales",
      "filters": {
        "minExperience": 1,
        "maxExperience": null,
        "maxAge": 45,
        "locations": [
          "Malaysia"
        ]
      },
      "schedule": {
        "enabled": false,
        "timezone": "Asia/Kuala_Lumpur",
        "maxCandidates": 120
      },
      "sources": [
        {
          "type": "seek",
          "enabled": true,
          "priority": 1,
          "jobUrl": "https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1",
          "collectLimit": 100,
          "maxPages": 5
        },
        {
          "type": "job5156",
          "enabled": false,
          "priority": 2
        }
      ],
      "quickStart": {
        "enabled": true,
        "rank": 3,
        "label": "Malaysia · SEEK · CNC Sales",
        "description": "CNC, Sales · Malaysia"
      },
      "session": {
        "scope": "per-position",
        "retention": {
          "mode": "until-closed",
          "archiveAfterDays": 90
        }
      }
    }
  }
];

export function normalizeTemplateWorkspaceSlug(workspaceSlug?: string): string {
  const normalized = workspaceSlug?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_TEMPLATE_WORKSPACE_SLUG;
}

export function buildSearchProfileCriteria(profile: SharedSearchProfileTemplate["profile"]) {
  const filterLocations = Array.isArray(profile.filters?.locations)
    ? profile.filters.locations.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const locations = Array.from(new Set([profile.location, ...filterLocations].filter((item) => item && item.trim().length > 0)));

  return {
    keywords: [...profile.keywords],
    locations,
  };
}

export function getWorkspaceSearchProfileTemplates(workspaceSlug?: string): SharedSearchProfileTemplate[] {
  const normalizedWorkspaceSlug = normalizeTemplateWorkspaceSlug(workspaceSlug);
  return SEARCH_PROFILE_TEMPLATES.filter((template) => (
    normalizeTemplateWorkspaceSlug(template.workspaceSlug) === normalizedWorkspaceSlug
  ));
}

export function findWorkspaceSearchProfileTemplate(
  id: string,
  workspaceSlug?: string,
): SharedSearchProfileTemplate | null {
  const normalizedId = id.trim().toLowerCase();
  return getWorkspaceSearchProfileTemplates(workspaceSlug).find((template) => (
    template.profile.id.trim().toLowerCase() === normalizedId
  )) ?? null;
}

export function computeTemplateHash(profile: SharedSearchProfileTemplate["profile"]): string {
  const canonical = JSON.stringify(profile, (_key, value) => {
    if (value === undefined || value === null) return undefined;
    if (Array.isArray(value)) return [...value].sort();
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return Object.keys(value).sort().reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = value[k as keyof typeof value];
        return acc;
      }, {});
    }
    return value;
  });
  let hash = 0;
  for (let i = 0; i < canonical.length; i++) {
    const chr = canonical.charCodeAt(i);
    hash = ((hash << 5) - hash + chr) | 0;
  }
  return "sp-" + Math.abs(hash).toString(36);
}
