
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { aiMatchingService } from "../services/ai-matching.js";
import { notificationService } from "../services/notification-service.js";
import { notificationTemplateService } from "../services/notification-template-service.js";
import { config } from "../services/config.js";
import { formatIsoOffsetInTimezone } from "../services/timezone.js";
import { requireAdmin } from "../middleware/workspace.js";

const app = new OpenAPIHono();

const SimpleErrorSchema = z.object({ error: z.string() });

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

const sendSchema = z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
});

const templateIdSchema = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

const templateDataSchema = z.record(z.string(), z.unknown());

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

const DraftResponseSchema = z.object({ subject: z.string(), body: z.string() });
const EmailPreviewResponseSchema = z.object({
    channel: z.literal("email"),
    templateId: z.string(),
    subject: z.string(),
    markdown: z.string(),
    html: z.string(),
});
const FeishuPreviewResponseSchema = z.object({
    channel: z.literal("feishu"),
    templateId: z.string(),
    content: z.string(),
});
const WechatPreviewResponseSchema = z.object({
    channel: z.literal("wechat_work"),
    templateId: z.string(),
    content: z.string(),
});
const PreviewResponseSchema = z.union([EmailPreviewResponseSchema, FeishuPreviewResponseSchema, WechatPreviewResponseSchema]);
const SendResponseSchema = z.object({
    success: z.literal(true),
    messageId: z.string().optional(),
    preview: z.string().optional(),
});
// send-template has 3 different response shapes (email/wechat/feishu) with spread operators — z.any() is the pragmatic choice
const SendTemplateResponseSchema = z.any();

// GET /api/notifications/templates
const templatesRoute = createRoute({
    method: "get",
    path: "/templates",
    tags: ["notifications"],
    summary: "List notification templates",
    responses: {
        200: { content: { "application/json": { schema: z.object({ templates: z.array(z.object({ id: z.string(), filename: z.string(), updatedAt: z.string(), size: z.number(), subject: z.string().optional() })) }) } }, description: "Templates" },
    },
});
app.openapi(templatesRoute, async (c) => {
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
const draftRoute = createRoute({
    method: "post",
    path: "/draft",
    tags: ["notifications"],
    summary: "Generate outreach draft",
    request: {
        body: { content: { "application/json": { schema: draftSchema } } },
    },
    responses: {
        200: { content: { "application/json": { schema: DraftResponseSchema } }, description: "Draft generated" },
        500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Generation failed" },
    },
});
app.openapi(draftRoute, async (c) => {
    const { resume, jobDescription, analysis } = c.req.valid("json");
    try {
        const draft = await aiMatchingService.generateOutreach(resume, jobDescription, analysis);
        return c.json({ subject: (draft as Record<string, unknown>).subject ?? "", body: (draft as Record<string, unknown>).body ?? "" } as z.infer<typeof DraftResponseSchema>, 200);
    } catch (e: unknown) {
        return c.json({ error: getErrorMessage(e) }, 500);
    }
});

// POST /api/notifications/preview
const previewRoute = createRoute({
    method: "post",
    path: "/preview",
    tags: ["notifications"],
    summary: "Preview notification template",
    request: {
        body: { content: { "application/json": { schema: previewSchema } } },
    },
    responses: {
        200: { content: { "application/json": { schema: PreviewResponseSchema } }, description: "Preview rendered" },
        500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Render failed" },
    },
});
app.openapi(previewRoute, async (c) => {
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
            }, 200);
        }

        return c.json({
            channel,
            templateId,
            content: rendered.markdown,
        }, 200);
    } catch (e: unknown) {
        return c.json({ error: getErrorMessage(e) }, 500);
    }
});

// POST /api/notifications/send
const sendRoute = createRoute({
    method: "post",
    path: "/send",
    tags: ["notifications"],
    summary: "Send email notification",
    middleware: [requireAdmin] as const,
    request: {
        body: { content: { "application/json": { schema: sendSchema } } },
    },
    responses: {
        200: { content: { "application/json": { schema: SendResponseSchema } }, description: "Email sent" },
        500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Send failed" },
    },
});
app.openapi(sendRoute, async (c) => {
    const { to, subject, body } = c.req.valid("json");
    try {
        const info = await notificationService.sendEmail({
            to,
            subject,
            html: body.replace(/\n/g, "<br>"),
        });
        const messageId = getMessageId(info);
        return c.json({ success: true as const, messageId, preview: messageId ? undefined : "Check server logs" }, 200);
    } catch (e: unknown) {
        return c.json({ error: getErrorMessage(e) }, 500);
    }
});

// POST /api/notifications/send-template
const sendTemplateRoute = createRoute({
    method: "post",
    path: "/send-template",
    tags: ["notifications"],
    summary: "Send templated notification",
    middleware: [requireAdmin] as const,
    request: {
        body: { content: { "application/json": { schema: sendTemplateSchema } } },
    },
    responses: {
        200: { content: { "application/json": { schema: SendTemplateResponseSchema } }, description: "Notification sent" },
        500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Send failed" },
    },
});
app.openapi(sendTemplateRoute, async (c) => {
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
            return c.json({ success: true as const, channel: payload.channel, messageId }, 200);
        }

        if (payload.channel === "wechat_work") {
            const result = await notificationService.sendWechatWorkMarkdown({
                webhookUrl: payload.webhookUrl,
                content: rendered.markdown,
            });
            return c.json({ success: true as const, channel: payload.channel, ...result }, 200);
        }

        const result = await notificationService.sendFeishuText({
            webhookUrl: payload.webhookUrl,
            content: rendered.markdown,
        });
        return c.json({ success: true as const, channel: payload.channel, ...result }, 200);
    } catch (e: unknown) {
        return c.json({ error: getErrorMessage(e) }, 500);
    }
});

export default app;
