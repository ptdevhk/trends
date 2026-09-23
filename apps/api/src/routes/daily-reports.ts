import { OpenAPIHono } from "@hono/zod-openapi";

import { parseDailyReportPack, renderDailyReportHtml } from "@trends/shared";

import { callConvexQuery } from "../services/convex-utils.js";
import { getConvexWriteSecret } from "../services/config.js";

const app = new OpenAPIHono();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

import type { Context } from "hono";

function notFound(c: Context, message: string) {
  return c.json({ success: false as const, error: message }, 404);
}

type DailyReportRow = {
  date: string;
  packJson: string;
  html: string;
  source: string;
  fallbackFromDate?: string;
  builtAt: number;
};

async function fetchReport(date: string): Promise<DailyReportRow | null> {
  const row = await callConvexQuery("daily_reports:getByDate", { date, writeSecret: getConvexWriteSecret() }) as DailyReportRow | null;
  // Defensive: a corrupt packJson row is treated as absent (404), never a 500.
  if (row) {
    try {
      JSON.parse(row.packJson);
    } catch {
      return null;
    }
  }
  return row;
}

async function fetchDateList(): Promise<Array<{ date: string; source: string; builtAt: number }>> {
  return await callConvexQuery("daily_reports:listDates", { writeSecret: getConvexWriteSecret() }) as Array<{ date: string; source: string; builtAt: number }>;
}

/**
 * Parse the :file path segment and validate that it is either "index.json"
 * or a YYYY-MM-DD date followed by .json or .html.
 */
function parseFileSegment(file: string):
  | { kind: "index"; ext: "json" }
  | { kind: "date"; date: string; ext: "json" | "html" }
  | null {
  if (file === "index.json") {
    return { kind: "index", ext: "json" };
  }
  const lastDot = file.lastIndexOf(".");
  if (lastDot < 0) return null;
  const name = file.slice(0, lastDot);
  const ext = file.slice(lastDot + 1);
  if (!DATE_RE.test(name)) return null;
  if (ext !== "json" && ext !== "html") return null;
  return { kind: "date", date: name, ext };
}

app.get("/daily/:file", async (c) => {
  const file = c.req.param("file");
  const parsed = parseFileSegment(file);
  if (!parsed) {
    return notFound(c, "Not found");
  }

  if (parsed.kind === "index") {
    const dates = await fetchDateList();
    c.header("Cache-Control", "public, max-age=60");
    return c.json({ dates: dates.map((d) => d.date) });
  }

  const { date, ext } = parsed;
  const row = await fetchReport(date);
  if (!row) {
    return notFound(c, "Report not found");
  }

  if (ext === "json") {
    return c.json(JSON.parse(row.packJson), 200, {
      "Content-Type": "application/json; charset=utf-8",
    });
  }

  // Always re-render from packJson so shared CSS/layout fixes (e.g. story
  // cover crop) ship without re-upserting stored html. Fall back to the
  // build-time html blob only if the pack is unreadable.
  let html = row.html;
  try {
    const pack = parseDailyReportPack(JSON.parse(row.packJson));
    html = renderDailyReportHtml(pack);
  } catch {
    if (!html) return notFound(c, "Report not found");
  }

  c.header("Cache-Control", "public, max-age=60");
  return c.html(html, 200, {
    "Content-Type": "text/html; charset=utf-8",
  });
});

export default app;
