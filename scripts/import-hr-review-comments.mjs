#!/usr/bin/env node
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_PROJECT_ROOT = "/opt/trends";
const DEFAULT_WORKSPACE = "hr";
const DEFAULT_COMMENT_COLUMN = "Job Intention";
const UPDATED_BY = "hr-review-comment-import";

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

const STATUS_ALIASES = new Map([
  ["shortlist", "shortlisted"],
  ["shortlisted", "shortlisted"],
  ["reject", "rejected"],
  ["rejected", "rejected"],
]);

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log(`Usage:
  node scripts/import-hr-review-comments.mjs --xlsx /tmp/hr-review-comments-2026-06-09.xlsx [--workspace hr] [--live] [--replace-existing-comments]
  node scripts/import-hr-review-comments.mjs --xlsx /tmp/hr-review-comments-2026-06-09.xlsx --suggest-statuses [--shortlist-names 程先生,焦先生] [--block-names 张先生]

Defaults:
  dry-run only unless --live is passed
  project root: ${DEFAULT_PROJECT_ROOT}
  workspace: ${DEFAULT_WORKSPACE}
  comment column: ${DEFAULT_COMMENT_COLUMN}

Status suggestions:
  --suggest-statuses only prints a Markdown review table; it never writes to Convex.
  Suggested status labels are shortlist, reject, or block.
`);
}

