import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { NotificationService } from "./notification-service.js";

describe("NotificationService", () => {
  let service: NotificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NotificationService();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  describe("sendWechatWorkMarkdown", () => {
    const defaultOpts = { content: "Hello **world**" };

    it("sends markdown content to webhook URL from options", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ errcode: 0, errmsg: "ok" }),
      });

      const result = await service.sendWechatWorkMarkdown({
        ...defaultOpts,
        webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test",
      });

      expect(result).toEqual({ errcode: 0, errmsg: "ok" });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test");
      expect(init.method).toBe("POST");
      expect(init.headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(init.body);
      expect(body.msgtype).toBe("markdown");
      expect(body.markdown.content).toBe("Hello **world**");
    });

    it("falls back to WECHAT_WORK_WEBHOOK env when no webhookUrl in options", async () => {
      vi.stubEnv("WECHAT_WORK_WEBHOOK", "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=env");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ errcode: 0, errmsg: "ok" }),
      });

      await service.sendWechatWorkMarkdown(defaultOpts);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=env");
      vi.unstubAllEnvs();
    });

    it("throws when no webhook URL is available", async () => {
      await expect(
        service.sendWechatWorkMarkdown(defaultOpts),
      ).rejects.toThrow("WECHAT_WORK_WEBHOOK is not set");
    });

    it("throws on non-ok HTTP response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ errcode: 48001, errmsg: "api forbidden" }),
      });

      await expect(
        service.sendWechatWorkMarkdown({
          ...defaultOpts,
          webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test",
        }),
      ).rejects.toThrow("WeChat Work webhook error: api forbidden (errcode=48001, HTTP 403)");
    });

    it("throws on non-zero errcode with ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ errcode: 40001, errmsg: "invalid credential" }),
      });

      await expect(
        service.sendWechatWorkMarkdown({
          ...defaultOpts,
          webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test",
        }),
      ).rejects.toThrow(
        "WeChat Work webhook error: invalid credential (errcode=40001, HTTP 200)",
      );
    });

    it("throws on non-JSON response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "<html>error</html>",
      });

      await expect(
        service.sendWechatWorkMarkdown({
          ...defaultOpts,
          webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test",
        }),
      ).rejects.toThrow(
        "WeChat Work webhook returned non-JSON (HTTP 200)",
      );
    });

    it("throws on unexpected JSON shape", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ unknown: "shape" }),
      });

      await expect(
        service.sendWechatWorkMarkdown({
          ...defaultOpts,
          webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test",
        }),
      ).rejects.toThrow(
        "WeChat Work webhook returned unexpected response (HTTP 200)",
      );
    });

    it("handles network errors", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

      await expect(
        service.sendWechatWorkMarkdown({
          ...defaultOpts,
          webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test",
        }),
      ).rejects.toThrow("fetch failed");
    });
  });

  describe("sendFeishuText", () => {
    const defaultOpts = { content: "Hello from Trends" };

    it("sends text content to webhook URL from options", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ code: 0, msg: "success" }),
      });

      const result = await service.sendFeishuText({
        ...defaultOpts,
        webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test-key",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://open.feishu.cn/open-apis/bot/v2/hook/test-key");
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body);
      expect(body.msg_type).toBe("text");
      expect(body.content.text).toBe("Hello from Trends");
      expect(result).toBeDefined();
    });

    it("falls back to FEISHU_WEBHOOK_URL env when no webhookUrl in options", async () => {
      vi.stubEnv("FEISHU_WEBHOOK_URL", "https://open.feishu.cn/open-apis/bot/v2/hook/env-key");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ code: 0, msg: "success" }),
      });

      await service.sendFeishuText(defaultOpts);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://open.feishu.cn/open-apis/bot/v2/hook/env-key");
      vi.unstubAllEnvs();
    });

    it("falls back to FEISHU_WEBHOOK env when FEISHU_WEBHOOK_URL is not set", async () => {
      vi.stubEnv("FEISHU_WEBHOOK", "https://open.feishu.cn/open-apis/bot/v2/hook/legacy-key");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ code: 0, msg: "success" }),
      });

      await service.sendFeishuText(defaultOpts);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://open.feishu.cn/open-apis/bot/v2/hook/legacy-key");
      vi.unstubAllEnvs();
    });

    it("throws when no webhook URL is available", async () => {
      await expect(
        service.sendFeishuText(defaultOpts),
      ).rejects.toThrow("FEISHU_WEBHOOK_URL is not set");
    });

    it("throws on non-ok HTTP response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ code: 10003, msg: "invalid signature" }),
      });

      await expect(
        service.sendFeishuText({
          ...defaultOpts,
          webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test-key",
        }),
      ).rejects.toThrow(
        "Feishu webhook error: invalid signature (code=10003, HTTP 401)",
      );
    });

    it("throws on non-zero code with ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ code: 10004, msg: "rate limit exceeded" }),
      });

      await expect(
        service.sendFeishuText({
          ...defaultOpts,
          webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test-key",
        }),
      ).rejects.toThrow(
        "Feishu webhook error: rate limit exceeded (code=10004, HTTP 200)",
      );
    });

    it("handles alternate response schema (StatusCode/StatusMessage)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ StatusCode: 200001, StatusMessage: "too many requests" }),
      });

      await expect(
        service.sendFeishuText({
          ...defaultOpts,
          webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test-key",
        }),
      ).rejects.toThrow(
        "Feishu webhook error: too many requests (code=200001, HTTP 429)",
      );
    });

    it("throws on non-JSON response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "not json",
      });

      await expect(
        service.sendFeishuText({
          ...defaultOpts,
          webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test-key",
        }),
      ).rejects.toThrow("Feishu webhook returned non-JSON (HTTP 200)");
    });

    it("throws on unexpected JSON shape", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ irrelevant: true }),
      });

      await expect(
        service.sendFeishuText({
          ...defaultOpts,
          webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test-key",
        }),
      ).rejects.toThrow(
        "Feishu webhook returned unexpected response (HTTP 200)",
      );
    });

    it("handles network errors", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

      await expect(
        service.sendFeishuText({
          ...defaultOpts,
          webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test-key",
        }),
      ).rejects.toThrow("fetch failed");
    });
  });
});
