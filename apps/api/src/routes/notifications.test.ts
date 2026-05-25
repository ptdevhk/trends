import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

import notificationsRoutes from './notifications'
import { aiMatchingService } from '../services/ai-matching'
import { notificationService } from '../services/notification-service'
import { notificationTemplateService } from '../services/notification-template-service'
import { workspaceMiddleware } from '../middleware/workspace'

function createTestApp() {
  const app = new Hono()
  app.use('/api/*', workspaceMiddleware)
  app.route('/api/notifications', notificationsRoutes)
  return app
}

const MOCK_TEMPLATES = [
  { id: 'outreach-email', filename: 'outreach-email.md', updatedAt: '2026-05-22T10:00:00Z', size: 512, subject: 'Reaching out' },
  { id: 'match-alert', filename: 'match-alert.md', updatedAt: '2026-05-22T11:00:00Z', size: 256, subject: 'New match' },
]

const MOCK_DRAFT = {
  subject: 'Opportunity at TestCo',
  body: 'Dear Zhang, we found your profile interesting...',
}

const MOCK_RENDERED = {
  subject: 'Match Alert',
  markdown: 'New match found for **CNC Engineer**',
}

describe('notifications routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET /api/notifications/templates', () => {
    it('returns template list', async () => {
      vi.spyOn(notificationTemplateService, 'listTemplates').mockReturnValue(MOCK_TEMPLATES as never)
      const app = createTestApp()
      const response = await app.request('/api/notifications/templates')
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.templates).toHaveLength(2)
      expect(body.templates[0].id).toBe('outreach-email')
    })

    it('strips body from template items', async () => {
      vi.spyOn(notificationTemplateService, 'listTemplates').mockReturnValue(MOCK_TEMPLATES as never)
      const app = createTestApp()
      const response = await app.request('/api/notifications/templates')
      const body = await response.json()
      expect(body.templates[0]).not.toHaveProperty('body')
    })
  })

  describe('POST /api/notifications/draft', () => {
    const validDraft = {
      resume: { id: 'r1', name: 'Zhang San', jobIntention: 'CNC Engineer' },
      jobDescription: { title: 'Senior CNC Engineer', requirements: '5+ years experience' },
      analysis: { score: 85, recommendation: 'match', highlights: ['Strong CNC'], concerns: [], summary: 'Good fit' },
    }

    it('generates outreach draft', async () => {
      vi.spyOn(aiMatchingService, 'generateOutreach').mockResolvedValue(MOCK_DRAFT as never)
      const app = createTestApp()
      const response = await app.request('/api/notifications/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validDraft),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.subject).toBe('Opportunity at TestCo')
    })

    it('returns 500 when AI service fails', async () => {
      vi.spyOn(aiMatchingService, 'generateOutreach').mockRejectedValue(new Error('AI unavailable'))
      const app = createTestApp()
      const response = await app.request('/api/notifications/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validDraft),
      })
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error).toBe('AI unavailable')
    })

    it('rejects invalid request body', async () => {
      const app = createTestApp()
      const response = await app.request('/api/notifications/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(400)
    })
  })

  describe('POST /api/notifications/preview', () => {
    it('renders email preview with HTML', async () => {
      vi.spyOn(notificationTemplateService, 'render').mockReturnValue(MOCK_RENDERED as never)
      const app = createTestApp()
      const response = await app.request('/api/notifications/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'email', templateId: 'outreach-email', data: {} }),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.channel).toBe('email')
      expect(body.html).toContain('<pre')
      expect(body.markdown).toContain('New match')
    })

    it('renders non-email preview without HTML', async () => {
      vi.spyOn(notificationTemplateService, 'render').mockReturnValue(MOCK_RENDERED as never)
      const app = createTestApp()
      const response = await app.request('/api/notifications/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'feishu', templateId: 'outreach-email', data: {} }),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.channel).toBe('feishu')
      expect(body.content).toContain('New match')
      expect(body).not.toHaveProperty('html')
    })

    it('returns 500 when render fails', async () => {
      vi.spyOn(notificationTemplateService, 'render').mockImplementation(() => {
        throw new Error('Template not found')
      })
      const app = createTestApp()
      const response = await app.request('/api/notifications/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'email', templateId: 'missing', data: {} }),
      })
      expect(response.status).toBe(500)
    })
  })

  describe('POST /api/notifications/send', () => {
    it('sends email and returns messageId', async () => {
      vi.spyOn(notificationService, 'sendEmail').mockResolvedValue({ messageId: 'msg-123' } as never)
      const app = createTestApp()
      const response = await app.request('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Slug': 'dev' },
        body: JSON.stringify({ to: 'test@example.com', subject: 'Hello', body: '<p>Hi</p>' }),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.messageId).toBe('msg-123')
    })

    it('returns 500 when send fails', async () => {
      vi.spyOn(notificationService, 'sendEmail').mockRejectedValue(new Error('SMTP error'))
      const app = createTestApp()
      const response = await app.request('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Slug': 'dev' },
        body: JSON.stringify({ to: 'test@example.com', subject: 'Hello', body: '<p>Hi</p>' }),
      })
      expect(response.status).toBe(500)
    })

    it('rejects invalid email', async () => {
      const app = createTestApp()
      const response = await app.request('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Slug': 'dev' },
        body: JSON.stringify({ to: 'not-an-email', subject: 'Hello', body: 'test' }),
      })
      expect(response.status).toBe(400)
    })
  })

  describe('POST /api/notifications/send-template', () => {
    it('sends via email channel', async () => {
      vi.spyOn(notificationTemplateService, 'render').mockReturnValue(MOCK_RENDERED as never)
      vi.spyOn(notificationService, 'sendEmail').mockResolvedValue({ messageId: 'msg-456' } as never)
      const app = createTestApp()
      const response = await app.request('/api/notifications/send-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Slug': 'dev' },
        body: JSON.stringify({ channel: 'email', templateId: 'outreach-email', to: 'test@example.com', data: {} }),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.channel).toBe('email')
      expect(body.messageId).toBe('msg-456')
    })

    it('sends via wechat_work channel', async () => {
      vi.spyOn(notificationTemplateService, 'render').mockReturnValue(MOCK_RENDERED as never)
      vi.spyOn(notificationService, 'sendWechatWorkMarkdown').mockResolvedValue({ errcode: 0 } as never)
      const app = createTestApp()
      const response = await app.request('/api/notifications/send-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Slug': 'dev' },
        body: JSON.stringify({ channel: 'wechat_work', templateId: 'match-alert', data: {} }),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.channel).toBe('wechat_work')
    })

    it('sends via feishu channel', async () => {
      vi.spyOn(notificationTemplateService, 'render').mockReturnValue(MOCK_RENDERED as never)
      vi.spyOn(notificationService, 'sendFeishuText').mockResolvedValue({ code: 0 } as never)
      const app = createTestApp()
      const response = await app.request('/api/notifications/send-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Slug': 'dev' },
        body: JSON.stringify({ channel: 'feishu', templateId: 'match-alert', data: {} }),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.channel).toBe('feishu')
    })

    it('returns 500 when template render fails', async () => {
      vi.spyOn(notificationTemplateService, 'render').mockImplementation(() => {
        throw new Error('Missing template')
      })
      const app = createTestApp()
      const response = await app.request('/api/notifications/send-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Slug': 'dev' },
        body: JSON.stringify({ channel: 'email', templateId: 'missing', to: 'test@example.com', data: {} }),
      })
      expect(response.status).toBe(500)
    })
  })

  describe('admin guard', () => {
    it('rejects /send without admin workspace', async () => {
      const app = createTestApp()
      const response = await app.request('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Slug': 'hr' },
        body: JSON.stringify({ to: 'test@example.com', subject: 'Hello', body: '<p>Hi</p>' }),
      })
      expect(response.status).toBe(403)
    })

    it('rejects /send-template without admin workspace', async () => {
      const app = createTestApp()
      const response = await app.request('/api/notifications/send-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Slug': 'hr' },
        body: JSON.stringify({ channel: 'email', templateId: 'outreach-email', to: 'test@example.com', data: {} }),
      })
      expect(response.status).toBe(403)
    })
  })
})
