import { OpenAPIHono } from '@hono/zod-openapi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import scoringEvalRoutes from './scoring-evaluation'
import { workspaceMiddleware } from '../middleware/workspace'
import { SearchEventAnalyzer } from '../services/search-event-analyzer'
import { ScoringAutoTuner } from '../services/scoring-auto-tuner'
import { WeightHistoryService } from '../services/weight-history'
import { workspaceConfigService } from '../services/workspace-config-service'

function createTestApp() {
  const app = new OpenAPIHono()
  app.use('*', workspaceMiddleware)
  app.route('/api/scoring-evaluation', scoringEvalRoutes)
  return app
}

const ADMIN_HEADERS = { 'X-Workspace-Slug': 'dev' }

const MOCK_REPORT = {
  periodDays: 14,
  k: 10,
  queries: [{ jobDescriptionId: 'jd-1', ndcgAtK: 0.85, shortlistAtK: 0.6 }],
  zeroResultQueries: [],
  totalEvents: 42,
}

const MOCK_METRICS = {
  jobDescriptionId: 'jd-1',
  periodDays: 14,
  k: 10,
  rankedCount: 50,
  labeledCount: 20,
  shortlistCount: 12,
  rejectCount: 8,
  ndcgAtK: 0.85,
  shortlistAtK: 0.6,
}

const MOCK_CATEGORY_WEIGHTS = {
  skillMatch: 20,
  roleMatch: 20,
  experienceMatch: 15,
  educationMatch: 10,
  locationMatch: 10,
  industryMatch: 15,
  brandRelevance: 10,
}

const MOCK_VALIDATION = {
  jobDescriptionId: 'jd-1',
  periodDays: 14,
  k: 10,
  currentNdcgAtK: 0.85,
  projectedNdcgAtK: 0.90,
  currentShortlistAtK: 0.6,
  projectedShortlistAtK: 0.7,
}

const MOCK_TUNER_RESULT = {
  dryRun: false,
  improvements: [{ jobDescriptionId: 'jd-1', ndcgImprovement: 0.05 }],
  appliedCount: 1,
}

const MOCK_HISTORY_ITEMS = [
  {
    ts: '2026-05-22T10:00:00.000Z',
    reason: 'auto-tune',
    jobDescriptionId: 'jd-1',
    before: MOCK_CATEGORY_WEIGHTS,
    after: { ...MOCK_CATEGORY_WEIGHTS, skillMatch: 25 },
    metrics: { currentNdcgAtK: 0.85, projectedNdcgAtK: 0.90 },
  },
  {
    ts: '2026-05-21T10:00:00.000Z',
    reason: 'manual',
    jobDescriptionId: 'jd-2',
    before: MOCK_CATEGORY_WEIGHTS,
    after: { ...MOCK_CATEGORY_WEIGHTS, roleMatch: 25 },
    metrics: { currentNdcgAtK: 0.80, projectedNdcgAtK: 0.85 },
  },
]

