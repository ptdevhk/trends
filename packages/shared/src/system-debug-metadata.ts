export type ConfigSourceType = "markdown" | "json5" | "text";
export type InspectableSourceGroupKey = "prompt" | "config" | "project-notes";
export type InspectableSourceAudience = "developer" | "admin" | "app";

export interface ConfigSourceMetadata {
  version?: number;
  updatedAt?: string;
  description?: string;
  locale?: string;
  requestedLocale?: string;
  resolvedSourceLocale?: string;
  fallbackToZhHans?: boolean;
}

export interface InspectableSourceSummary {
  key: string;
  label: string;
  relativePath: string;
  type: ConfigSourceType;
  readOnly: true;
  group: InspectableSourceGroupKey;
  audience: InspectableSourceAudience;
  metadata?: ConfigSourceMetadata;
  parseError?: string;
}

export interface InspectableSourceDetail extends InspectableSourceSummary {
  rawSource: string;
  parsedPreview: unknown;
}

export interface InspectableSourceGroupSummary {
  key: InspectableSourceGroupKey;
  label: string;
  description: string;
  audience: InspectableSourceAudience;
  sources: InspectableSourceSummary[];
}

export interface StaticInspectableSourceDefinition {
  key: string;
  label: string;
  relativePath: string;
  type: ConfigSourceType;
  group: InspectableSourceGroupKey;
  audience: InspectableSourceAudience;
}

export interface SurfaceNavDefinition {
  id: string;
  titleKey: string;
  defaultTitle: string;
  hrefSuffix: string;
  matchesSuffixes: string[];
  requiresAdmin?: boolean;
}

export interface SystemCapabilityDescriptor {
  id: string;
  title: string;
  description: string;
  category: "inspect" | "debug" | "settings" | "navigation" | "cli";
  audience: InspectableSourceAudience;
  relatedSourceGroups?: InspectableSourceGroupKey[];
}

export interface BreakdownLabelDescriptor {
  key: string;
  aliases: string[];
  labelKey: string;
  defaultLabel: string;
}

export interface LabelDescriptor {
  value: string;
  labelKey: string;
  defaultLabel: string;
}

export interface AppSurfaceIdentityDefinition {
  appName: string;
  homeTitle: string;
  systemTitle: string;
  settingsTitle: string;
  adminBadgeLabel: string;
  settingsBadgeLabel: string;
}

export const APP_SURFACE_IDENTITY: AppSurfaceIdentityDefinition = {
  appName: "Trends",
  homeTitle: "Trends",
  systemTitle: "System Admin",
  settingsTitle: "Workspace Settings",
  adminBadgeLabel: "ADMIN",
  settingsBadgeLabel: "SETTINGS",
};

export const INSPECTABLE_SOURCE_GROUP_DEFINITIONS: Array<{
  key: InspectableSourceGroupKey;
  label: string;
  description: string;
  audience: InspectableSourceAudience;
}> = [
  {
    key: "prompt",
    label: "Prompt Sources",
    description: "Prompt and AI-inspection sources used by debug and screening flows.",
    audience: "developer",
  },
  {
    key: "config",
    label: "Config Sources",
    description: "File-backed runtime configuration surfaced to admin and debug tooling.",
    audience: "admin",
  },
  {
    key: "project-notes",
    label: "Project Notes",
    description: "Selected project notes exposed for read-only inspection in system and CLI tooling.",
    audience: "developer",
  },
];

