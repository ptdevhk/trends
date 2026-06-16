import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import resumesImportRoutes from "./resumes_import";
import { workspaceMiddleware } from "../middleware/workspace";
import { createAuthContext } from "./test-auth-helpers";
import { parseJsonBody } from "../test-utils";

function createTestApp(input: { workspaceSlug?: string; role?: "user" | "admin" } = {}) {
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  app.use("*", async (c, next) => {
    c.set("auth", createAuthContext({
      workspaceSlug: input.workspaceSlug ?? "dev",
      role: input.role ?? "admin",
    }));
    await next();
  });
  app.route("/", resumesImportRoutes);
  return app;
}

function convexSuccess(value: unknown): Response {
  return new Response(
    JSON.stringify({ status: "success", value }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("resumes_import", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/resumes/import", () => {
    it("imports valid resume data", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(convexSuccess({ success: true }));
      // submitResumeImport internally calls fetch to Convex — mock handles it

      const app = createTestApp();
      const response = await app.request("/api/resumes/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: {
            sourceUrl: "https://example.com/search",
            generatedBy: "test",
          },
          resumes: [{ name: "Alice", profileUrl: "https://example.com/a" }],
        }),
      });

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ success: unknown }>(response);
      expect(payload.success).toBe(true);
    });

    it("rejects non-admin access with 403", async () => {
      const app = createTestApp({ workspaceSlug: "hr", role: "user" });
      const response = await app.request("/api/resumes/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Workspace-Slug": "hr" },
        body: JSON.stringify({
          metadata: {
            sourceUrl: "https://example.com/search",
            generatedBy: "test",
          },
          resumes: [],
        }),
      });

      expect(response.status).toBe(403);
      const payload = await parseJsonBody<{ error: unknown }>(response);
      expect(payload.error).toContain("Admin access");
    });
  });

  describe("POST /api/resumes/manual-import", () => {
    it("rejects non-form-data body", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/manual-import", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      });

      expect(response.status).toBe(400);
      const payload = await parseJsonBody<{ success: unknown }>(response);
      expect(payload.success).toBe(false);
    });
  });

  describe("POST /api/resumes/backup", () => {
    it("returns backup list (admin)", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        // Return a new Response each time this is called
        return convexSuccess({
          page: [],
          continueCursor: "",
          isDone: true,
        });
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ metadata: Record<string, unknown>; resumes: unknown[] }>(response);
      expect(payload.metadata).toBeDefined();
      expect(payload.metadata.version).toBe("2");
      expect(Array.isArray(payload.resumes)).toBe(true);
    });

    it("rejects non-admin access with 403", async () => {
      const app = createTestApp({ workspaceSlug: "hr", role: "user" });
      const response = await app.request("/api/resumes/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Workspace-Slug": "hr" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(403);
    });
  });

  describe("POST /api/resumes/reset", () => {
    it("rejects non-admin access with 403", async () => {
      const app = createTestApp({ workspaceSlug: "hr", role: "user" });
      const response = await app.request("/api/resumes/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Workspace-Slug": "hr" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(403);
    });
  });
});
