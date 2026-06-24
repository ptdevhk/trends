#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_WORKSPACE = "hr";
export const DEFAULT_COMMENT_COLUMN = "Job Intention";

const UPDATED_BY = "hr-review-comment-import";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const DEFAULT_PROJECT_ROOT = resolveDefaultProjectRoot();

const STATUS_VALUES = new Set([
  "new",
  "shortlisted",
  "rejected",
  "contacted",
  "interviewing",
  "interviewed_pass",
  "interviewed_reject",
  "appeal_submitted",
  "human_review",
  "upheld",
  "reversed",
  "offer",
  "hired",
  "withdrawn",
]);

function resolveDefaultProjectRoot() {
  const fromScript = path.resolve(SCRIPT_DIR, "../..");
  if (existsSync(path.join(fromScript, "package.json"))) {
    return fromScript;
  }
  return process.cwd();
}

function readCliValue(argv, name) {
  const exactIndex = argv.indexOf(name);
  if (exactIndex >= 0) {
    return argv[exactIndex + 1];
  }

  const prefix = `${name}=`;
  const found = argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function normalizeRequiredCliValue(value, label) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

export function parseCliOptions(argv) {
  const suggestFormat = readCliValue(argv, "--suggest-format")?.trim() || "markdown";
  if (!["markdown", "csv", "json"].includes(suggestFormat)) {
    throw new Error("--suggest-format must be markdown, csv, or json");
  }

  return {
    xlsxPath: normalizeRequiredCliValue(readCliValue(argv, "--xlsx"), "--xlsx"),
    projectRoot: readCliValue(argv, "--project-root")?.trim() || DEFAULT_PROJECT_ROOT,
    workspaceSlug: readCliValue(argv, "--workspace")?.trim() || DEFAULT_WORKSPACE,
    commentColumn: readCliValue(argv, "--comment-column")?.trim() || DEFAULT_COMMENT_COLUMN,
    live: hasFlag(argv, "--live"),
    replaceExistingComments: hasFlag(argv, "--replace-existing-comments"),
    suggestStatus: hasFlag(argv, "--suggest-status"),
    suggestFormat,
  };
}

export function normalizeCellValue(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value.text != null) return String(value.text);
  if (value.result != null) return String(value.result);
  if (Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text ?? "").join("");
  }
  return String(value);
}

export function normalizeStatus(value) {
  const status = String(value || "").trim();
  return STATUS_VALUES.has(status) ? status : "new";
}

export function suggestCandidateStatus(comment) {
  const normalized = String(comment || "")
    .trim()
    .replace(/\s+/g, "");

  if (!normalized) {
    return "reject";
  }

  if (
    /空号|无法接通|联系不上|打不通|停机|关机|挂机|不接电话|未接|已读未回复|拉黑/u.test(normalized)
  ) {
    return "block";
  }

  if (/跟进中|已加微信|加微信|后期考虑|随时联系|继续联系|继续跟进|可联系/u.test(normalized)) {
    return "shortlist";
  }

  if (
    /不考虑|不换工作|不感兴趣|暂无需求|无需求|不优选|薪资.*高|要求.*高|无.*经验|没有.*经验|不了解|不符|不熟悉|暂不考虑|区域暂无招聘需求|国产机销售经验/u.test(normalized)
  ) {
    return "reject";
  }

  return "reject";
}

export function buildSuggestionRows(rows) {
  return rows.map((row) => ({
    resumeId: row.resumeId,
    name: row.name,
    status: suggestCandidateStatus(row.comment),
  }));
}

function escapeMarkdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

