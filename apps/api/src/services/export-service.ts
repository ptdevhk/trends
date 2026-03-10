import ExcelJS from "exceljs";
import Papa from "papaparse";

import type { BrandDisplayResolver } from "./brand-display-resolver.js";

export type ExportFormat = "csv" | "xlsx";

type ResumeWorkHistoryItem = {
  raw?: string;
};

type ResumeIngestData = {
  industryTags?: string[];
  companyHits?: string[];
};

type ResumeExportPayload = {
  name?: string;
  jobIntention?: string;
  location?: string;
  age?: string;
  experience?: string;
  education?: string;
  expectedSalary?: string;
  profileUrl?: string;
  selfIntro?: string;
  workHistory?: ResumeWorkHistoryItem[];
  ingestData?: ResumeIngestData;
};

type MatchExportPayload = {
  score: number;
  recommendation: string;
  scoreSource?: "rule" | "ai";
  summary?: string;
};

export type ResumeExportEntry = {
  key: string;
  resume: ResumeExportPayload;
  match?: MatchExportPayload;
  action?: string;
  status?: string;
  ruleScore?: number;
  userComment?: string;
  referenceNote?: string;
};

type ExportRow = {
  resumeId: string;
  name: string;
  jobIntention: string;
  location: string;
  experience: string;
  education: string;
  age: number | "";
  expectedSalary: string;
  aiScore: number | "";
  ruleScore: number | "";
  recommendation: string;
  status: string;
  scoreSource: string;
  action: string;
  industryTags: string;
  companyHits: string;
  profileUrl: string;
  workHistory: string;
  selfIntro: string;
  aiSummary: string;
  userComment: string;
  referenceNote: string;
};

export type ExportFile = {
  extension: ExportFormat;
  contentType: string;
  content: Buffer;
};

const JOB5156_HOST = "hr.job5156.com";
const JOB5156_PROFILE_URL_PREFIX = `https://${JOB5156_HOST}/resume/view/`;

