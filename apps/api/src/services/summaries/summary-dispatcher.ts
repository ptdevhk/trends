import type { SummaryChannel, SummaryReport } from "@trends/shared";

import { notificationService } from "../notification-service.js";
import { notificationTemplateService } from "../notification-template-service.js";
import { getDefaultTemplateId, getSummaryTitle } from "./summary-shared.js";
import { summaryTelegramBridge } from "./summary-telegram-bridge.js";

type SummaryDispatcherDependencies = {
  notificationService?: Pick<typeof notificationService, "sendEmail" | "sendWechatWorkMarkdown" | "sendFeishuText">;
  notificationTemplateService?: Pick<typeof notificationTemplateService, "render">;
  telegramBridge?: Pick<typeof summaryTelegramBridge, "send">;
};

export type SummaryDispatchRequest = {
  channel: SummaryChannel;
  dryRun?: boolean;
  templateId?: string;
  to?: string;
  subject?: string;
  webhookUrl?: string;
  botToken?: string;
  chatId?: string;
};

export type SummaryDispatchPreview = {
  templateId: string;
  subject?: string;
  content: string;
};

export type SummaryDispatchResult = SummaryDispatchPreview & {
  channel: SummaryChannel;
  dryRun: boolean;
  delivery?: Record<string, unknown>;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMarkdownAsHtml(markdown: string): string {
  return `<pre style="white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">${escapeHtml(markdown)}</pre>`;
}

function getMessageId(info: unknown): string | undefined {
  if (typeof info !== "object" || info === null || !("messageId" in info)) {
    return undefined;
  }
  return typeof info.messageId === "string" ? info.messageId : undefined;
}

function buildTemplateData(report: SummaryReport): Record<string, unknown> {
  return {
    ...report,
    timestamp: report.generatedAt,
    summaryTitle: getSummaryTitle(report.period),
  };
}

export class SummaryDispatcher {
  private readonly notifications: Pick<typeof notificationService, "sendEmail" | "sendWechatWorkMarkdown" | "sendFeishuText">;
  private readonly templates: Pick<typeof notificationTemplateService, "render">;
  private readonly telegramBridge: Pick<typeof summaryTelegramBridge, "send">;

  constructor(dependencies: SummaryDispatcherDependencies = {}) {
    this.notifications = dependencies.notificationService ?? notificationService;
    this.templates = dependencies.notificationTemplateService ?? notificationTemplateService;
    this.telegramBridge = dependencies.telegramBridge ?? summaryTelegramBridge;
  }

  buildPreview(report: SummaryReport, request: Pick<SummaryDispatchRequest, "templateId">): SummaryDispatchPreview {
    const templateId = request.templateId?.trim() || getDefaultTemplateId(report.period);
    const rendered = this.templates.render(templateId, buildTemplateData(report));

    return {
      templateId,
      subject: rendered.subject,
      content: rendered.markdown,
    };
  }

  async dispatch(report: SummaryReport, request: SummaryDispatchRequest): Promise<SummaryDispatchResult> {
    const preview = this.buildPreview(report, request);
    const dryRun = request.dryRun === true;

    if (dryRun) {
      return {
        ...preview,
        channel: request.channel,
        dryRun,
      };
    }

    if (request.channel === "email") {
      if (!request.to) {
        throw new Error("Email recipient is required");
      }

      const subject = request.subject?.trim() || preview.subject || `${getSummaryTitle(report.period)} (${report.workspaceSlug})`;
      const delivery = await this.notifications.sendEmail({
        to: request.to,
        subject,
        text: preview.content,
        html: renderMarkdownAsHtml(preview.content),
      });

      return {
        ...preview,
        channel: request.channel,
        dryRun,
        delivery: {
          messageId: getMessageId(delivery),
        },
      };
    }

    if (request.channel === "wechat_work") {
      const delivery = await this.notifications.sendWechatWorkMarkdown({
        webhookUrl: request.webhookUrl,
        content: preview.content,
      });
      return {
        ...preview,
        channel: request.channel,
        dryRun,
        delivery: delivery as Record<string, unknown>,
      };
    }

    if (request.channel === "feishu") {
      const delivery = await this.notifications.sendFeishuText({
        webhookUrl: request.webhookUrl,
        content: preview.content,
      });
      return {
        ...preview,
        channel: request.channel,
        dryRun,
        delivery: delivery as Record<string, unknown>,
      };
    }

    const delivery = await this.telegramBridge.send({
      content: preview.content,
      botToken: request.botToken,
      chatId: request.chatId,
    });

    return {
      ...preview,
      channel: request.channel,
      dryRun,
      delivery,
    };
  }
}

export const summaryDispatcher = new SummaryDispatcher();
