import { OpenAPIHono } from "@hono/zod-openapi";

import {
  embedPackRemoteCovers,
  parseDailyReportPack,
  renderDailyReportHtml,
  type DailyReportPack,
} from "@trends/shared";

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

/**
 * In-memory shareable HTML cache keyed by date + builtAt.
 * PackJson keeps remote cover URLs (Convex 1 MiB). On HTML serve we clone,
 * wrap each remote as a real-photo SVG data-URI, then render — so download
 * and iframe get one offline file with real covers.
 */
const shareableHtmlCache = new Map<string, { builtAt: number; html: string }>();

async function renderShareableHtml(row: DailyReportRow): Promise<string> {
  const cached = shareableHtmlCache.get(row.date);
  if (cached && cached.builtAt === row.builtAt) return cached.html;

  const pack = parseDailyReportPack(JSON.parse(row.packJson)) as DailyReportPack;
  await embedPackRemoteCovers(pack);
  const html = renderDailyReportHtml(pack);
  shareableHtmlCache.set(row.date, { builtAt: row.builtAt, html });
  return html;
}

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

  // Re-render from packJson with real covers SVG-wrapped at serve time
  // (Convex stores remote URLs only). Fall back to the build-time html blob
  // only if the pack is unreadable.
  let html = row.html;
  try {
    html = await renderShareableHtml(row);
  } catch {
    if (!html) return notFound(c, "Report not found");
  }

  c.header("Cache-Control", "public, max-age=60");
  return c.html(html, 200, {
    "Content-Type": "text/html; charset=utf-8",
  });
});

export default app;
