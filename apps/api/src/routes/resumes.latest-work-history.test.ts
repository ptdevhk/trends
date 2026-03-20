import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveResumeFieldUsagePolicy } from '@trends/shared'

import { createApp } from '../app'
import { AIMatchingService } from '../services/ai-matching'
import { MatchStorage } from '../services/match-storage'
import { ResumeService } from '../services/resume-service'
import { workspaceConfigService } from '../services/workspace-config-service'

describe('resume routes latest work history', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes only the latest three work history entries to AI matching payloads', async () => {
    const matchBatchSpy = vi.spyOn(AIMatchingService.prototype, 'matchBatch').mockResolvedValue({
      results: [{
        resumeId: 'resume-latest-3-test',
        result: {
          score: 80,
          recommendation: 'match',
          highlights: [],
          concerns: [],
          summary: 'Good fit',
          scoreSource: 'ai',
        },
      }],
      processedCount: 1,
      failedCount: 0,
      processingTimeMs: 1,
    })
    vi.spyOn(AIMatchingService.prototype, 'getServiceInfo').mockReturnValue({
      enabled: true,
      resumesEnabled: true,
      model: 'test-model',
      apiBase: 'https://example.com',
      apiKeyMasked: '***',
      concurrency: 1,
    })
    vi.spyOn(workspaceConfigService, 'getResumeFieldUsagePolicy').mockResolvedValue(resolveResumeFieldUsagePolicy())
    vi.spyOn(MatchStorage.prototype, 'getMatchesByResumeIds').mockReturnValue([])
    vi.spyOn(MatchStorage.prototype, 'saveMatches').mockImplementation(() => {})

    const loadSampleSpy = vi.spyOn(ResumeService.prototype, 'loadSample').mockReturnValue({
      items: [{
        name: 'Alice',
        profileUrl: 'https://example.com/resume-1',
        activityStatus: 'Active',
        age: '30',
        experience: '5 years',
        education: 'Bachelor',
        location: 'Dongguan',
        selfIntro: 'Intro',
        jobIntention: 'Sales Engineer',
        expectedSalary: '10k-20k',
        workHistory: [
          { raw: 'Oldest entry', companyName: 'Oldest Co', jobTitle: 'Old Role', startDate: '2018-01', endDate: '2019-01' },
          { raw: 'Recent entry', companyName: 'Recent Co', jobTitle: 'Recent Role', startDate: '2023-01', endDate: '2024-01' },
          { raw: 'Current entry', companyName: 'Current Co', jobTitle: 'Current Role', startDate: '2024-02', endDate: '至今' },
          { raw: 'Middle entry', companyName: 'Middle Co', jobTitle: 'Middle Role', startDate: '2021-01', endDate: '2022-01' },
        ],
        extractedAt: '2026-03-13T00:00:00.000Z',
        resumeId: 'resume-latest-3-test',
      }],
      sample: {
        name: 'sample',
        filename: 'sample.json',
        updatedAt: '2026-03-13T00:00:00.000Z',
        size: 1,
      },
      indexes: new Map(),
    })

    const app = createApp()
    const response = await app.request('/api/resumes/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'sample',
        persist: true,
        mode: 'ai_only',
        keywords: ['CNC', '销售'],
        sample: 'sample',
      }),
    })

    expect(response.status).toBe(200)
    expect(loadSampleSpy).toHaveBeenCalled()
    expect(matchBatchSpy).toHaveBeenCalledTimes(1)
    const resumesArg = matchBatchSpy.mock.calls[0]?.[0]
    expect(resumesArg).toHaveLength(1)
    expect(resumesArg[0]).toEqual(expect.objectContaining({
      companies: ['Current Co', 'Recent Co', 'Middle Co'],
      workHistory: [
        '2024-02 ~ 至今 Current Co Current Role',
        '2023-01 ~ 2024-01 Recent Co Recent Role',
        '2021-01 ~ 2022-01 Middle Co Middle Role',
      ].join('\n'),
    }))
    expect(resumesArg[0]).not.toHaveProperty('selfIntro')
    expect(resumesArg[0]).not.toHaveProperty('jobIntention')
    expect(resumesArg[0].workHistory).not.toContain('Oldest Co')
  })
})