function escapeCsvCell(value) {
  const raw = String(value ?? "");
  if (!/[",\n\r]/u.test(raw)) {
    return raw;
  }
  return `"${raw.replace(/"/g, '""')}"`;
}

export function formatSuggestionRows(rows, format) {
  if (format === "json") {
    return JSON.stringify(rows, null, 2);
  }

  if (format === "csv") {
    return [
      ["resumeId", "name", "status"].join(","),
      ...rows.map((row) => [row.resumeId, row.name, row.status].map(escapeCsvCell).join(",")),
    ].join("\n");
  }

  return [
    "| Resume ID | Name | Status |",
    "| --- | --- | --- |",
    ...rows.map((row) =>
      `| ${escapeMarkdownCell(row.resumeId)} | ${escapeMarkdownCell(row.name)} | ${escapeMarkdownCell(row.status)} |`
    ),
  ].join("\n");
}

function buildHeaderMap(sheet) {
  const map = new Map();
  const values = sheet.getRow(1).values;
  for (let index = 1; index < values.length; index += 1) {
    const header = String(values[index] ?? "").trim();
    if (header && !map.has(header)) {
      map.set(header, index);
    }
  }
  return map;
}

function readCell(row, headers, header) {
  const index = headers.get(header);
  if (typeof index !== "number") return "";
  return normalizeCellValue(row.getCell(index).value).trim();
}

export async function readWorkbookRows(options) {
  const requireFromProject = createRequire(path.join(options.projectRoot, "package.json"));
  const ExcelJS = requireFromProject("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(options.xlsxPath);
  const sheet = workbook.getWorksheet("Resumes") ?? workbook.worksheets[0];
  if (!sheet) {
    throw new Error("No worksheet found");
  }

  const headers = buildHeaderMap(sheet);
  for (const required of ["Resume ID", "Name", options.commentColumn, "Status", "User Comment", "Profile URL"]) {
    if (!headers.has(required)) {
      throw new Error(`Missing required header: ${required}`);
    }
  }

  const rows = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const item = {
      rowNumber,
      resumeId: readCell(row, headers, "Resume ID"),
      name: readCell(row, headers, "Name"),
      comment: readCell(row, headers, options.commentColumn),
      exportedStatus: normalizeStatus(readCell(row, headers, "Status")),
      exportedUserComment: readCell(row, headers, "User Comment"),
      profileUrl: readCell(row, headers, "Profile URL"),
    };
    if (Object.values(item).some((value) => String(value).trim().length > 0)) {
      rows.push(item);
    }
  }
  return rows;
}

function validateWorkbookRows(rows) {
  const duplicateResumeIds = [
    ...new Set(rows.map((row) => row.resumeId).filter((id, index, all) => id && all.indexOf(id) !== index)),
  ];
  const missingResumeIds = rows.filter((row) => !row.resumeId).map((row) => row.rowNumber);
  const missingComments = rows.filter((row) => !row.comment).map((row) => row.rowNumber);

  return {
    valid: duplicateResumeIds.length === 0 && missingResumeIds.length === 0 && missingComments.length === 0,
    duplicateResumeIds,
    missingResumeIds,
    missingComments,
  };
}

async function loadConvex(projectRoot) {
  const requireFromProject = createRequire(path.join(projectRoot, "package.json"));
  const { ConvexHttpClient } = requireFromProject("convex/browser");
  const { api } = await import(pathToFileURL(path.join(projectRoot, "packages/convex/convex/_generated/api.js")).href);
  return { ConvexHttpClient, api };
}

function buildBlockerSummary(options) {
  const blockers = [];
  if (options.missingInProd.length) blockers.push("missing-prod-resumes");
  if (options.existingCommentConflicts.length && !options.replaceExistingComments) {
    blockers.push("existing-comment-conflicts");
  }
  if (options.live && !process.env.CONVEX_WRITE_SECRET?.trim()) {
    blockers.push("missing-CONVEX_WRITE_SECRET");
  }
  return blockers;
}

export async function buildImportPlan(options) {
  const rows = await readWorkbookRows(options);
  const rowValidation = validateWorkbookRows(rows);
  if (!rowValidation.valid) {
    return {
      ok: false,
      rowValidation,
      rows,
      plans: [],
      missingInProd: [],
      wouldUpdate: [],
      existingCommentConflicts: [],
      blockers: ["invalid-workbook-rows"],
    };
  }

  const { ConvexHttpClient, api } = await loadConvex(options.projectRoot);
  const client = new ConvexHttpClient(process.env.CONVEX_URL || "http://127.0.0.1:3210");
  const docs = await client.query(api.resumes_search.getResumeDocsByIdentityKeys, {
    identityKeys: rows.map((row) => row.resumeId),
  });
  const docByResumeId = new Map(docs.map((doc) => [String(doc._id), doc]));
  const missingInProd = rows.filter((row) => !docByResumeId.has(row.resumeId));

  const plans = [];
  for (const row of rows) {
    const doc = docByResumeId.get(row.resumeId);
    if (!doc) continue;
    const identityKey = String(doc.identityKey || doc._id);
    const existing = await client.query(api.candidate_status.getByIdentity, {
      workspaceSlug: options.workspaceSlug,
      identityKey,
    });
    plans.push({
      row,
      identityKey,
      existing,
      nextStatus: existing?.status && STATUS_VALUES.has(existing.status) ? existing.status : row.exportedStatus,
      nextNotes: row.comment.trim(),
    });
  }

  const existingCommentConflicts = plans
    .filter(({ row, existing }) => {
      const oldNote = String(existing?.notes ?? "").trim();
      return oldNote && oldNote !== row.comment.trim();
    })
    .map(({ row, identityKey, existing }) => ({
      row: row.rowNumber,
      resumeId: row.resumeId,
      identityKey,
      name: row.name,
      existingStatus: existing.status,
      existingNotes: existing.notes,
      nextComment: row.comment,
    }));

  const wouldUpdate = plans.filter(({ row, existing }) => String(existing?.notes ?? "").trim() !== row.comment.trim());
  const blockers = buildBlockerSummary({
    missingInProd,
    existingCommentConflicts,
    replaceExistingComments: options.replaceExistingComments,
    live: options.live,
  });

  return {
    ok: blockers.length === 0,
    rowValidation,
    rows,
    docs,
    client,
    api,
    plans,
    missingInProd,
    wouldUpdate,
    existingCommentConflicts,
    blockers,
  };
}

export async function runLiveWrites(plan, options) {
  let writes = 0;
  const writeErrors = [];

  if (!options.live || !plan.ok) {
    return { writes, writeErrors, verifiedMatches: 0 };
  }

  for (const item of plan.wouldUpdate) {
    try {
      await plan.client.mutation(plan.api.candidate_status.upsert, {
        workspaceSlug: options.workspaceSlug,
        identityKey: item.identityKey,
        status: item.nextStatus,
        notes: item.nextNotes,
        updatedBy: UPDATED_BY,
        writeSecret: process.env.CONVEX_WRITE_SECRET,
      });
      writes += 1;
    } catch (error) {
      writeErrors.push({
        row: item.row.rowNumber,
        resumeId: item.row.resumeId,
        identityKey: item.identityKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let verifiedMatches = 0;
  if (writeErrors.length === 0) {
    for (const item of plan.wouldUpdate) {
      const after = await plan.client.query(plan.api.candidate_status.getByIdentity, {
        workspaceSlug: options.workspaceSlug,
        identityKey: item.identityKey,
      });
      if (String(after?.notes ?? "").trim() === item.nextNotes) {
        verifiedMatches += 1;
      }
    }
  }

  return { writes, writeErrors, verifiedMatches };
}

function buildImportOutput(plan, writeResult, options) {
  return {
    ok: plan.ok && writeResult.writeErrors.length === 0,
    dryRun: !options.live,
    workspaceSlug: options.workspaceSlug,
    workbookRows: plan.rows.length,
    resolvedProdResumes: plan.docs?.length ?? 0,
    missingInProd: plan.missingInProd.map((row) => ({
      row: row.rowNumber,
      resumeId: row.resumeId,
      name: row.name,
      profileUrl: row.profileUrl,
    })),
    wouldUpdate: plan.wouldUpdate.length,
    alreadySame: plan.plans.length - plan.wouldUpdate.length,
    existingCommentConflicts: plan.existingCommentConflicts,
    blockers: plan.blockers,
    writes: writeResult.writes,
    writeErrors: writeResult.writeErrors,
    verifiedMatches: writeResult.verifiedMatches,
    sampleUpdates: plan.wouldUpdate.slice(0, 5).map((item) => ({
      row: item.row.rowNumber,
      resumeId: item.row.resumeId,
      identityKey: item.identityKey,
      name: item.row.name,
      statusToPreserve: item.nextStatus,
      previousNotes: item.existing?.notes ?? "",
      nextComment: item.nextNotes,
    })),
  };
}

function usage() {
  return `Usage:
  node scripts/resume/import-hr-review-comments.mjs --xlsx /tmp/hr-review-comments-2026-06-09.xlsx [--workspace hr] [--live] [--replace-existing-comments]
  node scripts/resume/import-hr-review-comments.mjs --xlsx /tmp/hr-review-comments-2026-06-09.xlsx --suggest-status [--suggest-format markdown|csv|json]

Defaults:
  dry-run only unless --live is passed
  workspace: ${DEFAULT_WORKSPACE}
  comment column: ${DEFAULT_COMMENT_COLUMN}

Notes:
  --workspace accepts the target workspace slug. Quote it in the shell if it contains spaces.
  --suggest-status only reads the workbook and prints resumeId, name, status suggestions.
`;
}

export async function runCli(argv) {
  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    console.log(usage());
    return 0;
  }

  const options = parseCliOptions(argv);
  if (options.suggestStatus) {
    const rows = await readWorkbookRows(options);
    console.log(formatSuggestionRows(buildSuggestionRows(rows), options.suggestFormat));
    return 0;
  }

  const plan = await buildImportPlan(options);
  const writeResult = await runLiveWrites(plan, options);
  const output = buildImportOutput(plan, writeResult, options);
  console.log(JSON.stringify(output, null, 2));
  return output.ok ? 0 : 1;
}

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === SCRIPT_PATH : false;

if (isMain) {
  const code = await runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    return 1;
  });
  process.exitCode = code;
}