export const STATIC_INSPECTABLE_SOURCE_DEFINITIONS: StaticInspectableSourceDefinition[] = [
  {
    key: "resume-agents",
    label: "Resume agent pipeline",
    relativePath: "config/resume/agents.json5",
    type: "json5",
    group: "config",
    audience: "admin",
  },
  {
    key: "resume-skills",
    label: "Resume skills taxonomy",
    relativePath: "config/resume/skills.md",
    type: "markdown",
    group: "config",
    audience: "developer",
  },
  {
    key: "resume-skills-words",
    label: "Resume legacy skill words",
    relativePath: "config/resume/skills_words.txt",
    type: "text",
    group: "config",
    audience: "developer",
  },
  {
    key: "resume-rule-weights",
    label: "Resume rule weights",
    relativePath: "config/resume/rule-weights.json5",
    type: "json5",
    group: "config",
    audience: "admin",
  },
  {
    key: "resume-filter-presets",
    label: "Resume filter presets",
    relativePath: "config/resume/filter-presets.json5",
    type: "json5",
    group: "config",
    audience: "admin",
  },
  {
    key: "resume-custom-keywords",
    label: "Resume custom keywords",
    relativePath: "config/resume/custom-keywords.json5",
    type: "json5",
    group: "config",
    audience: "admin",
  },
  {
    key: "resume-field-usage-policy",
    label: "Resume field usage policy",
    relativePath: "config/resume/field-usage-policy.json5",
    type: "json5",
    group: "config",
    audience: "admin",
  },
  {
    key: "resume-session",
    label: "Resume session config",
    relativePath: "config/resume/session.json5",
    type: "json5",
    group: "config",
    audience: "admin",
  },
  {
    key: "release-note-2026-03-12-resume-scoring-rule",
    label: "Release note: resume scoring rule v0.1.0",
    relativePath: "dev-docs/releases/2026-03-12-resume-scoring-rule-v0.1.0.md",
    type: "markdown",
    group: "project-notes",
    audience: "developer",
  },
  {
    key: "release-note-2026-03-06-session-history",
    label: "Release note: screening session history",
    relativePath: "dev-docs/releases/2026-03-06-screening-session-history-note.md",
    type: "markdown",
    group: "project-notes",
    audience: "developer",
  },
  {
    key: "qa-critical-path-ui-smoke",
    label: "QA note: critical path UI smoke",
    relativePath: "dev-docs/qa/critical-path-ui-smoke.md",
    type: "markdown",
    group: "project-notes",
    audience: "developer",
  },
];

export const SYSTEM_NAV_ITEMS: SurfaceNavDefinition[] = [
  {
    id: "home",
    titleKey: "nav.home",
    defaultTitle: "Home",
    hrefSuffix: "/resumes",
    matchesSuffixes: ["/resumes"],
  },
  {
    id: "settings",
    titleKey: "nav.settings",
    defaultTitle: "System Settings",
    hrefSuffix: "/system/settings",
    matchesSuffixes: ["/system/settings"],
  },
  {
    id: "jds",
    titleKey: "nav.jds",
    defaultTitle: "Job Descriptions",
    hrefSuffix: "/system/jds",
    matchesSuffixes: ["/system/jds"],
  },
  {
    id: "summaries",
    titleKey: "summaries.nav",
    defaultTitle: "Summary Runs",
    hrefSuffix: "/system/summaries",
    matchesSuffixes: ["/system/summaries"],
  },
  {
    id: "ai-debugger",
    titleKey: "nav.debugAi",
    defaultTitle: "AI Debugger",
    hrefSuffix: "/system/ai-debugger",
    matchesSuffixes: ["/system/ai-debugger"],
  },
  {
    id: "ai-tagging",
    titleKey: "nav.aiTaggingCompare",
    defaultTitle: "AI Tagging (Compare)",
    hrefSuffix: "/system/ai-tagging",
    matchesSuffixes: ["/system/ai-tagging"],
  },
  {
    id: "ingest",
    titleKey: "debugIngest.nav",
    defaultTitle: "Ingest Debug",
    hrefSuffix: "/system/ingest",
    matchesSuffixes: ["/system/ingest"],
  },
  {
    id: "search-analytics",
    titleKey: "searchAnalytics.nav",
    defaultTitle: "Search Analytics",
    hrefSuffix: "/system/search-analytics",
    matchesSuffixes: ["/system/search-analytics"],
  },
  {
    id: "data-inspector",
    titleKey: "nav.dataInspector",
    defaultTitle: "Data Inspector",
    hrefSuffix: "/system/data",
    matchesSuffixes: ["/system/data"],
  },
  {
    id: "archived",
    titleKey: "nav.archived",
    defaultTitle: "Archived",
    hrefSuffix: "/system/archived",
    matchesSuffixes: ["/system/archived"],
  },
  {
    id: "audit-compliance",
    titleKey: "nav.auditCompliance",
    defaultTitle: "Audit & Compliance",
    hrefSuffix: "/system/audit-compliance",
    matchesSuffixes: ["/system/audit-compliance"],
  },
];

