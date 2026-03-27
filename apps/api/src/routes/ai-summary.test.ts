import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import aiSummaryRoutes from "./ai-summary";
import { workspaceMiddleware } from "../middleware/workspace";
import { aiSummaryService } from "../services/ai-summary-service";

const {
  resolveConvexUrlMock,
} = vi.hoisted(() => ({
  resolveConvexUrlMock: vi.fn(() => "http://127.0.0.1:3210"),
}))

vi.mock("../services/resume-import-service.js", () => ({
  resolveConvexUrl: () => resolveConvexUrlMock(),
}))

function createTestApp() {
  const app = new OpenAPIHono()
  app.use("*", workspaceMiddleware)
  app.route("/", aiSummaryRoutes)
  return app
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function convexSuccess(value: unknown): Response {
  return new Response(
    JSON.stringify({
      status: "success",
      value,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    },
  )
}

function parseConvexCall(input: RequestInfo | URL, init?: RequestInit): {
  method: "query" | "mutation"
  pathName: string
  args: Record<string, unknown>
} {
  const requestUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url
  const method = requestUrl.includes("/api/mutation") ? "mutation" : "query"
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
  if (!isRecord(body)) {
    throw new Error("Missing convex request body")
  }

  const pathName = typeof body.path === "string" ? body.path : ""
  const args = isRecord(body.args) ? body.args : {}
  if (!pathName) {
    throw new Error("Missing convex path in request body")
  }

  return {
    method,
    pathName,
    args,
  }
}

function createSummaryRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    urlHash: "search-url-hash",
    query: "machine tools sales",
    location: "Malaysia",
    jobDescriptionId: "jd-machine-tools",
    facets: {
      selectedTags: ["cluster:manufacturing-systems", "Machine Tools"],
      selectedCompanies: ["FANUC"],
      selectedExperienceLevel: "senior",
    },
    resultCount: 2,
    resultSetHash: "result-set-hash",
    results: [
      {
        id: "resume-1",
        name: "Ada Tan",
        title: "Regional Sales Manager",
        location: "Kuala Lumpur",
        score: 96,
        keywords: ["Machine Tools", "FANUC"],
        snippet: "Led machine tools sales across Malaysia.",
      },
      {
        id: "resume-2",
        name: "Ben Lee",
        title: "Sales Engineer",
        location: "Johor",
        score: 90,
        keywords: ["CNC", "Automation"],
        snippet: "Built CNC pipeline coverage.",
      },
    ],
    ...overrides,
  }
}

