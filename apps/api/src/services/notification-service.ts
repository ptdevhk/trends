import nodemailer from 'nodemailer';
import { z } from 'zod';

export interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

export interface WechatWorkMarkdownOptions {
    content: string;
    webhookUrl?: string;
}

export interface NotificationAdapter {
    sendEmail(options: EmailOptions): Promise<unknown>;
}

const wechatWorkWebhookResponseSchema = z.object({
    errcode: z.number(),
    errmsg: z.string(),
});

class EtherealAdapter implements NotificationAdapter {
    private transporter: nodemailer.Transporter | null = null;

    async getTransporter() {
        if (!this.transporter) {
            const testAccount = await nodemailer.createTestAccount();
            this.transporter = nodemailer.createTransport({
                host: testAccount.smtp.host,
                port: testAccount.smtp.port,
                secure: testAccount.smtp.secure,
                auth: {
                    user: testAccount.user,
                    pass: testAccount.pass,
                },
            });
            console.log('📧 Ethereal Email Adapter Ready');
            console.log(`   User: ${testAccount.user}`);
        }
        return this.transporter;
    }

    async sendEmail(options: EmailOptions) {
        const transporter = await this.getTransporter();
        const info = await transporter.sendMail({
            from: '"TrendRadar Recruiter" <recruiter@example.com>',
            to: options.to,
            subject: options.subject,
            text: options.text || options.html.replace(/<[^>]*>/g, ''), // Fallback text
            html: options.html,
        });

        console.log('Message sent: %s', info.messageId);
        console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
        return info;
    }
}

class SmtpAdapter implements NotificationAdapter {
    private transporter: nodemailer.Transporter;

    constructor() {
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }

    async sendEmail(options: EmailOptions) {
        return this.transporter.sendMail({
            from: process.env.SMTP_FROM || '"TrendRadar Recruiter" <noreply@example.com>',
            ...options,
        });
    }
}

export class NotificationService {
    private adapter: NotificationAdapter;

    constructor() {
        // Default to Ethereal if no SMTP credentials are provided
        if (process.env.SMTP_HOST) {
            this.adapter = new SmtpAdapter();
        } else {
            this.adapter = new EtherealAdapter();
        }
    }

    async sendEmail(options: EmailOptions) {
        return this.adapter.sendEmail(options);
    }

    async sendWechatWorkMarkdown(options: WechatWorkMarkdownOptions) {
        const webhookUrl = options.webhookUrl ?? process.env.WECHAT_WORK_WEBHOOK;
        if (!webhookUrl) {
            throw new Error("WECHAT_WORK_WEBHOOK is not set");
        }

        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                msgtype: "markdown",
                markdown: { content: options.content },
            }),
        });

        const rawText = await response.text();
        let rawJson: unknown;
        try {
            rawJson = JSON.parse(rawText);
        } catch {
            throw new Error(`WeChat Work webhook returned non-JSON (HTTP ${response.status})`);
        }

        const parsed = wechatWorkWebhookResponseSchema.safeParse(rawJson);
        if (!parsed.success) {
            throw new Error(`WeChat Work webhook returned unexpected response (HTTP ${response.status})`);
        }

        if (!response.ok || parsed.data.errcode !== 0) {
            throw new Error(`WeChat Work webhook error: ${parsed.data.errmsg} (errcode=${parsed.data.errcode}, HTTP ${response.status})`);
        }

        return parsed.data;
    }
}

export const notificationService = new NotificationService();
