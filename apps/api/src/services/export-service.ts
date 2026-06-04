import ExcelJS from "exceljs";
import Papa from "papaparse";
import {
  buildWorkHistoryEntryText,
  computeFinalAiScore,
  computeRelatedExpContribution,
  inferSeekMarket,
  normalizeProfileUrlForDisplay,
  recommendationFromFinalAiScore,
  type ExportFieldsConfig,
  type ResumeWorkHistoryItem as SharedResumeWorkHistoryItem,
  EXPORT_CORE_FIELDS,
  EXPORT_DEBUG_FIELDS,
  type ExportFieldKey,
} from "@trends/shared";
import type { BrandDisplayResolver } from "./brand-display-resolver.js";
import {
  buildCompanyPatternAliasLookup,
  normalizeCompanyPatternIdentifier,
  type CompanyPattern,
} from "./skills-knowledge.js";
import {
  computeDirectIndustryDbScore,
  computeEffectiveIndustryDbV2Raw,
  createBatchNormalizer,
  type IndustryDbV2BatchStats,
} from "./industry-db-batch-stats.js";
import type { ResumeIngestData } from "../types/resume.js";

export type ExportFormat = "csv" | "xlsx";

type ResumeWorkHistoryItem = Partial<SharedResumeWorkHistoryItem> & {
  raw?: string;
};

type ResumeExportPayload = {
  externalId?: string;
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
  breakdown?: Record<string, number>;
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
  userRating?: number;
};

type ExportRow = {
  resumeId: string;
  externalId: string;
  source: string;
  name: string;
  jobIntention: string;
  location: string;
  experience: string;
  education: string;
  age: number | "";
  expectedSalary: string;
  aiScore: number | "";
  finalAiScore: number | "";
  relatedExpAuditFactor: number | "";
  relatedExpContribution: number | "";
  industryDb: number;
  relatedExp: number | "";
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
  userRating: number | "";
};

type ReviewPacketRow = ExportRow & {
  packetRunId: string;
  exportedAt: string;
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
  const ingestData = entry.resume.ingestData;
  const effectiveRaw = computeEffectiveIndustryDbV2Raw(ingestData);
  const { raw: industryDbV2Raw, normalized: industryDbV2Normalized } = batchNormalizer(effectiveRaw);
  const relatedExp = typeof entry.match?.breakdown?.related_exp === "number"
    ? entry.match.breakdown.related_exp
    : undefined;
  // Prefer client-sent values: the web applies overrideIndustryDbBreakdown before sending,
  // so match.breakdown.industry_db and match.score already reflect the UI scoring.
  // Fall back to the same direct rule when no match is sent. Keep debug-only batch
  // normalization columns intact for diagnostics.
  const industryDb = typeof entry.match?.breakdown?.industry_db === "number"
    ? entry.match.breakdown.industry_db
    : computeDirectIndustryDbScore(ingestData);
  const aiScore: number | "" = typeof entry.match?.score === "number"
    ? entry.match.score
    : "";
  const relatedExpAuditFactor = relatedExp;
  const relatedExpContribution = relatedExp !== undefined
    ? computeRelatedExpContribution(relatedExp)
    : "";
  const finalAiScore = aiScore;

  return {
    resumeId: entry.key,
    externalId: normalizeString(entry.resume.externalId),
    source: normalizeString(entry.resume.source),
    name: normalizeString(entry.resume.name),
    jobIntention: normalizeString(entry.resume.jobIntention),
    location: normalizeString(entry.resume.location),
    experience: normalizeString(entry.resume.experience),
    education: normalizeString(entry.resume.education),
    age: parseAgeNumber(entry.resume.age) ?? "",
    expectedSalary: normalizeString(entry.resume.expectedSalary),
    aiScore,
    finalAiScore,
    relatedExpAuditFactor: relatedExpAuditFactor !== undefined ? relatedExpAuditFactor : "",
    relatedExpContribution,
    industryDb,
    relatedExp: relatedExp ?? "",
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
    profileUrl: normalizeProfileUrlForDisplay(
      entry.resume.profileUrl,
      entry.resume.source,
      {
        name: entry.resume.name,
        market: entry.resume.source?.includes("seek") ? inferSeekMarket(entry.resume.source) : undefined,
        roleTitles: entry.resume.workHistory?.[0]?.jobTitle,
      }
    ),
    workHistory,
    selfIntro: normalizeString(entry.resume.selfIntro),
    aiSummary: normalizeString(entry.match?.summary),
    userComment: normalizeString(entry.userComment),
    referenceNote: normalizeString(entry.referenceNote),
    userRating: typeof entry.userRating === "number" ? entry.userRating : "",
  };
}

