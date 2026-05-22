import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SummaryReport } from "@trends/shared";

import { SummaryDispatcher } from "../summaries/summary-dispatcher.js";

function makeReport(overrides: Partial<SummaryReport> = {}): SummaryReport {
  return {
    workspaceSlug: "test-ws",
    period: "daily",
    generatedAt: "2026-05-22T10:00:00Z",
    window: { startAt: "2026-05-21", endAt: "2026-05-22", timezone: "Asia/Shanghai" },
    totals: {
      newResumes: 5,
      candidateStatusUpdates: 2,
      shortlistActions: 1,
      rejectActions: 0,
      contactActions: 1,
      collectionTasksCompleted: 4,
      collectionTasksFailed: 0,
    },
    breakdowns: {
      resumesBySource: [],
      candidateStatusByValue: [],
      actionsByType: [],
      collectionTasksByStatus: [],
    },
    notes: [],
    ...overrides,
  };
}

const mockTemplateService = {
  render: vi.fn().mockReturnValue({ subject: "Daily Summary", markdown: "# Daily Summary\nContent here" }),
};

const mockNotificationService = {
  sendEmail: vi.fn().mockResolvedValue({ messageId: "msg-123" }),
  sendWechatWorkMarkdown: vi.fn().mockResolvedValue({ errcode: 0 }),
  sendFeishuText: vi.fn().mockResolvedValue({ code: 0 }),
};

const mockTelegramBridge = {
  send: vi.fn().mockResolvedValue({ ok: true }),
};

describe("SummaryDispatcher", () => {
  const dispatcher = new SummaryDispatcher({
    notificationTemplateService: mockTemplateService,
    notificationService: mockNotificationService,
    telegramBridge: mockTelegramBridge,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- buildPreview ---

  describe("buildPreview", () => {
    it("uses explicit templateId when provided", () => {
      const preview = dispatcher.buildPreview(makeReport(), { templateId: "custom-template" });
      expect(preview.templateId).toBe("custom-template");
      expect(mockTemplateService.render).toHaveBeenCalledWith("custom-template", expect.any(Object));
    });

    it("falls back to default templateId when not provided", () => {
      const preview = dispatcher.buildPreview(makeReport(), {});
      expect(preview.templateId).toBe("summary-daily");
    });

    it("falls back to default templateId for blank templateId", () => {
      const preview = dispatcher.buildPreview(makeReport(), { templateId: "   " });
      expect(preview.templateId).toBe("summary-daily");
    });

    it("passes template data with timestamp and summaryTitle", () => {
      dispatcher.buildPreview(makeReport(), {});
      const data = mockTemplateService.render.mock.calls[0][1];
      expect(data.timestamp).toBe("2026-05-22T10:00:00Z");
      expect(data.summaryTitle).toBe("Daily Ops Summary");
    });
  });

  // --- dispatch (dry run) ---

  describe("dispatch (dry run)", () => {
    it("returns preview without sending on dryRun", async () => {
      const result = await dispatcher.dispatch(makeReport(), {
        channel: "email",
        dryRun: true,
        to: "test@example.com",
      });
      expect(result.dryRun).toBe(true);
      expect(result.channel).toBe("email");
      expect(result.content).toBe("# Daily Summary\nContent here");
      expect(mockNotificationService.sendEmail).not.toHaveBeenCalled();
    });
  });

  // --- dispatch (email) ---

  describe("dispatch (email)", () => {
    it("sends email and returns messageId", async () => {
      const result = await dispatcher.dispatch(makeReport(), {
        channel: "email",
        to: "test@example.com",
      });
      expect(result.channel).toBe("email");
      expect(result.delivery?.messageId).toBe("msg-123");
      expect(mockNotificationService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "test@example.com" }),
      );
    });

    it("throws when email recipient is missing", async () => {
      await expect(
        dispatcher.dispatch(makeReport(), { channel: "email" }),
      ).rejects.toThrow("Email recipient is required");
    });

    it("uses custom subject when provided", async () => {
      await dispatcher.dispatch(makeReport(), {
        channel: "email",
        to: "test@example.com",
        subject: "Custom Subject",
      });
      expect(mockNotificationService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: "Custom Subject" }),
      );
    });
  });

  // --- dispatch (wechat_work) ---

  describe("dispatch (wechat_work)", () => {
    it("sends wechat work markdown", async () => {
      const result = await dispatcher.dispatch(makeReport(), {
        channel: "wechat_work",
        webhookUrl: "https://example.com/webhook",
      });
      expect(result.channel).toBe("wechat_work");
      expect(mockNotificationService.sendWechatWorkMarkdown).toHaveBeenCalledWith(
        expect.objectContaining({ webhookUrl: "https://example.com/webhook" }),
      );
    });
  });

  // --- dispatch (feishu) ---

  describe("dispatch (feishu)", () => {
    it("sends feishu text", async () => {
      const result = await dispatcher.dispatch(makeReport(), {
        channel: "feishu",
        webhookUrl: "https://example.com/feishu",
      });
      expect(result.channel).toBe("feishu");
      expect(mockNotificationService.sendFeishuText).toHaveBeenCalledWith(
        expect.objectContaining({ webhookUrl: "https://example.com/feishu" }),
      );
    });
  });

  // --- dispatch (telegram) ---

  describe("dispatch (telegram)", () => {
    it("sends via telegram bridge", async () => {
      const result = await dispatcher.dispatch(makeReport(), {
        channel: "telegram",
        botToken: "bot-token",
        chatId: "chat-123",
      });
      expect(result.channel).toBe("telegram");
      expect(mockTelegramBridge.send).toHaveBeenCalledWith(
        expect.objectContaining({ botToken: "bot-token", chatId: "chat-123" }),
      );
    });
  });
});
