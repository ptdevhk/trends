import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import taxonomyRoutes from "./taxonomy";
import { workspaceMiddleware } from "../middleware/workspace";

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
  app.route("/", taxonomyRoutes)
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

function createTaxonomyRecord(overrides: Record<string, unknown> = {}) {
  return {
    _id: "cluster-1",
    workspaceSlug: "dev",
    name: "Manufacturing Systems",
    slug: "manufacturing-systems",
    parentSlug: "core-domains",
    tags: ["Machine Tools", "Automation"],
    source: "human",
    confidence: 0.81,
    status: "active",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

describe("taxonomy routes", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("blocks non-admin workspaces from taxonomy access", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const app = createTestApp()

    const response = await app.request("/api/taxonomy", {
      headers: {
        "X-Workspace-Slug": "hr",
      },
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      success: false,
      error: "Admin access required",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("lists workspace-scoped taxonomy clusters for admins", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)

      expect(call.method).toBe("query")
      expect(call.pathName).toBe("taxonomy_clusters:list")
      expect(call.args).toEqual({
        workspaceSlug: "dev",
      })

      return convexSuccess([
        createTaxonomyRecord(),
        createTaxonomyRecord({
          _id: "cluster-2",
          slug: "sales",
          name: "Sales",
          parentSlug: "",
          source: "unexpected",
          status: "mystery",
          confidence: "bad-input",
        }),
      ])
    })

    const app = createTestApp()
    const response = await app.request("/api/taxonomy", {
      headers: {
        "X-Workspace-Slug": "dev",
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      items: [
        {
          id: "cluster-1",
          workspaceSlug: "dev",
          name: "Manufacturing Systems",
          slug: "manufacturing-systems",
          parentSlug: "core-domains",
          tags: ["Machine Tools", "Automation"],
          source: "human",
          confidence: 0.81,
          status: "active",
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: "cluster-2",
          workspaceSlug: "dev",
          name: "Sales",
          slug: "sales",
          tags: ["Machine Tools", "Automation"],
          source: "human",
          status: "active",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("returns a stable json error when taxonomy loading fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("convex unavailable", { status: 502 }),
    )

    const app = createTestApp()
    const response = await app.request("/api/taxonomy", {
      headers: {
        "X-Workspace-Slug": "dev",
      },
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      success: false,
      error: "Failed to load taxonomy clusters",
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to load taxonomy clusters",
      expect.any(Error),
    )
  })

  it("upserts a taxonomy cluster in the current workspace and returns the refreshed registry", async () => {
    const calls: Array<{ method: "query" | "mutation"; pathName: string; args: Record<string, unknown> }> = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.method === "mutation" && call.pathName === "taxonomy_clusters:upsert") {
        return convexSuccess("cluster-1")
      }

      if (call.method === "query" && call.pathName === "taxonomy_clusters:list") {
        return convexSuccess([createTaxonomyRecord()])
      }

      throw new Error(`Unexpected convex call: ${call.method} ${call.pathName}`)
    })

    const app = createTestApp()
    const response = await app.request("/api/taxonomy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({
        name: "Manufacturing Systems",
        slug: "manufacturing-systems",
        parentSlug: "core-domains",
        tags: ["Machine Tools", "Automation"],
        source: "human",
        confidence: 0.81,
        status: "active",
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      items: [
        {
          id: "cluster-1",
          workspaceSlug: "dev",
          name: "Manufacturing Systems",
          slug: "manufacturing-systems",
          parentSlug: "core-domains",
          tags: ["Machine Tools", "Automation"],
          source: "human",
          confidence: 0.81,
          status: "active",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    })
    expect(calls).toEqual([
      {
        method: "mutation",
        pathName: "taxonomy_clusters:upsert",
        args: {
          workspaceSlug: "dev",
          name: "Manufacturing Systems",
          slug: "manufacturing-systems",
          parentSlug: "core-domains",
          tags: ["Machine Tools", "Automation"],
          source: "human",
          confidence: 0.81,
          status: "active",
        },
      },
      {
        method: "query",
        pathName: "taxonomy_clusters:list",
        args: {
          workspaceSlug: "dev",
        },
      },
    ])
  })

  it("suggests taxonomy drafts within the current workspace", async () => {
    const calls: Array<{ method: "query" | "mutation"; pathName: string; args: Record<string, unknown> }> = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.method === "mutation" && call.pathName === "taxonomy_clusters:suggest") {
        return convexSuccess([
          createTaxonomyRecord({
            _id: "cluster-draft-1",
            name: "Automation Stack",
            slug: "automation-stack",
            source: "ai",
            status: "draft",
          }),
        ])
      }

      throw new Error(`Unexpected convex call: ${call.method} ${call.pathName}`)
    })

    const app = createTestApp()
    const response = await app.request("/api/taxonomy/suggest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({
        limit: 10,
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      items: [
        {
          id: "cluster-draft-1",
          workspaceSlug: "dev",
          name: "Automation Stack",
          slug: "automation-stack",
          parentSlug: "core-domains",
          tags: ["Machine Tools", "Automation"],
          source: "ai",
          confidence: 0.81,
          status: "draft",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    })
    expect(calls).toEqual([
      {
        method: "mutation",
        pathName: "taxonomy_clusters:suggest",
        args: {
          workspaceSlug: "dev",
          limit: 10,
        },
      },
    ])
  })

  it("deletes a taxonomy cluster in the current workspace and returns the refreshed registry", async () => {
    const calls: Array<{ method: "query" | "mutation"; pathName: string; args: Record<string, unknown> }> = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init)
      calls.push(call)

      if (call.method === "mutation" && call.pathName === "taxonomy_clusters:remove") {
        return convexSuccess(true)
      }

      if (call.method === "query" && call.pathName === "taxonomy_clusters:list") {
        return convexSuccess([
          createTaxonomyRecord({
            _id: "cluster-2",
            name: "Automation",
            slug: "automation",
            parentSlug: "",
            source: "merged",
            status: "active",
          }),
        ])
      }

      throw new Error(`Unexpected convex call: ${call.method} ${call.pathName}`)
    })

    const app = createTestApp()
    const response = await app.request("/api/taxonomy/cluster-1", {
      method: "DELETE",
      headers: {
        "X-Workspace-Slug": "dev",
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      items: [
        {
          id: "cluster-2",
          workspaceSlug: "dev",
          name: "Automation",
          slug: "automation",
          tags: ["Machine Tools", "Automation"],
          source: "merged",
          confidence: 0.81,
          status: "active",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    })
    expect(calls).toEqual([
      {
        method: "mutation",
        pathName: "taxonomy_clusters:remove",
        args: {
          id: "cluster-1",
          workspaceSlug: "dev",
        },
      },
      {
        method: "query",
        pathName: "taxonomy_clusters:list",
        args: {
          workspaceSlug: "dev",
        },
      },
    ])
  })
})