type ExcelColumn = { header: string; key: keyof ExportRow; width: number };
type ReviewPacketExcelColumn = { header: string; key: keyof ReviewPacketRow; width: number };

const STANDARD_EXCEL_COLUMNS_HEAD: ExcelColumn[] = [
  { header: "Resume ID", key: "resumeId", width: 24 },
  { header: "Name", key: "name", width: 16 },
  { header: "Job Intention", key: "jobIntention", width: 20 },
  { header: "Location", key: "location", width: 14 },
  { header: "Experience", key: "experience", width: 14 },
  { header: "Education", key: "education", width: 14 },
  { header: "Age", key: "age", width: 10 },
  { header: "Expected Salary", key: "expectedSalary", width: 16 },
  { header: "AI Score", key: "aiScore", width: 10 },
  { header: "Final AI Score", key: "finalAiScore", width: 16 },
  { header: "Related Exp Audit Factor", key: "relatedExpAuditFactor", width: 24 },
  { header: "Related Exp Contribution", key: "relatedExpContribution", width: 24 },
  { header: "Industry DB", key: "industryDb", width: 14 },
  { header: "Related Exp", key: "relatedExp", width: 14 },
];

const STANDARD_EXCEL_COLUMNS_MID: ExcelColumn[] = [
  { header: "Source", key: "source", width: 16 },
];

const DEBUG_EXCEL_COLUMNS: ExcelColumn[] = [
  { header: "External ID", key: "externalId", width: 36 },
  { header: "Industry DB V2 Raw", key: "industryDbV2Raw", width: 18 },
  { header: "Industry DB V2 Normalized", key: "industryDbV2Normalized", width: 24 },
  { header: "Role Evidence", key: "roleEvidence", width: 34 },
  { header: "Matched Work Entries", key: "matchedWorkEntries", width: 44 },
];

const STANDARD_EXCEL_COLUMNS_TAIL: ExcelColumn[] = [
  { header: "Rule Score", key: "ruleScore", width: 10 },
  { header: "Recommendation", key: "recommendation", width: 16 },
  { header: "Status", key: "status", width: 16 },
  { header: "Score Source", key: "scoreSource", width: 12 },
  { header: "Action", key: "action", width: 12 },
  { header: "Industry Tags", key: "industryTags", width: 22 },
  { header: "Brand Hits", key: "brandHits", width: 34 },
  { header: "Company Hits", key: "companyHits", width: 22 },
  { header: "User Rating", key: "userRating", width: 12 },
  { header: "Profile URL", key: "profileUrl", width: 28 },
  { header: "Work History", key: "workHistory", width: 44 },
  { header: "Self Intro", key: "selfIntro", width: 48 },
  { header: "AI Summary", key: "aiSummary", width: 48 },
  { header: "User Comment", key: "userComment", width: 36 },
  { header: "Reference Note", key: "referenceNote", width: 36 },
];

const ALL_EXCEL_COLUMNS: ExcelColumn[] = [
  ...STANDARD_EXCEL_COLUMNS_HEAD,
  ...STANDARD_EXCEL_COLUMNS_MID,
  ...DEBUG_EXCEL_COLUMNS,
  ...STANDARD_EXCEL_COLUMNS_TAIL,
];

const EXCEL_COLUMN_BY_KEY = new Map<string, ExcelColumn>(
  ALL_EXCEL_COLUMNS.map((col) => [col.key, col]),
);