function normalizeString(value: string | undefined): string {
  return typeof value === "string" ? value : "";
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractJob5156ResumeId(pathname: string): string | null {
  const oldRouteMatch = pathname.match(/^\/api\/com\/resume\/([^/?#]+)/i);
  if (oldRouteMatch && oldRouteMatch[1]) {
    return decodeURIComponentSafe(oldRouteMatch[1]);
  }

  const viewRouteMatch = pathname.match(/^\/resume\/view\/([^/?#]+)/i);
  if (viewRouteMatch && viewRouteMatch[1]) {
    return decodeURIComponentSafe(viewRouteMatch[1]);
  }

  return null;
}

function normalizeJob5156ProfileUrlForDisplay(value: string | undefined): string {
  const normalized = normalizeString(value).trim();
  if (!normalized) {
    return "";
  }

  const directResumeId = extractJob5156ResumeId(normalized);
  if (directResumeId) {
    return `${JOB5156_PROFILE_URL_PREFIX}${encodeURIComponent(directResumeId)}`;
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(normalized);
  } catch {
    try {
      parsed = new URL(`https://${normalized}`);
    } catch {
      parsed = null;
    }
  }

  if (!parsed || parsed.hostname.toLowerCase() !== JOB5156_HOST) {
    return normalized;
  }

  const resumeId = extractJob5156ResumeId(parsed.pathname);
  if (!resumeId) {
    return normalized;
  }

  return `${JOB5156_PROFILE_URL_PREFIX}${encodeURIComponent(resumeId)}`;
}

function normalizeStringArray(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function parseAgeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value !== "string") {
    return null;
  }

  const withSuffix = value.match(/(\d+)\s*岁/u);
  if (withSuffix && withSuffix[1]) {
    return Number(withSuffix[1]);
  }

  const plain = value.match(/^(\d{1,3})$/u);
  if (plain && plain[1]) {
    return Number(plain[1]);
  }

  return null;
}

function toRow(entry: ResumeExportEntry, brandDisplayResolver?: BrandDisplayResolver): ExportRow {
  const workHistory = Array.isArray(entry.resume.workHistory)
    ? entry.resume.workHistory
      .map((item) => item.raw)
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .join(" | ")
    : "";

  const companyHitIds = normalizeStringArray(entry.resume.ingestData?.companyHits);
  const companyHits = brandDisplayResolver
    ? companyHitIds.map((hit) => brandDisplayResolver.resolveZhHans(hit)).join(", ")
    : companyHitIds.join(", ");

  return {
    resumeId: entry.key,
    name: normalizeString(entry.resume.name),
    jobIntention: normalizeString(entry.resume.jobIntention),
    location: normalizeString(entry.resume.location),
    experience: normalizeString(entry.resume.experience),
    education: normalizeString(entry.resume.education),
    age: parseAgeNumber(entry.resume.age) ?? "",
    expectedSalary: normalizeString(entry.resume.expectedSalary),
    aiScore: typeof entry.match?.score === "number" ? entry.match.score : "",
    ruleScore: typeof entry.ruleScore === "number" ? entry.ruleScore : "",
    recommendation: normalizeString(entry.match?.recommendation),
    status: normalizeString(entry.status),
    scoreSource: normalizeString(entry.match?.scoreSource),
    action: normalizeString(entry.action),
    industryTags: normalizeStringArray(entry.resume.ingestData?.industryTags).join(", "),
    companyHits,
    profileUrl: normalizeJob5156ProfileUrlForDisplay(entry.resume.profileUrl),
    workHistory,
    selfIntro: normalizeString(entry.resume.selfIntro),
    aiSummary: normalizeString(entry.match?.summary),
    userComment: normalizeString(entry.userComment),
    referenceNote: normalizeString(entry.referenceNote),
  };
}

const EXCEL_COLUMNS: Array<{ header: string; key: keyof ExportRow; width: number }> = [
  { header: "Resume ID", key: "resumeId", width: 24 },
  { header: "Name", key: "name", width: 16 },
  { header: "Job Intention", key: "jobIntention", width: 20 },
  { header: "Location", key: "location", width: 14 },
  { header: "Experience", key: "experience", width: 14 },
  { header: "Education", key: "education", width: 14 },
  { header: "Age", key: "age", width: 10 },
  { header: "Expected Salary", key: "expectedSalary", width: 16 },
  { header: "AI Score", key: "aiScore", width: 10 },
  { header: "Rule Score", key: "ruleScore", width: 10 },
  { header: "Recommendation", key: "recommendation", width: 16 },
  { header: "Status", key: "status", width: 16 },
  { header: "Score Source", key: "scoreSource", width: 12 },
  { header: "Action", key: "action", width: 12 },
  { header: "Industry Tags", key: "industryTags", width: 22 },
  { header: "Company Hits", key: "companyHits", width: 22 },
  { header: "Profile URL", key: "profileUrl", width: 28 },
  { header: "Work History", key: "workHistory", width: 44 },
  { header: "Self Intro", key: "selfIntro", width: 48 },
  { header: "AI Summary", key: "aiSummary", width: 48 },
  { header: "User Comment", key: "userComment", width: 36 },
  { header: "Reference Note", key: "referenceNote", width: 36 },
];

export type ExportBatchMeta = {
  userComment?: string;
  referenceNote?: string;
};

function applyBatchMeta(row: ExportRow, batchMeta?: ExportBatchMeta): ExportRow {
  if (!batchMeta) {
    return row;
  }

  return {
    ...row,
    userComment: batchMeta.userComment ?? row.userComment,
    referenceNote: batchMeta.referenceNote ?? row.referenceNote,
  };
}

export class ExportService {
  private readonly brandDisplayResolver?: BrandDisplayResolver;

  constructor(brandDisplayResolver?: BrandDisplayResolver) {
    this.brandDisplayResolver = brandDisplayResolver;
  }

  async exportResumes(
    format: ExportFormat,
    entries: ResumeExportEntry[],
    batchMeta?: ExportBatchMeta
  ): Promise<ExportFile> {
    const rows = entries.map((entry) =>
      applyBatchMeta(toRow(entry, this.brandDisplayResolver), batchMeta)
    );
    if (format === "xlsx") {
      const content = await this.toXlsx(rows);
      return {
        extension: "xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content,
      };
    }

    const csv = Papa.unparse(rows, { header: true, newline: "\n" });
    return {
      extension: "csv",
      contentType: "text/csv; charset=utf-8",
      content: Buffer.from(csv, "utf8"),
    };
  }

  private async toXlsx(rows: ExportRow[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Resumes");

    sheet.columns = EXCEL_COLUMNS;
    rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true };

    const data = await workbook.xlsx.writeBuffer();
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data);
    }
    return Buffer.from(data);
  }
}
