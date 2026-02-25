
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { aiMatchingService } from "../services/ai-matching.js";
import { notificationService } from "../services/notification-service.js";

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

export default app;