function normalizeCellValue(value) {
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

function normalizeStatus(value) {
  const status = String(value || "").trim();
  const normalized = status.toLowerCase();
  const alias = STATUS_ALIASES.get(normalized);
  if (alias) return alias;
  return STATUS_VALUES.has(normalized) ? normalized : "new";
}

function parseNameSet(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function suggestStatus(row, shortlistNames, blockNames) {
  if (blockNames.has(row.name)) return "block";
  if (shortlistNames.has(row.name)) return "shortlist";

  const comment = row.comment.trim();
  if (/拉黑|黑名单|封锁|不要再联系|block|blocked|blocklist/i.test(comment)) {
    return "block";
  }
  if (/不优选|不考虑|暂不考虑|不换工作|不感兴趣|无法接通|空号|暂无需求/i.test(comment)) {
    return "reject";
  }
  if (/已加微信|加微信|后期考虑|随时联系|保持联系|后续联系|可以联系|愿意聊|约面|面试|shortlist/i.test(comment)) {
    return "shortlist";
  }
  return "reject";
}

function escapeMarkdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function printStatusSuggestions(rows, options) {
  const shortlistNames = parseNameSet(options.shortlistNames);
  const blockNames = parseNameSet(options.blockNames);

  console.log("| resumeId | name | status | comment |");
  console.log("| --- | --- | --- | --- |");
  for (const row of rows) {
    const status = suggestStatus(row, shortlistNames, blockNames);
    console.log(
      `| ${escapeMarkdownCell(row.resumeId)} | ${escapeMarkdownCell(row.name)} | ${status} | ${escapeMarkdownCell(row.comment)} |`,
    );
  }
}

async function readWorkbookRows(xlsxPath, ExcelJS, commentColumn) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const sheet = workbook.getWorksheet("Resumes") ?? workbook.worksheets[0];
  if (!sheet) {
    throw new Error("No worksheet found");
  }

  const headers = buildHeaderMap(sheet);
  for (const required of ["Resume ID", "Name", commentColumn, "Status", "User Comment", "Profile URL"]) {
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
      comment: readCell(row, headers, commentColumn),
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

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    usage();
    return;
  }

  const xlsxPath = readArg("--xlsx");
  if (!xlsxPath) {
    usage();
    throw new Error("--xlsx is required");
  }

  const projectRoot = readArg("--project-root", DEFAULT_PROJECT_ROOT);
  const workspaceSlug = readArg("--workspace", DEFAULT_WORKSPACE);
  const commentColumn = readArg("--comment-column", DEFAULT_COMMENT_COLUMN);
  const live = hasFlag("--live");
  const replaceExistingComments = hasFlag("--replace-existing-comments");
  const suggestStatuses = hasFlag("--suggest-statuses");

  const requireFromProject = createRequire(path.join(projectRoot, "package.json"));
  const ExcelJS = requireFromProject("exceljs");
  const rows = await readWorkbookRows(xlsxPath, ExcelJS, commentColumn);

  if (suggestStatuses) {
    printStatusSuggestions(rows, {
      shortlistNames: readArg("--shortlist-names", ""),
      blockNames: readArg("--block-names", ""),
    });
    return;
  }

  const duplicateResumeIds = [
    ...new Set(rows.map((row) => row.resumeId).filter((id, index, all) => id && all.indexOf(id) !== index)),
  ];
  const missingResumeIds = rows.filter((row) => !row.resumeId).map((row) => row.rowNumber);
  const missingComments = rows.filter((row) => !row.comment).map((row) => row.rowNumber);
  if (duplicateResumeIds.length || missingResumeIds.length || missingComments.length) {
    console.log(JSON.stringify({ ok: false, duplicateResumeIds, missingResumeIds, missingComments }, null, 2));
    process.exitCode = 1;
    return;
  }

  const { ConvexHttpClient } = requireFromProject("convex/browser");
  const { api } = await import(pathToFileURL(path.join(projectRoot, "packages/convex/convex/_generated/api.js")).href);

  const convexUrl = process.env.CONVEX_URL || "http://127.0.0.1:3210";
  const client = new ConvexHttpClient(convexUrl);
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
    const existing = await client.query(api.candidate_status.getByIdentity, { workspaceSlug, identityKey });
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
  const blockers = [];
  if (missingInProd.length) blockers.push("missing-prod-resumes");
  if (existingCommentConflicts.length && !replaceExistingComments) blockers.push("existing-comment-conflicts");
  if (live && !process.env.CONVEX_WRITE_SECRET?.trim()) blockers.push("missing-CONVEX_WRITE_SECRET");

  let writes = 0;
  const writeErrors = [];
  if (live && blockers.length === 0) {
    for (const plan of wouldUpdate) {
      try {
        await client.mutation(api.candidate_status.upsert, {
          workspaceSlug,
          identityKey: plan.identityKey,
          status: plan.nextStatus,
          notes: plan.nextNotes,
          updatedBy: UPDATED_BY,
          writeSecret: process.env.CONVEX_WRITE_SECRET,
        });
        writes += 1;
      } catch (error) {
        writeErrors.push({
          row: plan.row.rowNumber,
          resumeId: plan.row.resumeId,
          identityKey: plan.identityKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  let verifiedMatches = 0;
  if (live && writeErrors.length === 0 && blockers.length === 0) {
    for (const plan of wouldUpdate) {
      const after = await client.query(api.candidate_status.getByIdentity, {
        workspaceSlug,
        identityKey: plan.identityKey,
      });
      if (String(after?.notes ?? "").trim() === plan.nextNotes) {
        verifiedMatches += 1;
      }
    }
  }

  const ok = blockers.length === 0 && writeErrors.length === 0;
  console.log(JSON.stringify({
    ok,
    dryRun: !live,
    workspaceSlug,
    workbookRows: rows.length,
    resolvedProdResumes: docs.length,
    missingInProd: missingInProd.map((row) => ({
      row: row.rowNumber,
      resumeId: row.resumeId,
      name: row.name,
      profileUrl: row.profileUrl,
    })),
    wouldUpdate: wouldUpdate.length,
    alreadySame: plans.length - wouldUpdate.length,
    existingCommentConflicts,
    blockers,
    writes,
    writeErrors,
    verifiedMatches,
    sampleUpdates: wouldUpdate.slice(0, 5).map((plan) => ({
      row: plan.row.rowNumber,
      resumeId: plan.row.resumeId,
      identityKey: plan.identityKey,
      name: plan.row.name,
      statusToPreserve: plan.nextStatus,
      previousNotes: plan.existing?.notes ?? "",
      nextComment: plan.nextNotes,
    })),
  }, null, 2));

  if (!ok) {
    process.exitCode = 1;
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
