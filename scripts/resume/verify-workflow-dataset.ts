import { fileURLToPath } from "node:url";

import { ConvexHttpClient } from "convex/browser";

import { api } from "../../packages/convex/convex/_generated/api.js";
import { isLocationMatch, resolveResumeAnalysisSourceKey } from "../../packages/shared/src/index.ts";

const DEFAULT_API_BASE_URL = "http://localhost:3000";
const DEFAULT_CONVEX_URL = "http://127.0.0.1:3210";
const DEFAULT_LIMIT = 200;
const DEFAULT_TOP = 10;
const DEFAULT_WORKSPACE = "dev";

type KeywordExpansionSummary = {
  groups: Array<{
    original: string;
    variants: string[];
  }>;
  mode: "AND" | "OR";
  expandedTo: string[];
  sourceMapping: Record<string, string>;
};

type ResumeDoc = {
  _id: string;
  source: string;
  primaryRuleScore?: number;
  ingestData?: {
    ruleScores?: Record<string, number>;
  };
  content?: {
    name?: string;
    location?: string;
    profileType?: string;
    profileUrl?: string;
  };
};

type WorkflowDatasetPageRow = Pick<ResumeDoc, "source" | "content">;

type SearchResult = {
  resume: ResumeDoc;
  provenance: Array<{
    term: string;
    source: string;
    expandedFrom?: string;
  }>;
};

type CliOptions = {
  apiBaseUrl: string;
  convexUrl: string;
  workspace: string;
  query: string;
  location?: string;
  sourceKey?: string;
  limit: number;
  top: number;
  jobDescriptionId?: string;
  json: boolean;
};

type SourceCountRow = {
  key: string;
  count: number;
};

type VisibleResumeRow = {
  resumeId: string;
  sourceHost: string;
  sourceKey?: string;
  name: string;
  location: string;
  primaryRuleScore: number | null;
  jobRuleScore: number | null;
  profileUrl?: string;
};

type WorkflowVerificationReport = {
  query: string;
  location?: string;
  sourceKey?: string;
  workspace: string;
  totalResumeCount: number;
  scannedResumeCount: number;
  datasetBySourceHost: SourceCountRow[];
  datasetBySourceKey: SourceCountRow[];
  keywordExpansion: KeywordExpansionSummary;
  queryMatchCount: number;
  queryMatchesBySourceHost: SourceCountRow[];
  queryMatchesBySourceKey: SourceCountRow[];
  visibleCount: number;
  visibleBySourceHost: SourceCountRow[];
  visibleBySourceKey: SourceCountRow[];
  visibleResumes: VisibleResumeRow[];
};

const WORKFLOW_DATASET_PAGE_SIZE = 50;

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readCliValue(flag: string): string | undefined {
  const fullFlag = `--${flag}`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === fullFlag) {
      return process.argv[index + 1];
    }
    if (arg.startsWith(`${fullFlag}=`)) {
      return arg.slice(fullFlag.length + 1);
    }
  }
  return undefined;
}