function getExcelColumns(debug: boolean, fieldConfig?: ExportFieldsConfig | null): ExcelColumn[] {
  if (!fieldConfig || fieldConfig.fields.length === 0) {
    const defaultKeys = debug
      ? [...EXPORT_CORE_FIELDS, ...EXPORT_DEBUG_FIELDS]
      : [...EXPORT_CORE_FIELDS];
    return defaultKeys
      .map((key) => EXCEL_COLUMN_BY_KEY.get(key))
      .filter((col): col is ExcelColumn => col !== undefined);
  }

  // Build columns from configured field list, preserving config order
  const columns: ExcelColumn[] = [];
  for (const key of fieldConfig.fields) {
    const col = EXCEL_COLUMN_BY_KEY.get(key);
    if (col) columns.push(col);
  }

  // Optionally append debug columns not already in the list
  if (debug && fieldConfig.includeDebugWhenEnabled) {
    const presentKeys = new Set(columns.map((c) => c.key));
    for (const debugKey of EXPORT_DEBUG_FIELDS) {
      if (!presentKeys.has(debugKey)) {
        const col = EXCEL_COLUMN_BY_KEY.get(debugKey);
        if (col) columns.push(col);
      }
    }
  }

  return columns;
}


export type ExportBatchMeta = {
  userComment?: string;
  referenceNote?: string;
};

