import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import { workspaceMiddleware } from "../middleware/workspace.js";
import { parseJsonBody } from "../test-utils.js";
import dailyReportsRoutes from "./daily-reports.js";

function createTestApp() {
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  app.route("/", dailyReportsRoutes);
  return app;
}

const samplePack = {
  date: "2026-09-23",
  localeDefault: "zh-Hans",
  source: "live",
  generatedAt: "2026-09-23T06:00:00.000Z",
  hero: {
    headline: "CNC 销售热度",
    value: "12.3万",
    delta: "+8%",
    meta: "14 来源 · 3 热榜命中",
    sparkline: [10, 20, 30, 25, 40, 35, 50],
    dayDates: [
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
    ],
  },
  opportunities: [
    {
      kind: "商机",
      label: "3D 扫描 销售",
      heat: "3.8万",
      growth: "+1200%",
      started: "1天前",
      sparkline: [5, 10, 20, 15, 30, 25, 40],
      href: "https://example.com/a",
    },
    {
      kind: "转机",
      label: "五轴加工中心 需求",
      heat: "1.2万",
      growth: "+300%",
      started: "2天前",
      sparkline: [10, 15, 15, 20, 25, 30, 35],
      href: "https://example.com/b",
    },
    {
      kind: "动态",
      label: "自动化产线 升级",
      heat: "9千",
      growth: "+50%",
      started: "3天前",
      sparkline: [20, 22, 24, 26, 28, 30, 32],
      href: "https://example.com/c",
    },
  ],
  stories: [
    {
      title: "某厂商发布新款 3D 扫描仪",
      href: "https://example.com/s1",
    },
  ],
};

const sampleRow = {
  date: "2026-09-23",
  packJson: JSON.stringify(samplePack),
  html: "<html>pre-rendered</html>",
  source: "live",
  builtAt: 1758626400000,
};

const emptyHtmlRow = {
  date: "2026-09-23",
  packJson: JSON.stringify(samplePack),
  html: "",
  source: "live",
  builtAt: 1758626400000,
};

vi.mock("../services/convex-utils.js", () => ({
  callConvexQuery: vi.fn(),
}));

vi.mock("@trends/shared", async () => {
  const actual = await vi.importActual<typeof import("@trends/shared")>("@trends/shared");
  return {
    ...actual,
    // Unit tests have no network; skip real CDN downloads.
    embedPackRemoteCovers: vi.fn(async () => ({ converted: 0, failed: 0 })),
  };
});

import { callConvexQuery } from "../services/convex-utils.js";
import { embedPackRemoteCovers } from "@trends/shared";

const mockedCallConvexQuery = vi.mocked(callConvexQuery);
const mockedEmbed = vi.mocked(embedPackRemoteCovers);

describe("daily reports routes", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns dates from index.json", async () => {
    mockedCallConvexQuery.mockResolvedValue([
      { date: "2026-09-23", source: "live", builtAt: 1 },
      { date: "2026-09-22", source: "frozen", builtAt: 2 },
    ]);

    const app = createTestApp();
    const response = await app.request("/daily/index.json");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    const body = await parseJsonBody<{ dates: string[] }>(response);
    expect(body.dates).toEqual(["2026-09-23", "2026-09-22"]);
    expect(mockedCallConvexQuery).toHaveBeenCalledWith("daily_reports:listDates", expect.objectContaining({ writeSecret: expect.any(String) }));
  });

  it("returns pack json verbatim for a valid date", async () => {
    mockedCallConvexQuery.mockResolvedValue(sampleRow);

    const app = createTestApp();
    const response = await app.request("/daily/2026-09-23.json");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    const body = await parseJsonBody<typeof samplePack>(response);
    expect(body).toEqual(samplePack);
    expect(mockedCallConvexQuery).toHaveBeenCalledWith(
      "daily_reports:getByDate",
      expect.objectContaining({ date: "2026-09-23", writeSecret: expect.any(String) }),
    );
  });

  it("re-renders html from packJson (ignores stale stored html)", async () => {
    mockedCallConvexQuery.mockResolvedValue(sampleRow);

    const app = createTestApp();
    const response = await app.request("/daily/2026-09-23.html");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    const body = await response.text();
    // Must come from renderDailyReportHtml(pack), not the frozen "<html>pre-rendered</html>" blob.
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("2026-09-23");
    // 定稿C layout: TODAY rows + 商机/新闻 (the renderer no longer uses a .story
    // 4:3 crop box — rows are text-first; FEATURED cards use .fcard cover).
    expect(body).toMatch(/当日内容|商机 \/ 新闻|头条|精选/);
    expect(body).not.toBe("<html>pre-rendered</html>");
    expect(mockedEmbed).toHaveBeenCalled();
  });

  it("renders html on demand when stored html is empty", async () => {
    mockedCallConvexQuery.mockResolvedValue(emptyHtmlRow);

    const app = createTestApp();
    const response = await app.request("/daily/2026-09-23.html");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("2026-09-23");
    expect(body).toContain('/daily/2026-09-22.html" target="_top"');
  });

  it("returns 404 JSON envelope when report is missing", async () => {
    mockedCallConvexQuery.mockResolvedValue(null);

    const app = createTestApp();
    const jsonResponse = await app.request("/daily/2026-09-20.json");
    const htmlResponse = await app.request("/daily/2026-09-20.html");

    expect(jsonResponse.status).toBe(404);
    const jsonBody = await parseJsonBody<{ success: boolean; error: string }>(jsonResponse);
    expect(jsonBody.success).toBe(false);
    expect(jsonBody.error).toMatch(/Report not found/i);

    expect(htmlResponse.status).toBe(404);
    const htmlBody = await parseJsonBody<{ success: boolean; error: string }>(htmlResponse);
    expect(htmlBody.success).toBe(false);
  });

  it("returns 404 for invalid date or extension", async () => {
    mockedCallConvexQuery.mockResolvedValue(null);

    const app = createTestApp();
    const cases = [
      "/daily/not-a-date.html",
      "/daily/2026-09-23.txt",
      "/daily/2026-09-23",
      "/daily/09-23-2026.html",
    ];

    for (const path of cases) {
      const response = await app.request(path);
      expect(response.status).toBe(404);
      const body = await parseJsonBody<{ success: boolean; error: string }>(response);
      expect(body.success).toBe(false);
    }
  });

  it("does not require authentication", async () => {
    mockedCallConvexQuery.mockResolvedValue(sampleRow);

    const app = createTestApp();
    const response = await app.request("/daily/2026-09-23.json");

    expect(response.status).toBe(200);
  });
});