describe('scoring-evaluation routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET /api/scoring-evaluation/report', () => {
    it('returns scoring analysis report', async () => {
      vi.spyOn(SearchEventAnalyzer.prototype, 'analyze').mockReturnValue(MOCK_REPORT as never)
      const app = createTestApp()
      const response = await app.request('/api/scoring-evaluation/report', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.report.periodDays).toBe(14)
    })

    it('passes periodDays and k query params', async () => {
      const analyzeSpy = vi.spyOn(SearchEventAnalyzer.prototype, 'analyze').mockReturnValue(MOCK_REPORT as never)
      const app = createTestApp()
      await app.request('/api/scoring-evaluation/report?periodDays=7&k=5', {
        headers: ADMIN_HEADERS,
      })
      expect(analyzeSpy).toHaveBeenCalledWith({ periodDays: 7, k: 5 })
    })

    it('uses default values when no query params', async () => {
      const analyzeSpy = vi.spyOn(SearchEventAnalyzer.prototype, 'analyze').mockReturnValue(MOCK_REPORT as never)
      const app = createTestApp()
      await app.request('/api/scoring-evaluation/report', {
        headers: ADMIN_HEADERS,
      })
      expect(analyzeSpy).toHaveBeenCalledWith({})
    })
  })

  describe('GET /api/scoring-evaluation/metrics', () => {
    it('returns ranking metrics for a job description', async () => {
      vi.spyOn(SearchEventAnalyzer.prototype, 'computeJobMetrics').mockReturnValue(MOCK_METRICS as never)
      const app = createTestApp()
      const response = await app.request('/api/scoring-evaluation/metrics?jobDescriptionId=jd-1', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.metrics.jobDescriptionId).toBe('jd-1')
      expect(body.metrics.ndcgAtK).toBe(0.85)
    })

    it('passes optional periodDays and k', async () => {
      const metricsSpy = vi.spyOn(SearchEventAnalyzer.prototype, 'computeJobMetrics').mockReturnValue(MOCK_METRICS as never)
      const app = createTestApp()
      await app.request('/api/scoring-evaluation/metrics?jobDescriptionId=jd-1&periodDays=30&k=20', {
        headers: ADMIN_HEADERS,
      })
      expect(metricsSpy).toHaveBeenCalledWith({
        jobDescriptionId: 'jd-1',
        periodDays: 30,
        k: 20,
      })
    })

    it('requires jobDescriptionId query param', async () => {
      const app = createTestApp()
      const response = await app.request('/api/scoring-evaluation/metrics', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(400)
    })
  })

  describe('POST /api/scoring-evaluation/validate-weights', () => {
    it('returns validation report for proposed weights', async () => {
      vi.spyOn(SearchEventAnalyzer.prototype, 'validateCategoryWeights').mockReturnValue(MOCK_VALIDATION as never)
      const app = createTestApp()
      const response = await app.request('/api/scoring-evaluation/validate-weights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({
          jobDescriptionId: 'jd-1',
          proposedCategoryWeights: MOCK_CATEGORY_WEIGHTS,
        }),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.validation.projectedNdcgAtK).toBe(0.9)
    })

    it('passes optional periodDays and k', async () => {
      const validateSpy = vi.spyOn(SearchEventAnalyzer.prototype, 'validateCategoryWeights').mockReturnValue(MOCK_VALIDATION as never)
      const app = createTestApp()
      await app.request('/api/scoring-evaluation/validate-weights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({
          jobDescriptionId: 'jd-1',
          proposedCategoryWeights: MOCK_CATEGORY_WEIGHTS,
          periodDays: 7,
          k: 5,
        }),
      })
      expect(validateSpy).toHaveBeenCalledWith({
        jobDescriptionId: 'jd-1',
        proposedCategoryWeights: MOCK_CATEGORY_WEIGHTS,
        periodDays: 7,
        k: 5,
      })
    })

    it('returns 500 when validation throws', async () => {
      vi.spyOn(SearchEventAnalyzer.prototype, 'validateCategoryWeights').mockImplementation(() => {
        throw new Error('No labeled data for jd-1')
      })
      const app = createTestApp()
      const response = await app.request('/api/scoring-evaluation/validate-weights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({
          jobDescriptionId: 'jd-1',
          proposedCategoryWeights: MOCK_CATEGORY_WEIGHTS,
        }),
      })
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('No labeled data for jd-1')
    })

    it('rejects missing required fields', async () => {
      const app = createTestApp()
      const response = await app.request('/api/scoring-evaluation/validate-weights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(400)
    })
  })

  describe('POST /api/scoring-evaluation/run-tuner', () => {
    it('returns auto-tune result', async () => {
      vi.spyOn(ScoringAutoTuner.prototype, 'run').mockResolvedValue(MOCK_TUNER_RESULT as never)
      const app = createTestApp()
      const response = await app.request('/api/scoring-evaluation/run-tuner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({ dryRun: true }),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.result).toBeDefined()
    })

    it('passes workspaceSlug from middleware context', async () => {
      const runSpy = vi.spyOn(ScoringAutoTuner.prototype, 'run').mockResolvedValue(MOCK_TUNER_RESULT as never)
      const app = createTestApp()
      await app.request('/api/scoring-evaluation/run-tuner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({}),
      })
      expect(runSpy).toHaveBeenCalledWith(expect.objectContaining({ workspaceSlug: 'dev' }))
    })

    it('passes all optional parameters', async () => {
      const runSpy = vi.spyOn(ScoringAutoTuner.prototype, 'run').mockResolvedValue(MOCK_TUNER_RESULT as never)
      const app = createTestApp()
      await app.request('/api/scoring-evaluation/run-tuner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({
          dryRun: true,
          periodDays: 30,
          k: 20,
          jobDescriptionId: 'jd-1',
          minLabeledActions: 10,
          ndcgImprovementThreshold: 0.05,
          reingestLimit: 100,
        }),
      })
      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          dryRun: true,
          periodDays: 30,
          k: 20,
          jobDescriptionId: 'jd-1',
          minLabeledActions: 10,
          ndcgImprovementThreshold: 0.05,
          reingestLimit: 100,
        }),
      )
    })

    it('returns 500 when tuner throws', async () => {
      vi.spyOn(ScoringAutoTuner.prototype, 'run').mockRejectedValue(new Error('Insufficient data'))
      const app = createTestApp()
      const response = await app.request('/api/scoring-evaluation/run-tuner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Insufficient data')
    })
  })

  describe('GET /api/scoring-evaluation/weight-history', () => {
    it('returns weight history items', async () => {
      vi.spyOn(WeightHistoryService.prototype, 'getHistory').mockReturnValue(MOCK_HISTORY_ITEMS as never)
      const app = createTestApp()
      const response = await app.request('/api/scoring-evaluation/weight-history', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.items).toHaveLength(2)
    })

    it('passes limit query param', async () => {
      const historySpy = vi.spyOn(WeightHistoryService.prototype, 'getHistory').mockReturnValue(MOCK_HISTORY_ITEMS as never)
      const app = createTestApp()
      await app.request('/api/scoring-evaluation/weight-history?limit=50', {
        headers: ADMIN_HEADERS,
      })
      expect(historySpy).toHaveBeenCalledWith(50)
    })

    it('defaults limit to 100 when not provided', async () => {
      const historySpy = vi.spyOn(WeightHistoryService.prototype, 'getHistory').mockReturnValue([] as never)
      const app = createTestApp()
      await app.request('/api/scoring-evaluation/weight-history', {
        headers: ADMIN_HEADERS,
      })
      expect(historySpy).toHaveBeenCalledWith(100)
    })

    it('returns empty items when no history', async () => {
      vi.spyOn(WeightHistoryService.prototype, 'getHistory').mockReturnValue([] as never)
      const app = createTestApp()
      const response = await app.request('/api/scoring-evaluation/weight-history', {
        headers: ADMIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.items).toHaveLength(0)
    })
  })

  describe('POST /api/scoring-evaluation/rollback', () => {
    const MOCK_ROLLBACK_RESULT = {
      restored: MOCK_HISTORY_ITEMS[0],
      rollbackEntry: {
        ts: '2026-05-22T11:00:00.000Z',
        reason: 'rollback:2026-05-22T10:00:00.000Z',
        jobDescriptionId: 'jd-1',
        before: { ...MOCK_CATEGORY_WEIGHTS, skillMatch: 25 },
        after: MOCK_CATEGORY_WEIGHTS,
        metrics: {},
      },
    }

    it('rolls back to a history entry', async () => {
      vi.spyOn(WeightHistoryService.prototype, 'rollback').mockResolvedValue(MOCK_ROLLBACK_RESULT as never)
      vi.spyOn(workspaceConfigService, 'getRuleWeights').mockResolvedValue({
        categoryWeights: MOCK_CATEGORY_WEIGHTS,
      } as never)
      const app = createTestApp()
      const response = await app.request('/api/scoring-evaluation/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({ entryTs: '2026-05-22T10:00:00.000Z' }),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.restored.ts).toBe('2026-05-22T10:00:00.000Z')
      expect(body.rollbackEntry.reason).toContain('rollback')
      expect(body.currentCategoryWeights).toEqual(MOCK_CATEGORY_WEIGHTS)
    })

    it('passes workspaceSlug to rollback', async () => {
      const rollbackSpy = vi.spyOn(WeightHistoryService.prototype, 'rollback').mockResolvedValue(MOCK_ROLLBACK_RESULT as never)
      vi.spyOn(workspaceConfigService, 'getRuleWeights').mockResolvedValue({
        categoryWeights: MOCK_CATEGORY_WEIGHTS,
      } as never)
      const app = createTestApp()
      await app.request('/api/scoring-evaluation/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({ entryTs: '2026-05-22T10:00:00.000Z' }),
      })
      expect(rollbackSpy).toHaveBeenCalledWith('2026-05-22T10:00:00.000Z', 'dev')
    })

    it('returns 500 when rollback throws', async () => {
      vi.spyOn(WeightHistoryService.prototype, 'rollback').mockRejectedValue(
        new Error('Weight history entry not found: missing-ts'),
      )
      const app = createTestApp()
      const response = await app.request('/api/scoring-evaluation/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({ entryTs: 'missing-ts' }),
      })
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.success).toBe(false)
      expect(body.error).toContain('not found')
    })

    it('rejects missing entryTs', async () => {
      const app = createTestApp()
      const response = await app.request('/api/scoring-evaluation/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(400)
    })
  })
})