describe("ai summary routes", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns a cached summary for the requested workspace and surfaces stale-refresh metadata", async () => {
    const now = Date.UTC(2026, 2, 27, 20, 0, 0)
    vi.spyOn(Date, "now").mockReturnValue(now)
    const generateSummarySpy = vi.spyOn(aiSummaryService, "generateSummary")
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)

      expect(call.method).toBe("query")
      expect(call.pathName).toBe("ai_summary_cache:get")
      expect(call.args).toEqual({
        workspaceSlug: "hr",
        urlHash: "search-url-hash",
      })

      return convexSuccess({
        summary: "Cached recruiter summary",
        model: "anthropic/claude-3-haiku-20240307",
        generatedAt: now - (55 * 60 * 1000),
        expiresAt: now + (5 * 60 * 1000),
        resultSetHash: "result-set-hash",
      })
    })

    const app = createTestApp()
    const response = await app.request("/api/resumes/search-summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify(createSummaryRequestBody()),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      summary: "Cached recruiter summary",
      model: "anthropic/claude-3-haiku-20240307",
      generatedAt: now - (55 * 60 * 1000),
      shouldRefresh: true,
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(generateSummarySpy).not.toHaveBeenCalled()
  })

  it("generates and upserts a summary when the cache misses", async () => {
    const now = Date.UTC(2026, 2, 27, 21, 0, 0)
    const requestBody = createSummaryRequestBody()
    vi.spyOn(Date, "now").mockReturnValue(now)
    const generateSummarySpy = vi.spyOn(aiSummaryService, "generateSummary").mockResolvedValue({
      summary: "Generated recruiter summary",
      model: "anthropic/claude-3-haiku-20240307",
    })
    const calls: Array<{ method: "query" | "mutation"; pathName: string; args: Record<string, unknown> }> = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.method === "query" && call.pathName === "ai_summary_cache:get") {
        return convexSuccess(null)
      }

      if (call.method === "mutation" && call.pathName === "ai_summary_cache:upsert") {
        return convexSuccess("cache-record-1")
      }

      throw new Error(`Unexpected convex call: ${call.method} ${call.pathName}`)
    })

    const app = createTestApp()
    const response = await app.request("/api/resumes/search-summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify(requestBody),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      summary: "Generated recruiter summary",
      model: "anthropic/claude-3-haiku-20240307",
      generatedAt: now,
    })
    expect(generateSummarySpy).toHaveBeenCalledWith({
      workspaceSlug: "hr",
      query: "machine tools sales",
      location: "Malaysia",
      jobDescriptionId: "jd-machine-tools",
      facets: {
        selectedTags: ["cluster:manufacturing-systems", "Machine Tools"],
        selectedCompanies: ["FANUC"],
        selectedExperienceLevel: "senior",
      },
      results: requestBody.results,
    })
    expect(calls).toEqual([
      {
        method: "query",
        pathName: "ai_summary_cache:get",
        args: {
          workspaceSlug: "hr",
          urlHash: "search-url-hash",
        },
      },
      {
        method: "mutation",
        pathName: "ai_summary_cache:upsert",
        args: {
          urlHash: "search-url-hash",
          workspaceSlug: "hr",
          query: "machine tools sales",
          facets: JSON.stringify({
            selectedTags: ["cluster:manufacturing-systems", "Machine Tools"],
            selectedCompanies: ["FANUC"],
            selectedExperienceLevel: "senior",
          }),
          resultCount: 2,
          resultSetHash: "result-set-hash",
          summary: "Generated recruiter summary",
          model: "anthropic/claude-3-haiku-20240307",
          generatedAt: now,
          expiresAt: now + (60 * 60 * 1000),
        },
      },
    ])
  })

  it("falls back to cached content when generation fails after a forced refresh", async () => {
    const now = Date.UTC(2026, 2, 27, 22, 0, 0)
    vi.spyOn(Date, "now").mockReturnValue(now)
    vi.spyOn(aiSummaryService, "generateSummary").mockRejectedValue(new Error("LLM unavailable"))
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)

      expect(call.method).toBe("query")
      expect(call.pathName).toBe("ai_summary_cache:get")

      return convexSuccess({
        summary: "Fallback cached recruiter summary",
        model: "anthropic/claude-3-haiku-20240307",
        generatedAt: now - (2 * 60 * 60 * 1000),
        expiresAt: now - 1,
        resultSetHash: "older-result-set-hash",
      })
    })
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const app = createTestApp()
    const response = await app.request("/api/resumes/search-summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify(createSummaryRequestBody({
        forceRefresh: true,
      })),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      summary: "Fallback cached recruiter summary",
      model: "anthropic/claude-3-haiku-20240307",
      generatedAt: now - (2 * 60 * 60 * 1000),
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to generate AI search summary",
      expect.any(Error),
    )
  })

  it("returns a stable json error when summary generation fails without usable cache", async () => {
    vi.spyOn(aiSummaryService, "generateSummary").mockRejectedValue(new Error("LLM unavailable"))
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)

      expect(call.method).toBe("query")
      expect(call.pathName).toBe("ai_summary_cache:get")

      return convexSuccess(null)
    })
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const app = createTestApp()
    const response = await app.request("/api/resumes/search-summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify(createSummaryRequestBody()),
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      success: false,
      error: "Failed to generate AI search summary",
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to generate AI search summary",
      expect.any(Error),
    )
  })
})