export const SETTINGS_NAV_ITEMS: SurfaceNavDefinition[] = [
  {
    id: "home",
    titleKey: "nav.home",
    defaultTitle: "Home",
    hrefSuffix: "/resumes",
    matchesSuffixes: ["/resumes"],
  },
  {
    id: "blocks",
    titleKey: "settings.blocks.nav",
    defaultTitle: "Blacklist",
    hrefSuffix: "/settings/blocks",
    matchesSuffixes: ["/settings/blocks"],
  },
  {
    id: "profiles",
    titleKey: "searchProfiles.nav",
    defaultTitle: "Search Profiles",
    hrefSuffix: "/settings/profiles",
    matchesSuffixes: ["/settings/profiles"],
  },
  {
    id: "export-fields",
    titleKey: "debugConfig.settingsNavExportFields",
    defaultTitle: "Export Fields",
    hrefSuffix: "/settings/export-fields",
    matchesSuffixes: ["/settings/export-fields"],
    requiresAdmin: true,
  },
];

export const SYSTEM_SETTINGS_NAV_ITEMS: SurfaceNavDefinition[] = [
  {
    id: "overview",
    titleKey: "debugConfig.settingsNavOverview",
    defaultTitle: "Overview",
    hrefSuffix: "/system/settings",
    matchesSuffixes: ["/system/settings"],
  },
  {
    id: "operations",
    titleKey: "debugConfig.settingsNavOperations",
    defaultTitle: "Operations",
    hrefSuffix: "/system/settings/operations",
    matchesSuffixes: ["/system/settings/operations"],
  },
  {
    id: "runtime",
    titleKey: "debugConfig.settingsNavRuntime",
    defaultTitle: "AI and agents",
    hrefSuffix: "/system/settings/runtime",
    matchesSuffixes: ["/system/settings/runtime"],
  },
  {
    id: "config-sources",
    titleKey: "debugConfig.settingsNavConfigSources",
    defaultTitle: "Config sources",
    hrefSuffix: "/system/settings/config-sources",
    matchesSuffixes: ["/system/settings/config-sources"],
  },
  {
    id: "keywords",
    titleKey: "debugConfig.settingsNavKeywords",
    defaultTitle: "Keywords",
    hrefSuffix: "/system/settings/keywords",
    matchesSuffixes: ["/system/settings/keywords"],
  },
  {
    id: "taxonomy",
    titleKey: "debugConfig.settingsNavTaxonomy",
    defaultTitle: "Taxonomy",
    hrefSuffix: "/system/settings/taxonomy",
    matchesSuffixes: ["/system/settings/taxonomy"],
  },
  {
    id: "locations",
    titleKey: "debugConfig.settingsNavLocations",
    defaultTitle: "Locations",
    hrefSuffix: "/system/settings/locations",
    matchesSuffixes: ["/system/settings/locations"],
  },
  {
    id: "export-fields",
    titleKey: "debugConfig.settingsNavExportFields",
    defaultTitle: "Export Fields",
    hrefSuffix: "/system/settings/export-fields",
    matchesSuffixes: ["/system/settings/export-fields"],
  },
];

export const DEBUG_PAGE_SECTION_DEFINITIONS: Array<{
  id: "all" | "inputs" | "findings" | "process" | "raw" | "industry" | "jobs" | "config" | "ai";
  titleKey: string;
  defaultTitle: string;
  hrefSuffix: string;
}> = [
  { id: "all", titleKey: "debug.navAll", defaultTitle: "All", hrefSuffix: "" },
  { id: "inputs", titleKey: "debug.navInputs", defaultTitle: "Inputs", hrefSuffix: "/inputs" },
  { id: "findings", titleKey: "debug.navFindings", defaultTitle: "Findings", hrefSuffix: "/findings" },
  { id: "process", titleKey: "debug.navProcess", defaultTitle: "Process", hrefSuffix: "/process" },
  { id: "raw", titleKey: "debug.navRaw", defaultTitle: "Raw", hrefSuffix: "/raw" },
  { id: "industry", titleKey: "debug.navIndustry", defaultTitle: "Industry", hrefSuffix: "/industry" },
  { id: "jobs", titleKey: "debug.navJobs", defaultTitle: "Jobs", hrefSuffix: "/jobs" },
  { id: "config", titleKey: "debug.navConfig", defaultTitle: "Config", hrefSuffix: "/config" },
  { id: "ai", titleKey: "debug.navAi", defaultTitle: "AI", hrefSuffix: "/ai" },
];

