import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import jobDescriptionsRoutes from "./job-descriptions";
import { workspaceMiddleware } from "../middleware/workspace";

const {
  extractKeywordsMock,
} = vi.hoisted(() => ({
  extractKeywordsMock: vi.fn(),
}))

vi.mock("../services/jd-keyword-extraction-service.js", () => ({
  jdKeywordExtractionService: {
    extractKeywords: (...args: unknown[]) => extractKeywordsMock(...args),
  },
}))

function createTestApp() {
  const app = new OpenAPIHono()
  app.use("*", workspaceMiddleware)
  app.route("/", jobDescriptionsRoutes)
  return app
}

describe("job description routes", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    extractKeywordsMock.mockReset()
  })

  it("extracts recruiter keywords from pasted job description text", async () => {
    extractKeywordsMock.mockResolvedValue({
      keywords: ["Machine Tools", "Business Development", "CNC"],
      model: "anthropic/claude-3-haiku-20240307",
    })

    const app = createTestApp()
    const response = await app.request("/api/job-descriptions/extract-keywords", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({
        text: "   Machine tools sales lead for CNC capital equipment across Malaysia and Singapore. Must own business development and distributor channels.   ",
      }),
    })

    expect(response.status).toBe(200)
    expect(extractKeywordsMock).toHaveBeenCalledWith({
      text: "Machine tools sales lead for CNC capital equipment across Malaysia and Singapore. Must own business development and distributor channels.",
    })
    expect(await response.json()).toEqual({
      success: true,
      keywords: ["Machine Tools", "Business Development", "CNC"],
      model: "anthropic/claude-3-haiku-20240307",
    })
  })

  it("rejects short pasted text before calling the extraction service", async () => {
    const app = createTestApp()
    const response = await app.request("/api/job-descriptions/extract-keywords", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({
        text: "Too short JD",
      }),
    })

    expect(response.status).toBe(400)
    expect(extractKeywordsMock).not.toHaveBeenCalled()
  })

  it("returns a stable json error when keyword extraction fails", async () => {
    extractKeywordsMock.mockRejectedValue(new Error("AI provider unavailable"))

    const app = createTestApp()
    const response = await app.request("/api/job-descriptions/extract-keywords", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({
        text: "Machine tools sales lead for CNC capital equipment across Malaysia and Singapore with channel and distributor ownership.",
      }),
    })

    expect(response.status).toBe(500)
    expect(extractKeywordsMock).toHaveBeenCalledWith({
      text: "Machine tools sales lead for CNC capital equipment across Malaysia and Singapore with channel and distributor ownership.",
    })
    expect(await response.json()).toEqual({
      success: false,
      error: "Failed to extract keywords from the job description",
    })
  })
})