function hasCliFlag(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

function parsePositiveInteger(value: string | undefined, fallback: number, label: string): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function parseCliOptions(): CliOptions {
  const query = toOptionalString(readCliValue("query"));
  if (!query) {
    throw new Error("Missing required --query");
  }

  return {
    apiBaseUrl: (toOptionalString(readCliValue("api-base-url")) ?? toOptionalString(process.env.TRENDS_API_URL) ?? DEFAULT_API_BASE_URL).replace(/\/$/, ""),
    convexUrl: toOptionalString(readCliValue("convex-url")) ?? toOptionalString(process.env.CONVEX_URL) ?? DEFAULT_CONVEX_URL,
    workspace: toOptionalString(readCliValue("workspace")) ?? DEFAULT_WORKSPACE,
    query,
    location: toOptionalString(readCliValue("location")),
    sourceKey: toOptionalString(readCliValue("source-key"))?.toLowerCase(),
    limit: parsePositiveInteger(readCliValue("limit"), DEFAULT_LIMIT, "limit"),
    top: parsePositiveInteger(readCliValue("top"), DEFAULT_TOP, "top"),
    jobDescriptionId: toOptionalString(readCliValue("job-description")),
    json: hasCliFlag("json"),
  };
}

export function getResumeSourceKey(resume: ResumeDoc): string | undefined {
  return resolveResumeAnalysisSourceKey({
    sourceKey: resume.content?.profileType,
    source: resume.source,
  });
}

export function matchesWorkflowFilters(
  resume: ResumeDoc,
  filters: {
    sourceKey?: string;
    location?: string;
  },
): boolean {
  if (filters.sourceKey) {
    const resumeSourceKey = getResumeSourceKey(resume);
    if (resumeSourceKey !== filters.sourceKey) {
      return false;
    }
  }

  if (filters.location) {
    const resumeLocation = resume.content?.location ?? "";
    if (!isLocationMatch(resumeLocation, filters.location)) {
      return false;
    }
  }

  return true;
}

export function countByKey<T>(items: T[], keyResolver: (item: T) => string | undefined): SourceCountRow[] {
  const counts = new Map<string, number>();

  for (const item of items) {
    const key = keyResolver(item) ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function filterWorkflowMatches(
  resumes: ResumeDoc[],
  filters: {
    sourceKey?: string;
    location?: string;
  },
): ResumeDoc[] {
  return resumes.filter((resume) => matchesWorkflowFilters(resume, filters));
}

async function fetchKeywordExpansion(apiBaseUrl: string, workspace: string, query: string): Promise<KeywordExpansionSummary> {
  const url = new URL("/api/resumes/keyword-expansion", apiBaseUrl);
  url.searchParams.set("q", query);

  const response = await fetch(url, {
    headers: {
      "X-Workspace-Slug": workspace,
    },
  });
  if (!response.ok) {
    throw new Error(`Keyword expansion request failed: ${response.status}`);
  }

  const payload = await response.json() as {
    success?: boolean;
    summary?: KeywordExpansionSummary;
  };
  if (!payload.success || !payload.summary) {
    throw new Error("Keyword expansion response missing summary");
  }

  return payload.summary;
}

async function listWorkflowDatasetRows(client: ConvexHttpClient): Promise<WorkflowDatasetPageRow[]> {
  const rows: WorkflowDatasetPageRow[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await client.query(api.resumes.listWorkflowDatasetPage, {
      limit: WORKFLOW_DATASET_PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });

    rows.push(...(page.page as WorkflowDatasetPageRow[]));

    if (page.isDone) {
      return rows;
    }

    cursor = typeof page.continueCursor === "string" && page.continueCursor.length > 0
      ? page.continueCursor
      : undefined;
    if (!cursor) {
      throw new Error("listWorkflowDatasetPage returned an unfinished page without a continueCursor");
    }
  }
}

function toVisibleResumeRow(
  resume: ResumeDoc,
  jobDescriptionId: string | undefined,
): VisibleResumeRow {
  const jobRuleScore = jobDescriptionId
    ? resume.ingestData?.ruleScores?.[jobDescriptionId] ?? null
    : null;

  return {
    resumeId: resume._id,
    sourceHost: resume.source,
    sourceKey: getResumeSourceKey(resume),
    name: resume.content?.name ?? "",
    location: resume.content?.location ?? "",
    primaryRuleScore: typeof resume.primaryRuleScore === "number" ? resume.primaryRuleScore : null,
    jobRuleScore: typeof jobRuleScore === "number" ? jobRuleScore : null,
    profileUrl: resume.content?.profileUrl,
  };
}

function formatCounts(rows: SourceCountRow[]): string {
  return rows.map((row) => `${row.key}:${row.count}`).join(", ");
}

function printReport(report: WorkflowVerificationReport): void {
  console.log(`Query: ${report.query}`);
  console.log(`Workspace: ${report.workspace}`);
  if (report.location) {
    console.log(`Location filter: ${report.location}`);
  }
  if (report.sourceKey) {
    console.log(`Source key filter: ${report.sourceKey}`);
  }
  console.log(`Total resumes in Convex: ${report.totalResumeCount}`);
  console.log(`Scanned resumes: ${report.scannedResumeCount}`);
  console.log(`Dataset by source host: ${formatCounts(report.datasetBySourceHost)}`);
  console.log(`Dataset by source key: ${formatCounts(report.datasetBySourceKey)}`);
  console.log(`Expanded terms: ${report.keywordExpansion.expandedTo.join(", ")}`);
  console.log(`Query match count: ${report.queryMatchCount}`);
  console.log(`Query matches by source host: ${formatCounts(report.queryMatchesBySourceHost)}`);
  console.log(`Query matches by source key: ${formatCounts(report.queryMatchesBySourceKey)}`);
  console.log(`Visible count after source/location filters: ${report.visibleCount}`);
  console.log(`Visible by source host: ${formatCounts(report.visibleBySourceHost)}`);
  console.log(`Visible by source key: ${formatCounts(report.visibleBySourceKey)}`);

  if (report.visibleResumes.length === 0) {
    console.log("Visible resumes: none");
    return;
  }

  console.log("Visible resumes:");
  report.visibleResumes.forEach((resume) => {
    console.log(
      [
        `- ${resume.name || "(unnamed)"}`,
        `id=${resume.resumeId}`,
        `source=${resume.sourceHost}`,
        `location=${resume.location || "-"}`,
        `primaryRuleScore=${resume.primaryRuleScore ?? "-"}`,
        `jobRuleScore=${resume.jobRuleScore ?? "-"}`,
      ].join(" | "),
    );
  });
}

export async function buildWorkflowVerificationReport(options: CliOptions): Promise<WorkflowVerificationReport> {
  const client = new ConvexHttpClient(options.convexUrl);

  const [allResumes, keywordExpansion] = await Promise.all([
    listWorkflowDatasetRows(client),
    fetchKeywordExpansion(options.apiBaseUrl, options.workspace, options.query),
  ]);
  const totalResumeCount = allResumes.length;

  const searchResult = await client.query(api.resumes.searchWithTagExpansion, {
    query: options.query,
    keywordGroups: keywordExpansion.groups,
    mode: keywordExpansion.mode,
    sourceMappings: Object.entries(keywordExpansion.sourceMapping).map(([term, expandedFrom]) => ({
      term,
      expandedFrom,
    })),
    limit: options.limit,
    jobDescriptionId: options.jobDescriptionId,
  });

  const queryMatches = (searchResult.results as SearchResult[]).map((entry) => entry.resume);
  const workflowFilters = {
    sourceKey: options.sourceKey,
    location: options.location,
  };
  const visibleMatches = filterWorkflowMatches(queryMatches, workflowFilters);
  const visibleResumes = visibleMatches
    .map((resume) => toVisibleResumeRow(resume, options.jobDescriptionId))
    .sort((left, right) => {
      const leftScore = left.jobRuleScore ?? left.primaryRuleScore ?? -1;
      const rightScore = right.jobRuleScore ?? right.primaryRuleScore ?? -1;
      return rightScore - leftScore;
    })
    .slice(0, options.top);

  return {
    query: options.query,
    location: options.location,
    sourceKey: options.sourceKey,
    workspace: options.workspace,
    totalResumeCount,
    scannedResumeCount: totalResumeCount,
    datasetBySourceHost: countByKey(allResumes, (resume) => resume.source),
    datasetBySourceKey: countByKey(allResumes, getResumeSourceKey),
    keywordExpansion,
    queryMatchCount: queryMatches.length,
    queryMatchesBySourceHost: countByKey(queryMatches, (resume) => resume.source),
    queryMatchesBySourceKey: countByKey(queryMatches, getResumeSourceKey),
    visibleCount: visibleMatches.length,
    visibleBySourceHost: countByKey(visibleMatches, (resume) => resume.source),
    visibleBySourceKey: countByKey(visibleMatches, getResumeSourceKey),
    visibleResumes,
  };
}

async function main(): Promise<void> {
  const options = parseCliOptions();
  const report = await buildWorkflowVerificationReport(options);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report);
}

const currentFilePath = fileURLToPath(import.meta.url);
const entryFilePath = process.argv[1];

if (entryFilePath && currentFilePath === entryFilePath) {
  main().catch((error: unknown) => {
    console.error("verify-workflow-dataset failed:");
    console.error(error);
    process.exitCode = 1;
  });
}
