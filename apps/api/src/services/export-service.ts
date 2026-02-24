import ExcelJS from "exceljs";
import Papa from "papaparse";

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
};

export type ResumeExportEntry = {
  key: string;
  resume: ResumeExportPayload;
  match?: MatchExportPayload;
  action?: string;
  ruleScore?: number;
};

type ExportRow = {
  resumeId: string;
  name: string;
  jobIntention: string;
  location: string;
  experience: string;
  education: string;
  expectedSalary: string;
  aiScore: number | "";
  ruleScore: number | "";
  recommendation: string;
  scoreSource: string;
  action: string;
  industryTags: string;
  companyHits: string;
  profileUrl: string;
  workHistory: string;
  selfIntro: string;
};

export type ExportFile = {
  extension: ExportFormat;
  contentType: string;
  content: Buffer;
};

function normalizeString(value: string | undefined): string {
  return typeof value === "string" ? value : "";
}

function normalizeStringArray(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function toRow(entry: ResumeExportEntry): ExportRow {
  const workHistory = Array.isArray(entry.resume.workHistory)
    ? entry.resume.workHistory
      .map((item) => item.raw)
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .join(" | ")
    : "";

  return {
    resumeId: entry.key,
    name: normalizeString(entry.resume.name),
    jobIntention: normalizeString(entry.resume.jobIntention),
    location: normalizeString(entry.resume.location),
    experience: normalizeString(entry.resume.experience),
    education: normalizeString(entry.resume.education),
    expectedSalary: normalizeString(entry.resume.expectedSalary),
    aiScore: typeof entry.match?.score === "number" ? entry.match.score : "",
    ruleScore: typeof entry.ruleScore === "number" ? entry.ruleScore : "",
    recommendation: normalizeString(entry.match?.recommendation),
    scoreSource: normalizeString(entry.match?.scoreSource),
    action: normalizeString(entry.action),
    industryTags: normalizeStringArray(entry.resume.ingestData?.industryTags).join(", "),
    companyHits: normalizeStringArray(entry.resume.ingestData?.companyHits).join(", "),
    profileUrl: normalizeString(entry.resume.profileUrl),
    workHistory,
    selfIntro: normalizeString(entry.resume.selfIntro),
  };
}

const EXCEL_COLUMNS: Array<{ header: string; key: keyof ExportRow; width: number }> = [
  { header: "Resume ID", key: "resumeId", width: 24 },
  { header: "Name", key: "name", width: 16 },
  { header: "Job Intention", key: "jobIntention", width: 20 },
  { header: "Location", key: "location", width: 14 },
  { header: "Experience", key: "experience", width: 14 },
  { header: "Education", key: "education", width: 14 },
  { header: "Expected Salary", key: "expectedSalary", width: 16 },
  { header: "AI Score", key: "aiScore", width: 10 },
  { header: "Rule Score", key: "ruleScore", width: 10 },
  { header: "Recommendation", key: "recommendation", width: 16 },
  { header: "Score Source", key: "scoreSource", width: 12 },
  { header: "Action", key: "action", width: 12 },
  { header: "Industry Tags", key: "industryTags", width: 22 },
  { header: "Company Hits", key: "companyHits", width: 22 },
  { header: "Profile URL", key: "profileUrl", width: 28 },
  { header: "Work History", key: "workHistory", width: 44 },
  { header: "Self Intro", key: "selfIntro", width: 48 },
];

export class ExportService {
  async exportResumes(format: ExportFormat, entries: ResumeExportEntry[]): Promise<ExportFile> {
    const rows = entries.map((entry) => toRow(entry));
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
