import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import jobDescriptionsRoutes from "./job-descriptions";
import { workspaceMiddleware } from "../middleware/workspace";
import { createAuthContext } from "./test-auth-helpers";

const DEFAULT_TEST_MODEL = "openai/gpt-4o-mini";

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

function createTestApp(options?: { workspaceSlug?: string; role?: "user" | "admin" }) {
  const workspaceSlug = options?.workspaceSlug ?? "dev"
  const role = options?.role ?? "admin"
  const app = new OpenAPIHono()
  app.use("*", workspaceMiddleware)
  app.use("*", async (c, next) => {
    c.set("auth", createAuthContext({ workspaceSlug, role }))
    await next()
  })
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
      model: DEFAULT_TEST_MODEL,
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
      model: DEFAULT_TEST_MODEL,
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

  it("allows workspace user role to create job descriptions (member desk)", async () => {
    const createdId = "jd-convex-1"
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {}
      if (url.includes("/api/mutation") || body.path === "job_descriptions:create") {
        return new Response(JSON.stringify({ status: "success", value: createdId }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (url.includes("/api/query") || body.path === "job_descriptions:list") {
        return new Response(
          JSON.stringify({
            status: "success",
            value: [
              {
                _id: createdId,
                title: "Personal Seat JD",
                slug: "personal-seat-jd",
                content: "Screen CNC sales candidates for personal desk.",
                type: "custom",
                enabled: true,
                lastModified: Date.now(),
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const app = createTestApp({ workspaceSlug: "alice", role: "user" })
    const response = await app.request("/api/job-descriptions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "alice",
      },
      body: JSON.stringify({
        name: "Personal Seat JD",
        content: "Screen CNC sales candidates for personal desk.",
      }),
    })

    expect(response.status).toBe(201)
    const body = await response.json() as { success: boolean; item?: { id: string } }
    expect(body.success).toBe(true)
    expect(body.item?.id).toBe(createdId)
    fetchSpy.mockRestore()
  })

  it("rejects unauthenticated job description create", async () => {
    const app = new OpenAPIHono()
    app.use("*", workspaceMiddleware)
    app.route("/", jobDescriptionsRoutes)
    const response = await app.request("/api/job-descriptions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "alice",
      },
      body: JSON.stringify({
        name: "No Auth JD",
        content: "Should fail without membership authentication on the workspace.",
      }),
    })
    expect(response.status).toBe(401)
  })
})
