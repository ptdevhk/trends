import ExcelJS from "exceljs";
import Papa from "papaparse";
import {
  buildWorkHistoryEntryText,
  normalizeProfileUrlForDisplay,
  type ResumeWorkHistoryItem as SharedResumeWorkHistoryItem,
} from "@trends/shared";
import type { BrandDisplayResolver } from "./brand-display-resolver.js";
import {
  buildCompanyPatternAliasLookup,
  normalizeCompanyPatternIdentifier,
  type CompanyPattern,
} from "./skills-knowledge.js";
import {
  createBatchNormalizer,
  type IndustryDbV2BatchStats,
} from "./industry-db-batch-stats.js";
import type { ResumeIngestData } from "../types/resume.js";

export type ExportFormat = "csv" | "xlsx";

type ResumeWorkHistoryItem = Partial<SharedResumeWorkHistoryItem> & {
  raw?: string;
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
  source?: string;
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
  industryDbV2Raw: number;
  industryDbV2Normalized: number;
  ruleScore: number | "";
  recommendation: string;
  status: string;
  scoreSource: string;
  action: string;
  industryTags: string;
  brandHits: string;
  companyHits: string;
  roleEvidence: string;
  matchedWorkEntries: string;
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

function normalizeString(value: string | undefined): string {
  return typeof value === "string" ? value : "";
}

function normalizeStringArray(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function formatYears(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "0y";
  }

  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1).replace(/\.0$/, "")}y`;
}

function formatRoleEvidence(roleSignals: ResumeIngestData["roleSignals"]): string {
  if (!Array.isArray(roleSignals) || roleSignals.length === 0) {
    return "";
  }

  return roleSignals
    .map((signal) => {
      const relevantYears = signal.roleRelevantYears ?? signal.years;
      const verifiedYears = signal.industryVerifiedRelevantYears ?? signal.industryVerifiedYears ?? 0;
      const parts = [`${signal.type}:${formatYears(relevantYears)}`];

      if (verifiedYears > 0) {
        parts.push(`verified ${formatYears(verifiedYears)}`);
      }
      if (signal.matchedSignals.length > 0) {
        parts.push(`signals ${signal.matchedSignals.join("/")}`);
      }

      return parts.join(" · ");
    })
    .join(" | ");
}

function formatMatchedWorkEntries(roleSignals: ResumeIngestData["roleSignals"]): string {
  if (!Array.isArray(roleSignals) || roleSignals.length === 0) {
    return "";
  }

  return roleSignals
    .flatMap((signal) =>
      (signal.matchedWorkEntries ?? []).map((entry) => {
        const heading = [signal.type, entry.companyName, entry.jobTitle].filter(Boolean).join(" · ");
        const suffix = [
          formatYears(entry.years),
          entry.industryVerified ? "verified" : "",
          entry.matchedSignals.length > 0 ? `signals ${entry.matchedSignals.join("/")}` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return [heading, suffix].filter(Boolean).join(" · ");
      })
    )
    .join(" | ");
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

function resolveBrandDisplayName(
  brandId: string | undefined,
  brandDisplayResolver?: BrandDisplayResolver
): string {
  const normalizedBrandId = normalizeString(brandId).trim();
  if (!normalizedBrandId) {
    return "";
  }

  return brandDisplayResolver
    ? brandDisplayResolver.resolveZhHans(normalizedBrandId)
    : normalizedBrandId.toUpperCase();
}

function summarizeBrandHits(
  brandHits: ResumeIngestData["brandHits"],
  brandDisplayResolver?: BrandDisplayResolver,
  companyPatternAliasLookup?: Map<string, string>
): string {
  if (!Array.isArray(brandHits) || brandHits.length === 0) {
    return "";
  }

  const displayNames = new Set<string>();
  for (const hit of brandHits) {
    if (hit.context === "employer") {
      continue;
    }

    const normalizedBrandId = normalizeCompanyPatternIdentifier(normalizeString(hit.brand));
    if (!normalizedBrandId) {
      continue;
    }

    const canonicalBrandId = companyPatternAliasLookup?.get(normalizedBrandId) ?? normalizedBrandId;
    const displayName = resolveBrandDisplayName(canonicalBrandId, brandDisplayResolver);
    if (displayName) {
      displayNames.add(displayName);
    }
  }

  return Array.from(displayNames).join(", ");
}

function toRow(
  entry: ResumeExportEntry,
  batchNormalizer: (raw: number | undefined) => { raw: number; normalized: number },
  brandDisplayResolver?: BrandDisplayResolver,
  companyPatternAliasLookup?: Map<string, string>
): ExportRow {
  const workHistory = Array.isArray(entry.resume.workHistory)
    ? entry.resume.workHistory
      .map((item) => buildWorkHistoryEntryText(item))
      .filter((item) => item.trim().length > 0)
      .join(" | ")
    : "";
  const { raw: industryDbV2Raw, normalized: industryDbV2Normalized } = batchNormalizer(
    entry.resume.ingestData?.industryDbV2Raw
  );

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
    industryDbV2Raw,
    industryDbV2Normalized,
    ruleScore: typeof entry.ruleScore === "number" ? entry.ruleScore : "",
    recommendation: normalizeString(entry.match?.recommendation),
    status: normalizeString(entry.status),
    scoreSource: normalizeString(entry.match?.scoreSource),
    action: normalizeString(entry.action),
    industryTags: normalizeStringArray(entry.resume.ingestData?.industryTags).join(", "),
    brandHits: summarizeBrandHits(
      entry.resume.ingestData?.brandHits,
      brandDisplayResolver,
      companyPatternAliasLookup
    ),
    companyHits: normalizeStringArray(entry.resume.ingestData?.companyHits)
      .map((brandId) => resolveBrandDisplayName(brandId, brandDisplayResolver))
      .join(", "),
    roleEvidence: formatRoleEvidence(entry.resume.ingestData?.roleSignals),
    matchedWorkEntries: formatMatchedWorkEntries(entry.resume.ingestData?.roleSignals),
    profileUrl: normalizeProfileUrlForDisplay(entry.resume.profileUrl, entry.resume.source),
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
  { header: "Industry DB V2 Raw", key: "industryDbV2Raw", width: 18 },
  { header: "Industry DB V2 Normalized", key: "industryDbV2Normalized", width: 24 },
  { header: "Rule Score", key: "ruleScore", width: 10 },
  { header: "Recommendation", key: "recommendation", width: 16 },
  { header: "Status", key: "status", width: 16 },
  { header: "Score Source", key: "scoreSource", width: 12 },
  { header: "Action", key: "action", width: 12 },
  { header: "Industry Tags", key: "industryTags", width: 22 },
  { header: "Brand Hits", key: "brandHits", width: 34 },
  { header: "Company Hits", key: "companyHits", width: 22 },
  { header: "Role Evidence", key: "roleEvidence", width: 34 },
  { header: "Matched Work Entries", key: "matchedWorkEntries", width: 44 },
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
  private readonly companyPatternAliasLookup: Map<string, string>;

  constructor(
    private readonly brandDisplayResolver?: BrandDisplayResolver,
    companyPatternsOrAliasLookup: CompanyPattern[] | Map<string, string> = []
  ) {
    this.companyPatternAliasLookup = companyPatternsOrAliasLookup instanceof Map
      ? companyPatternsOrAliasLookup
      : buildCompanyPatternAliasLookup(companyPatternsOrAliasLookup);
  }

  async exportResumes(
    format: ExportFormat,
    entries: ResumeExportEntry[],
    batchMeta?: ExportBatchMeta,
    industryDbV2Stats?: IndustryDbV2BatchStats
  ): Promise<ExportFile> {
    const batchNormalizer = createBatchNormalizer(industryDbV2Stats);
    const rows = entries.map((entry) =>
      applyBatchMeta(
        toRow(
          entry,
          batchNormalizer,
          this.brandDisplayResolver,
          this.companyPatternAliasLookup
        ),
        batchMeta
      )
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
