import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import notificationsRoutes from "../notifications";
import { createAuthMiddleware } from "../../middleware/auth";
import { workspaceMiddleware } from "../../middleware/workspace";
import { resetResumeScreeningDb } from "../../services/database";
import { createAuthHeaders } from "../test-auth-helpers";

vi.mock("../../services/notification-service", () => ({
  notificationService: {
    sendFeishuText: vi.fn().mockResolvedValue({ code: 0, msg: "ok" }),
    sendWechatWorkMarkdown: vi.fn().mockResolvedValue({ errcode: 0, errmsg: "ok" }),
    sendEmail: vi.fn().mockResolvedValue({ messageId: "test-123" }),
  },
}));

vi.mock("../../services/notification-template-service", () => ({
  notificationTemplateService: {
    listTemplates: vi.fn().mockReturnValue([
      { id: "test-template", filename: "test.md", updatedAt: "2026-01-01", size: 100, subject: "Test" },
    ]),
    render: vi.fn().mockReturnValue({ subject: "Rendered", markdown: "Hello {{name}}" }),
  },
}));

vi.mock("../../services/ai-matching", () => ({
  aiMatchingService: {
    generateOutreach: vi.fn().mockResolvedValue({ subject: "Outreach", body: "Hello" }),
  },
}));

function createTestApp() {
  const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
  const middleware = createAuthMiddleware({ storage: auth.storage, ttlSeconds: 3600 });
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  app.use("*", middleware.optionalAuth);
  app.use("/api/*", middleware.requireCsrf);
  app.route("/api/notifications", notificationsRoutes);
  return { app, headers: auth.headers };
}

const jsonHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  "Content-Type": "application/json",
  ...extra,
});

describe("notifications routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetResumeScreeningDb();
  });

  describe("GET /api/notifications/templates", () => {
    it("returns template list", async () => {
      const { app } = createTestApp();
      const response = await app.request("/api/notifications/templates");

      expect(response.status).toBe(200);
      const payload = await response.json() as { templates: Array<{ id: string }> };
      expect(payload.templates).toHaveLength(1);
      expect(payload.templates[0].id).toBe("test-template");
    });
  });

  describe("POST /api/notifications/draft", () => {
    it("generates outreach draft", async () => {
      const { app } = createTestApp();
      const response = await app.request("/api/notifications/draft", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          resume: { id: "r1", name: "Alice" },
          jobDescription: { title: "Engineer", requirements: "5 years exp" },
          analysis: { score: 85, recommendation: "strong_match", highlights: ["exp"], concerns: [], summary: "Good fit" },
        }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json() as { subject: string };
      expect(payload.subject).toBe("Outreach");
    });

    it("returns 400 for invalid body", async () => {
      const { app } = createTestApp();
      const response = await app.request("/api/notifications/draft", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/notifications/preview", () => {
    it("renders email preview", async () => {
      const { app } = createTestApp();
      const response = await app.request("/api/notifications/preview", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          channel: "email",
          templateId: "test-template",
          data: { name: "Bob" },
        }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json() as { channel: string };
      expect(payload.channel).toBe("email");
    });

    it("renders feishu preview", async () => {
      const { app } = createTestApp();
      const response = await app.request("/api/notifications/preview", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          channel: "feishu",
          templateId: "test-template",
          data: { name: "Bob" },
        }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json() as { channel: string; content: string };
      expect(payload.channel).toBe("feishu");
      expect(payload.content).toBeDefined();
    });
  });

  describe("POST /api/notifications/send", () => {
    it("rejects non-admin with 403", async () => {
      const { app, headers } = createTestApp();
      const response = await app.request("/api/notifications/send", {
        method: "POST",
        headers: jsonHeaders(headers),
        body: JSON.stringify({ to: "test@example.com", subject: "Hi", body: "Hello" }),
      });

      expect(response.status).toBe(403);
    });
  });

  describe("POST /api/notifications/send-template", () => {
    it("rejects non-admin with 403", async () => {
      const { app, headers } = createTestApp();
      const response = await app.request("/api/notifications/send-template", {
        method: "POST",
        headers: jsonHeaders(headers),
        body: JSON.stringify({
          channel: "feishu",
          templateId: "test-template",
          data: { name: "Bob" },
        }),
      });

      expect(response.status).toBe(403);
    });
  });
});
