import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import resumesSearchRoutes from "./resumes_search";
import { workspaceMiddleware } from "../middleware/workspace";
import { ResumeService } from "../services/resume-service";

function createTestApp() {
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  app.route("/", resumesSearchRoutes);
  return app;
}

describe("resumes_search", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/resumes/samples", () => {
    it("lists available samples", async () => {
      vi.spyOn(ResumeService.prototype, "listSampleFiles").mockReturnValue([
        { name: "sample-initial", filename: "sample-initial.json", size: 123, updatedAt: "2026-04-01" },
      ]);

      const app = createTestApp();
      const response = await app.request("/api/resumes/samples");

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.success).toBe(true);
      expect(payload.samples).toHaveLength(1);
      expect(payload.samples[0].name).toBe("sample-initial");
    });
  });

  describe("GET /api/resumes/keyword-expansion", () => {
    it("returns expanded terms for a keyword", async () => {
      vi.spyOn(ResumeService.prototype, "expandSearchQuery").mockReturnValue({
        groups: [],
        mode: "AND",
        flatTerms: ["CNC", "数控"],
        sourceMapping: {},
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/keyword-expansion?q=cnc");

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.success).toBe(true);
      expect(payload.summary.keyword).toBe("cnc");
      expect(payload.summary.expandedTo).toContain("CNC");
      expect(payload.summary.mode).toBe("AND");
    });
  });
});

describe("ResumesQuerySchema semantic search params", () => {
  it("accepts enableSemantic parameter", async () => {
    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: [],
      sample: undefined,
      metadata: undefined,
      indexes: [],
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?enableSemantic=true");

    expect(response.status).toBe(200);
  });

  it("accepts semanticWeight parameter", async () => {
    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: [],
      sample: undefined,
      metadata: undefined,
      indexes: [],
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?semanticWeight=0.7");

    expect(response.status).toBe(200);
  });

  it("accepts semanticLimit parameter", async () => {
    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: [],
      sample: undefined,
      metadata: undefined,
      indexes: [],
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?semanticLimit=100");

    expect(response.status).toBe(200);
  });

  it("rejects semanticWeight outside 0-1 range", async () => {
    const app = createTestApp();
    const response = await app.request("/api/resumes?semanticWeight=2.0");

    expect(response.status).toBe(400);
  });

  it("rejects semanticLimit above 256", async () => {
    const app = createTestApp();
    const response = await app.request("/api/resumes?semanticLimit=500");

    expect(response.status).toBe(400);
  });
});