export const DEBUG_AI_BREAKDOWN_LABELS: BreakdownLabelDescriptor[] = [
  {
    key: "experience",
    aliases: ["experience", "related_exp"],
    labelKey: "debugAi.breakdownLabels.experience",
    defaultLabel: "Related Experience",
  },
  {
    key: "skills",
    aliases: ["skills"],
    labelKey: "debugAi.breakdownLabels.skills",
    defaultLabel: "Skills",
  },
  {
    key: "industry_db",
    aliases: ["industry_db"],
    labelKey: "debugAi.breakdownLabels.industryDb",
    defaultLabel: "Industry DB",
  },
  {
    key: "education",
    aliases: ["education"],
    labelKey: "debugAi.breakdownLabels.education",
    defaultLabel: "Education",
  },
  {
    key: "location",
    aliases: ["location"],
    labelKey: "debugAi.breakdownLabels.location",
    defaultLabel: "Location",
  },
];

export const DEBUG_AI_KEYWORD_PROMPT_VARIANT = {
  title: "Keyword-Based Prompt Variant",
  body: `buildKeywordRequirements(['cnc', '车床', '4轴']):\n候选人需具备以下关键技能/经验:\n- cnc\n- 车床\n- 4轴`,
};

export const INGEST_BRAND_SOURCE_LABELS: LabelDescriptor[] = [
  { value: "workHistory", labelKey: "debugIngest.brandSource.workHistory", defaultLabel: "Work History" },
  { value: "selfIntro", labelKey: "debugIngest.brandSource.selfIntro", defaultLabel: "Self Intro" },
  { value: "jobIntention", labelKey: "debugIngest.brandSource.jobIntention", defaultLabel: "Job Intention" },
];

export const INGEST_BRAND_CONTEXT_LABELS: LabelDescriptor[] = [
  { value: "employer", labelKey: "debugIngest.brandContext.employer", defaultLabel: "Employer" },
  { value: "equipment", labelKey: "debugIngest.brandContext.equipment", defaultLabel: "Equipment" },
  { value: "sales", labelKey: "debugIngest.brandContext.sales", defaultLabel: "Sales" },
  { value: "technical", labelKey: "debugIngest.brandContext.technical", defaultLabel: "Technical" },
  { value: "general", labelKey: "debugIngest.brandContext.general", defaultLabel: "General" },
];

export const INGEST_BRAND_ROLE_LABELS: LabelDescriptor[] = [
  { value: "employer", labelKey: "debugIngest.brandRole.employer", defaultLabel: "Employer" },
  { value: "equipment", labelKey: "debugIngest.brandRole.equipment", defaultLabel: "Equipment" },
  { value: "both", labelKey: "debugIngest.brandRole.both", defaultLabel: "Both" },
];

export const SYSTEM_CAPABILITY_DESCRIPTORS: SystemCapabilityDescriptor[] = [
  {
    id: "shared-system-navigation",
    title: "Shared system navigation metadata",
    description: "System and settings sidebars consume centralized navigation and identity metadata.",
    category: "navigation",
    audience: "admin",
    relatedSourceGroups: ["config"],
  },
  {
    id: "grouped-config-inspection",
    title: "Grouped config inspection",
    description: "Config, prompt, and project-note sources are exposed through grouped read-only inspection payloads.",
    category: "inspect",
    audience: "developer",
    relatedSourceGroups: ["prompt", "config", "project-notes"],
  },
  {
    id: "debug-ai-metadata",
    title: "AI debug metadata",
    description: "AI prompt and breakdown labels resolve from centralized metadata instead of page-local constants.",
    category: "debug",
    audience: "developer",
    relatedSourceGroups: ["prompt"],
  },
  {
    id: "debug-ingest-label-maps",
    title: "Ingest debug label maps",
    description: "Ingest brand source, context, and role labels share a common registry across surfaces.",
    category: "debug",
    audience: "developer",
    relatedSourceGroups: ["config"],
  },
  {
    id: "cli-system-inspect",
    title: "CLI system inspect parity",
    description: "The CLI can list sources, show details, and inspect system identity/capability payloads from the API.",
    category: "cli",
    audience: "developer",
    relatedSourceGroups: ["prompt", "config", "project-notes"],
  },
];

export function getLabelDescriptor(value: string, labels: LabelDescriptor[]): LabelDescriptor | null {
  return labels.find((label) => label.value === value) ?? null;
}
