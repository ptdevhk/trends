
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { aiMatchingService } from "../services/ai-matching.js";
import { notificationService } from "../services/notification-service.js";
import { notificationTemplateService } from "../services/notification-template-service.js";
import { config } from "../services/config.js";
import { formatIsoOffsetInTimezone } from "../services/timezone.js";

const app = new Hono();

// Schema for generating a draft
const draftSchema = z.object({
    resume: z.object({
        id: z.string(),
        name: z.string(),
        jobIntention: z.string().optional(),
        workExperience: z.number().optional(),
        education: z.string().optional(),
        skills: z.array(z.string()).optional(),
        companies: z.array(z.string()).optional(),
        summary: z.string().optional(),
    }),
    jobDescription: z.object({
        title: z.string(),
        company: z.string().optional(),
        requirements: z.string(),
    }),
    analysis: z.object({
        score: z.number(),
        recommendation: z.enum(["strong_match", "match", "potential", "no_match"]),
        highlights: z.array(z.string()),
        concerns: z.array(z.string()),
        summary: z.string(),
    }),
});

// Schema for sending an email
const sendSchema = z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(), // HTML is expected
});

const templateIdSchema = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

const templateDataSchema = z.record(z.unknown());

const previewSchema = z.object({
    channel: z.enum(["email", "wechat_work", "feishu"]),
    templateId: templateIdSchema,
    data: templateDataSchema,
});

const sendTemplateSchema = z.discriminatedUnion("channel", [
    z.object({
        channel: z.literal("email"),
        templateId: templateIdSchema,
        to: z.string().email(),
        subject: z.string().optional(),
        data: templateDataSchema,
    }),
    z.object({
        channel: z.literal("wechat_work"),
        templateId: templateIdSchema,
        webhookUrl: z.string().url().optional(),
        data: templateDataSchema,
    }),
    z.object({
        channel: z.literal("feishu"),
        templateId: templateIdSchema,
        webhookUrl: z.string().url().optional(),
        data: templateDataSchema,
    }),
]);

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return "Unknown error";
}

function getMessageId(info: unknown): string | undefined {
    if (typeof info !== "object" || info === null || !("messageId" in info)) {
        return undefined;
    }
    const { messageId } = info;
    return typeof messageId === "string" ? messageId : undefined;
}

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function renderMarkdownAsHtml(markdown: string): string {
    const escaped = escapeHtml(markdown);
    return `<pre style="white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">${escaped}</pre>`;
}

function computeMatchStars(matchScore: unknown): string {
    const score = typeof matchScore === "number"
        ? matchScore
        : typeof matchScore === "string"
            ? Number(matchScore)
            : Number.NaN;
    if (!Number.isFinite(score)) return "";
    if (score >= 90) return "⭐⭐⭐";
    if (score >= 80) return "⭐⭐";
    if (score >= 70) return "⭐";
    return "";
}

function buildTemplateData(data: Record<string, unknown>): Record<string, unknown> {
    return {
        ...data,
        timestamp: data.timestamp ?? formatIsoOffsetInTimezone(new Date(), config.timezone),
        matchStars: data.matchStars ?? computeMatchStars(data.matchScore),
    };
}

// GET /api/notifications/templates
app.get("/templates", async (c) => {
    const templates = notificationTemplateService.listTemplates().map((item) => ({
        id: item.id,
        filename: item.filename,
        updatedAt: item.updatedAt,
        size: item.size,
        subject: item.subject,
    }));
    return c.json({ templates });
});

// POST /api/notifications/draft
app.post(
    "/draft",
    zValidator("json", draftSchema),
    async (c) => {
        const { resume, jobDescription, analysis } = c.req.valid("json");
        try {
            const draft = await aiMatchingService.generateOutreach(resume, jobDescription, analysis);
            return c.json(draft);
        } catch (e: unknown) {
            return c.json({ error: getErrorMessage(e) }, 500);
        }
    }
);

// POST /api/notifications/preview
app.post(
    "/preview",
    zValidator("json", previewSchema),
    async (c) => {
        const { channel, templateId, data } = c.req.valid("json");
        try {
            const rendered = notificationTemplateService.render(templateId, buildTemplateData(data));

            if (channel === "email") {
                return c.json({
                    channel,
                    templateId,
                    subject: rendered.subject ?? "",
                    markdown: rendered.markdown,
                    html: renderMarkdownAsHtml(rendered.markdown),
                });
            }

            return c.json({
                channel,
                templateId,
                content: rendered.markdown,
            });
        } catch (e: unknown) {
            return c.json({ error: getErrorMessage(e) }, 500);
        }
    }
);

// POST /api/notifications/send
app.post(
    "/send",
    zValidator("json", sendSchema),
    async (c) => {
        const { to, subject, body } = c.req.valid("json");
        try {
            const info = await notificationService.sendEmail({
                to,
                subject,
                html: body.replace(/\n/g, "<br>"), // Simple text-to-HTML conversion
            });
            const messageId = getMessageId(info);
            return c.json({ success: true, messageId, preview: messageId ? undefined : "Check server logs" });
        } catch (e: unknown) {
            return c.json({ error: getErrorMessage(e) }, 500);
        }
    }
);

// POST /api/notifications/send-template
app.post(
    "/send-template",
    zValidator("json", sendTemplateSchema),
    async (c) => {
        const payload = c.req.valid("json");
        try {
            const rendered = notificationTemplateService.render(payload.templateId, buildTemplateData(payload.data));

            if (payload.channel === "email") {
                const subject = payload.subject ?? rendered.subject ?? "";
                const info = await notificationService.sendEmail({
                    to: payload.to,
                    subject,
                    text: rendered.markdown,
                    html: renderMarkdownAsHtml(rendered.markdown),
                });
                const messageId = getMessageId(info);
                return c.json({ success: true, channel: payload.channel, messageId });
            }

            if (payload.channel === "wechat_work") {
                const result = await notificationService.sendWechatWorkMarkdown({
                    webhookUrl: payload.webhookUrl,
                    content: rendered.markdown,
                });
                return c.json({ success: true, channel: payload.channel, ...result });
            }

            const result = await notificationService.sendFeishuText({
                webhookUrl: payload.webhookUrl,
                content: rendered.markdown,
            });
            return c.json({ success: true, channel: payload.channel, ...result });
        } catch (e: unknown) {
            return c.json({ error: getErrorMessage(e) }, 500);
        }
    }
);

export default app;
