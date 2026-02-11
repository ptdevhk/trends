import nodemailer from 'nodemailer';

export interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

export interface NotificationAdapter {
    sendEmail(options: EmailOptions): Promise<any>;
}

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
}

export const notificationService = new NotificationService();