export type ReviewPacketExportOptions = {
  packetRunId: string;
  exportedAt: string;
  batchMeta?: ExportBatchMeta;
  industryDbV2Stats?: IndustryDbV2BatchStats;
  debug?: boolean;
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

const REVIEW_PACKET_EXCEL_COLUMNS_HEAD: ReviewPacketExcelColumn[] = [
  { header: "Resume ID", key: "resumeId", width: 24 },
  { header: "Packet Run ID", key: "packetRunId", width: 40 },
  { header: "Exported At", key: "exportedAt", width: 28 },
  { header: "Name", key: "name", width: 16 },
  { header: "Job Intention", key: "jobIntention", width: 20 },
  { header: "Location", key: "location", width: 14 },
  { header: "Experience", key: "experience", width: 14 },
  { header: "Education", key: "education", width: 14 },
  { header: "Age", key: "age", width: 10 },
  { header: "Expected Salary", key: "expectedSalary", width: 16 },
  { header: "AI Score", key: "aiScore", width: 10 },
  { header: "Final AI Score", key: "finalAiScore", width: 16 },
  { header: "Related Exp Audit Factor", key: "relatedExpAuditFactor", width: 24 },
  { header: "Related Exp Contribution", key: "relatedExpContribution", width: 24 },
  { header: "Industry DB", key: "industryDb", width: 14 },
  { header: "Related Exp", key: "relatedExp", width: 14 },
];

const REVIEW_PACKET_DEBUG_EXCEL_COLUMNS: ReviewPacketExcelColumn[] = [
  { header: "External ID", key: "externalId", width: 36 },
  { header: "Industry DB V2 Raw", key: "industryDbV2Raw", width: 18 },
  { header: "Industry DB V2 Normalized", key: "industryDbV2Normalized", width: 24 },
  { header: "Role Evidence", key: "roleEvidence", width: 34 },
  { header: "Matched Work Entries", key: "matchedWorkEntries", width: 44 },
];

const REVIEW_PACKET_EXCEL_COLUMNS_MACHINE_TAIL: ReviewPacketExcelColumn[] = [
  { header: "Source", key: "source", width: 16 },
  { header: "Rule Score", key: "ruleScore", width: 10 },
  { header: "Recommendation", key: "recommendation", width: 16 },
  { header: "Score Source", key: "scoreSource", width: 12 },
  { header: "Industry Tags", key: "industryTags", width: 22 },
  { header: "Brand Hits", key: "brandHits", width: 34 },
  { header: "Company Hits", key: "companyHits", width: 22 },
  { header: "Profile URL", key: "profileUrl", width: 28 },
  { header: "Work History", key: "workHistory", width: 44 },
  { header: "Self Intro", key: "selfIntro", width: 48 },
  { header: "AI Summary", key: "aiSummary", width: 48 },
];

const REVIEW_PACKET_EXCEL_COLUMNS_HUMAN: ReviewPacketExcelColumn[] = [
  { header: "Status", key: "status", width: 16 },
  { header: "Action", key: "action", width: 12 },
  { header: "User Rating", key: "userRating", width: 12 },
  { header: "User Comment", key: "userComment", width: 36 },
  { header: "Reference Note", key: "referenceNote", width: 36 },
];

function getReviewPacketExcelColumns(debug: boolean): ReviewPacketExcelColumn[] {
  return debug
    ? [
        ...REVIEW_PACKET_EXCEL_COLUMNS_HEAD,
        ...REVIEW_PACKET_DEBUG_EXCEL_COLUMNS,
        ...REVIEW_PACKET_EXCEL_COLUMNS_MACHINE_TAIL,
        ...REVIEW_PACKET_EXCEL_COLUMNS_HUMAN,
      ]
    : [
        ...REVIEW_PACKET_EXCEL_COLUMNS_HEAD,
        ...REVIEW_PACKET_EXCEL_COLUMNS_MACHINE_TAIL,
        ...REVIEW_PACKET_EXCEL_COLUMNS_HUMAN,
      ];
}

function toReviewPacketRow(row: ExportRow, options: { packetRunId: string; exportedAt: string }): ReviewPacketRow {
  return {
    ...row,
    packetRunId: options.packetRunId,
    exportedAt: options.exportedAt,
  };
}

function toReviewPacketCsvRow(
  row: ReviewPacketRow,
  debug: boolean
): Record<string, string | number | ""> {
  const record: Record<string, string | number | ""> = {};
  for (const column of getReviewPacketExcelColumns(debug)) {
    record[column.header] = row[column.key];
  }
  return record;
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
    industryDbV2Stats?: IndustryDbV2BatchStats,
    debug = false,
    fieldConfig?: ExportFieldsConfig | null,
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
      const content = await this.toXlsx(rows, debug, fieldConfig);
      return {
        extension: "xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content,
      };
    }

    const columns = getExcelColumns(debug, fieldConfig);
    const outputRows = rows.map((row) => {
      const filtered: Record<string, string | number | ""> = {};
      for (const col of columns) {
        filtered[col.key] = row[col.key];
      }
      return filtered;
    });
    const csv = Papa.unparse(outputRows, { header: true, newline: "\n" });
    return {
      extension: "csv",
      contentType: "text/csv; charset=utf-8",
      content: Buffer.from(csv, "utf8"),
    };
  }

  async exportReviewPacket(
    format: ExportFormat,
    entries: ResumeExportEntry[],
    options: ReviewPacketExportOptions,
  ): Promise<ExportFile> {
    const batchNormalizer = createBatchNormalizer(options.industryDbV2Stats);
    const debug = options.debug ?? false;
    const rows = entries.map((entry) =>
      toReviewPacketRow(
        applyBatchMeta(
          toRow(
            entry,
            batchNormalizer,
            this.brandDisplayResolver,
            this.companyPatternAliasLookup
          ),
          options.batchMeta
        ),
        {
          packetRunId: options.packetRunId,
          exportedAt: options.exportedAt,
        }
      )
    );

    if (format === "xlsx") {
      const content = await this.toReviewPacketXlsx(rows, debug);
      return {
        extension: "xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content,
      };
    }

    const csv = Papa.unparse(rows.map((row) => toReviewPacketCsvRow(row, debug)), {
      header: true,
      newline: "\n",
    });
    return {
      extension: "csv",
      contentType: "text/csv; charset=utf-8",
      content: Buffer.from(csv, "utf8"),
    };
  }

  private async toXlsx(rows: ExportRow[], debug: boolean, fieldConfig?: ExportFieldsConfig | null): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Resumes");

    sheet.columns = getExcelColumns(debug, fieldConfig);
    rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true };

    const data = await workbook.xlsx.writeBuffer();
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data);
    }
    return Buffer.from(data);
  }

  private async toReviewPacketXlsx(rows: ReviewPacketRow[], debug: boolean): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Review Packet");

    sheet.columns = getReviewPacketExcelColumns(debug);
    rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true };

    const data = await workbook.xlsx.writeBuffer();
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data);
    }
    return Buffer.from(data);
  }
}
