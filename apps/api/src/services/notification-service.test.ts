import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { NotificationService } from "./notification-service.js";

describe("NotificationService", () => {
  let service: NotificationService;

  beforeEach(() => {
    // Ensure no real SMTP env vars leak into tests
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
    delete process.env.WECHAT_WORK_WEBHOOK;
    delete process.env.FEISHU_WEBHOOK_URL;
    delete process.env.FEISHU_WEBHOOK;
    service = new NotificationService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("sendWechatWorkMarkdown", () => {
    it("throws when WECHAT_WORK_WEBHOOK is not set and no webhookUrl provided", async () => {
      await expect(
        service.sendWechatWorkMarkdown({ content: "hello" }),
      ).rejects.toThrow("WECHAT_WORK_WEBHOOK is not set");
    });

    it("sends markdown message and returns parsed response", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 }),
        );

      const result = await service.sendWechatWorkMarkdown({
        content: "## Test",
        webhookUrl: "https://example.com/wechat",
      });

      expect(result).toEqual({ errcode: 0, errmsg: "ok" });
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://example.com/wechat",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );

      const body = JSON.parse(
        (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(body).toEqual({
        msgtype: "markdown",
        markdown: { content: "## Test" },
      });
    });

    it("uses WECHAT_WORK_WEBHOOK env var when webhookUrl is not provided", async () => {
      process.env.WECHAT_WORK_WEBHOOK = "https://env.example.com/wechat";
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 }),
        );

      await service.sendWechatWorkMarkdown({ content: "test" });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://env.example.com/wechat",
        expect.anything(),
      );
    });

    it("throws on non-JSON response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Not JSON", { status: 500 }),
      );

      await expect(
        service.sendWechatWorkMarkdown({
          content: "test",
          webhookUrl: "https://example.com/wechat",
        }),
      ).rejects.toThrow("non-JSON");
    });

    it("throws on unexpected JSON structure", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
      );

      await expect(
        service.sendWechatWorkMarkdown({
          content: "test",
          webhookUrl: "https://example.com/wechat",
        }),
      ).rejects.toThrow("unexpected response");
    });

    it("throws on non-zero errcode", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ errcode: 40001, errmsg: "invalid token" }), {
          status: 200,
        }),
      );

      await expect(
        service.sendWechatWorkMarkdown({
          content: "test",
          webhookUrl: "https://example.com/wechat",
        }),
      ).rejects.toThrow("invalid token");
    });

    it("throws on HTTP error with errcode=0", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 502 }),
      );

      await expect(
        service.sendWechatWorkMarkdown({
          content: "test",
          webhookUrl: "https://example.com/wechat",
        }),
      ).rejects.toThrow("webhook error");
    });
  });

  describe("sendFeishuText", () => {
    it("throws when FEISHU_WEBHOOK_URL is not set and no webhookUrl provided", async () => {
      await expect(
        service.sendFeishuText({ content: "hello" }),
      ).rejects.toThrow("FEISHU_WEBHOOK_URL is not set");
    });

    it("sends text message and returns parsed response (code/msg format)", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({ code: 0, msg: "ok" }), { status: 200 }),
        );

      const result = await service.sendFeishuText({
        content: "Hello Feishu",
        webhookUrl: "https://example.com/feishu",
      });

      expect(result).toEqual({ code: 0, msg: "ok" });
      const body = JSON.parse(
        (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(body).toEqual({
        msg_type: "text",
        content: { text: "Hello Feishu" },
      });

      fetchSpy.mockRestore();
    });

    it("handles StatusCode/StatusMessage format", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({ StatusCode: 0, StatusMessage: "success" }),
          { status: 200 },
        ),
      );

      const result = await service.sendFeishuText({
        content: "test",
        webhookUrl: "https://example.com/feishu",
      });

      expect(result).toEqual({ StatusCode: 0, StatusMessage: "success" });
    });

    it("uses FEISHU_WEBHOOK_URL env var when webhookUrl is not provided", async () => {
      process.env.FEISHU_WEBHOOK_URL = "https://env.example.com/feishu";
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({ code: 0, msg: "ok" }), { status: 200 }),
        );

      await service.sendFeishuText({ content: "test" });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://env.example.com/feishu",
        expect.anything(),
      );
    });

    it("falls back to FEISHU_WEBHOOK env var", async () => {
      process.env.FEISHU_WEBHOOK = "https://fallback.example.com/feishu";
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({ code: 0, msg: "ok" }), { status: 200 }),
        );

      await service.sendFeishuText({ content: "test" });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://fallback.example.com/feishu",
        expect.anything(),
      );
    });

    it("prefers FEISHU_WEBHOOK_URL over FEISHU_WEBHOOK", async () => {
      process.env.FEISHU_WEBHOOK_URL = "https://primary.example.com/feishu";
      process.env.FEISHU_WEBHOOK = "https://fallback.example.com/feishu";
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({ code: 0, msg: "ok" }), { status: 200 }),
        );

      await service.sendFeishuText({ content: "test" });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://primary.example.com/feishu",
        expect.anything(),
      );
    });

    it("throws on non-JSON response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Not JSON", { status: 500 }),
      );

      await expect(
        service.sendFeishuText({
          content: "test",
          webhookUrl: "https://example.com/feishu",
        }),
      ).rejects.toThrow("non-JSON");
    });

    it("throws on unexpected JSON structure", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
      );

      await expect(
        service.sendFeishuText({
          content: "test",
          webhookUrl: "https://example.com/feishu",
        }),
      ).rejects.toThrow("unexpected response");
    });

    it("throws on non-zero code (code/msg format)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ code: 19001, msg: "invalid webhook" }), {
          status: 200,
        }),
      );

      await expect(
        service.sendFeishuText({
          content: "test",
          webhookUrl: "https://example.com/feishu",
        }),
      ).rejects.toThrow("invalid webhook");
    });

    it("throws on non-zero StatusCode (StatusCode/StatusMessage format)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({ StatusCode: 1, StatusMessage: "rate limited" }),
          { status: 200 },
        ),
      );

      await expect(
        service.sendFeishuText({
          content: "test",
          webhookUrl: "https://example.com/feishu",
        }),
      ).rejects.toThrow("rate limited");
    });

    it("throws on HTTP error even with code=0", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ code: 0, msg: "ok" }), { status: 503 }),
      );

      await expect(
        service.sendFeishuText({
          content: "test",
          webhookUrl: "https://example.com/feishu",
        }),
      ).rejects.toThrow("webhook error");
    });
  });
});
