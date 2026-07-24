import { describe, expect, it } from 'vitest'

import { CURRENT_INGEST_COMPUTE_EPOCH, getCurrentResumeAiPromptVersion } from '@trends/shared'

import { CURRENT_RESUME_SKILLS_VERSION, resolveResumeRefreshState } from './resume-freshness'

function createResume(overrides: Record<string, unknown> = {}) {
  return {
    ingestData: {
      computedAt: 1_700_000_000_000,
      skillsVersion: CURRENT_RESUME_SKILLS_VERSION,
      ingestComputeEpoch: CURRENT_INGEST_COMPUTE_EPOCH,
    },
    analyses: {},
    ...overrides,
  }
}

describe('resume-freshness', () => {
  it('marks ingest stale when the stored skills version lags current', () => {
    const refreshState = resolveResumeRefreshState({
      resume: createResume({
        ingestData: {
          computedAt: 1_700_000_000_000,
          skillsVersion: CURRENT_RESUME_SKILLS_VERSION - 1,
          ingestComputeEpoch: CURRENT_INGEST_COMPUTE_EPOCH,
        },
      }),
    })

    expect(refreshState.ingestStale).toBe(true)
    expect(refreshState.analysisStale).toBe(false)
    expect(refreshState.kind).toBe('ingest_stale')
  })

  it('marks ingest stale when ingestComputeEpoch is missing even if skillsVersion is current', () => {
    const refreshState = resolveResumeRefreshState({
      resume: createResume({
        ingestData: {
          computedAt: 1_700_000_000_000,
          skillsVersion: CURRENT_RESUME_SKILLS_VERSION,
        },
      }),
    })

    expect(refreshState.ingestStale).toBe(true)
    expect(refreshState.kind).toBe('ingest_stale')
  })

  it('marks JD analysis stale when the stored prompt version lags current', () => {
    const currentPromptVersion = getCurrentResumeAiPromptVersion()
    const refreshState = resolveResumeRefreshState({
      resume: createResume({
        analyses: {
          'source:seek|analysis:jd-123': {
            jobDescriptionId: 'jd-123',
            promptVersion: currentPromptVersion - 1,
            analyzedAt: 1_700_000_000_100,
            score: 81,
            summary: 'Stale analysis',
            highlights: [],
            recommendation: 'match',
          },
        },
      }),
      analysisContext: {
        jobDescriptionId: 'jd-123',
        sourceKey: 'seek',
      },
    })

    expect(refreshState.ingestStale).toBe(false)
    expect(refreshState.analysisStale).toBe(true)
    expect(refreshState.kind).toBe('analysis_stale')
  })

  it('marks analysis stale when the stored analysis is older than the latest ingest compute', () => {
    const currentPromptVersion = getCurrentResumeAiPromptVersion()
    const refreshState = resolveResumeRefreshState({
      resume: createResume({
        ingestData: {
          computedAt: 1_700_000_000_500,
          skillsVersion: CURRENT_RESUME_SKILLS_VERSION,
          ingestComputeEpoch: CURRENT_INGEST_COMPUTE_EPOCH,
        },
        analyses: {
          'source:seek|analysis:jd-123': {
            jobDescriptionId: 'jd-123',
            promptVersion: currentPromptVersion,
            analyzedAt: 1_700_000_000_100,
            score: 81,
            summary: 'Older than ingest',
            highlights: [],
            recommendation: 'match',
          },
        },
      }),
      analysisContext: {
        jobDescriptionId: 'jd-123',
        sourceKey: 'seek',
      },
    })

    expect(refreshState.ingestStale).toBe(false)
    expect(refreshState.analysisStale).toBe(true)
    expect(refreshState.kind).toBe('analysis_stale')
  })

  it('does not treat a missing current-context analysis as stale', () => {
    const refreshState = resolveResumeRefreshState({
      resume: createResume(),
      analysisContext: {
        jobDescriptionId: 'jd-123',
        sourceKey: 'seek',
      },
    })

    expect(refreshState.ingestStale).toBe(false)
    expect(refreshState.analysisStale).toBe(false)
    expect(refreshState.kind).toBe('fresh')
  })

  it('marks both stale when ingest and analysis freshness both lag', () => {
    const currentPromptVersion = getCurrentResumeAiPromptVersion()
    const refreshState = resolveResumeRefreshState({
      resume: createResume({
        ingestData: {
          computedAt: 1_700_000_000_500,
          skillsVersion: CURRENT_RESUME_SKILLS_VERSION - 1,
          ingestComputeEpoch: CURRENT_INGEST_COMPUTE_EPOCH - 1,
        },
        analyses: {
          'source:seek|analysis:jd-123': {
            jobDescriptionId: 'jd-123',
            promptVersion: currentPromptVersion - 1,
            analyzedAt: 1_700_000_000_100,
            score: 81,
            summary: 'Old everywhere',
            highlights: [],
            recommendation: 'match',
          },
        },
      }),
      analysisContext: {
        jobDescriptionId: 'jd-123',
        sourceKey: 'seek',
      },
    })

    expect(refreshState.ingestStale).toBe(true)
    expect(refreshState.analysisStale).toBe(true)
    expect(refreshState.kind).toBe('both_stale')
  })
})
