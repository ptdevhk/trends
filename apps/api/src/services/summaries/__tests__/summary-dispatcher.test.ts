import { describe, expect, it, vi, beforeEach } from "vitest";

import type { SummaryReport } from "@trends/shared";

import { SummaryDispatcher } from "../summary-dispatcher.js";

const mockReport: SummaryReport = {
  workspaceSlug: "dev",
  period: "daily",
  generatedAt: "2026-05-25T09:00:00Z",
  window: { startAt: "2026-05-24T00:00:00Z", endAt: "2026-05-25T00:00:00Z", timezone: "Asia/Hong_Kong" },
  totals: {
    newResumes: 12,
    collectionTasksCompleted: 8,
    collectionTasksFailed: 1,
    candidateStatusUpdates: 5,
    shortlistActions: 3,
    rejectActions: 1,
    contactActions: 0,
  },
  breakdowns: {
    resumesBySource: [],
    collectionTasksByStatus: [],
    candidateStatusByValue: [],
    actionsByType: [],
  },
  notes: [],
}

const mockRender = vi.fn()
const mockSendEmail = vi.fn()
const mockSendWechatWorkMarkdown = vi.fn()
const mockSendFeishuText = vi.fn()
const mockTelegramSend = vi.fn()

function createDispatcher() {
  return new SummaryDispatcher({
    notificationService: {
      sendEmail: mockSendEmail,
      sendWechatWorkMarkdown: mockSendWechatWorkMarkdown,
      sendFeishuText: mockSendFeishuText,
    },
    notificationTemplateService: { render: mockRender },
    telegramBridge: { send: mockTelegramSend },
  })
}

describe("SummaryDispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRender.mockReturnValue({ subject: "Daily Ops Summary", markdown: "# Daily summary content" })
    mockSendEmail.mockResolvedValue({ messageId: "msg-123" })
    mockSendWechatWorkMarkdown.mockResolvedValue({ errcode: 0, errmsg: "ok" })
    mockSendFeishuText.mockResolvedValue({ code: 0, msg: "success" })
    mockTelegramSend.mockResolvedValue({ ok: true })
  })

  describe("buildPreview", () => {
    it("builds preview with default template for daily period", () => {
      const dispatcher = createDispatcher()

      const preview = dispatcher.buildPreview(mockReport, {})

      expect(preview.templateId).toBe("summary-daily")
      expect(preview.subject).toBe("Daily Ops Summary")
      expect(preview.content).toBe("# Daily summary content")
    })

    it("uses provided templateId when given", () => {
      const dispatcher = createDispatcher()

      const preview = dispatcher.buildPreview(mockReport, { templateId: "custom-template" })

      expect(preview.templateId).toBe("custom-template")
      expect(mockRender).toHaveBeenCalledWith("custom-template", expect.objectContaining({ workspaceSlug: "dev" }))
    })

    it("trims whitespace from templateId", () => {
      const dispatcher = createDispatcher()

      const preview = dispatcher.buildPreview(mockReport, { templateId: "  summary-weekly  " })

      expect(preview.templateId).toBe("summary-weekly")
    })

    it("falls back to default template when templateId is empty", () => {
      const dispatcher = createDispatcher()

      const preview = dispatcher.buildPreview(mockReport, { templateId: "" })

      expect(preview.templateId).toBe("summary-daily")
    })
  })

  describe("dispatch", () => {
    it("returns preview without delivery in dryRun mode", async () => {
      const dispatcher = createDispatcher()

      const result = await dispatcher.dispatch(mockReport, { channel: "email", dryRun: true, to: "admin@example.com" })

      expect(result.dryRun).toBe(true)
      expect(result.channel).toBe("email")
      expect(result.delivery).toBeUndefined()
      expect(mockSendEmail).not.toHaveBeenCalled()
    })

    it("sends email with HTML rendering", async () => {
      const dispatcher = createDispatcher()

      const result = await dispatcher.dispatch(mockReport, { channel: "email", to: "admin@example.com" })

      expect(result.channel).toBe("email")
      expect(result.dryRun).toBe(false)
      expect(result.delivery?.messageId).toBe("msg-123")
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "admin@example.com",
          html: expect.stringContaining("Daily summary content"),
        }),
      )
    })

    it("throws when email channel is missing recipient", async () => {
      const dispatcher = createDispatcher()

      await expect(dispatcher.dispatch(mockReport, { channel: "email" })).rejects.toThrow("Email recipient is required")
    })

    it("uses custom subject for email", async () => {
      const dispatcher = createDispatcher()

      await dispatcher.dispatch(mockReport, { channel: "email", to: "admin@example.com", subject: "Custom Subject" })

      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: "Custom Subject" }),
      )
    })

    it("sends WeChat Work markdown message", async () => {
      const dispatcher = createDispatcher()

      const result = await dispatcher.dispatch(mockReport, { channel: "wechat_work", webhookUrl: "https://example.com/webhook" })

      expect(result.channel).toBe("wechat_work")
      expect(mockSendWechatWorkMarkdown).toHaveBeenCalledWith(
        expect.objectContaining({ content: "# Daily summary content" }),
      )
    })

    it("sends Feishu text message", async () => {
      const dispatcher = createDispatcher()

      const result = await dispatcher.dispatch(mockReport, { channel: "feishu", webhookUrl: "https://example.com/webhook" })

      expect(result.channel).toBe("feishu")
      expect(mockSendFeishuText).toHaveBeenCalledWith(
        expect.objectContaining({ content: "# Daily summary content" }),
      )
    })

    it("sends Telegram message", async () => {
      const dispatcher = createDispatcher()

      const result = await dispatcher.dispatch(mockReport, { channel: "telegram", botToken: "bot-token", chatId: "chat-123" })

      expect(result.channel).toBe("telegram")
      expect(mockTelegramSend).toHaveBeenCalledWith(
        expect.objectContaining({ content: "# Daily summary content", botToken: "bot-token", chatId: "chat-123" }),
      )
    })

    it("escapes HTML in email body", async () => {
      const dispatcher = createDispatcher()
      mockRender.mockReturnValue({ subject: "Summary", markdown: '<script>alert("xss")</script>' })

      await dispatcher.dispatch(mockReport, { channel: "email", to: "admin@example.com" })

      const callArgs = mockSendEmail.mock.calls[0][0]
      expect(callArgs.html).not.toContain("<script>")
      expect(callArgs.html).toContain("&lt;script&gt;")
    })
  })
})
