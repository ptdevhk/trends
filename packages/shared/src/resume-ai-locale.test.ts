import { describe, expect, it, vi } from 'vitest'

vi.mock('./generated/resume-ai-prompts.js', () => ({
  resolveResumeAiPromptLocale: (locale?: string) => ({
    resolvedSourceLocale: locale === 'en' ? 'en' : 'zh-Hans',
  }),
}))

import { getResumeAiLocaleText } from './resume-ai-locale'

describe('getResumeAiLocaleText', () => {
  it('returns Chinese text by default', () => {
    const text = getResumeAiLocaleText()
    expect(text.noneLabel).toBe('无')
    expect(text.yearsUnitSuffix).toBe('年')
  })

  it('returns Chinese text for zh-Hans', () => {
    const text = getResumeAiLocaleText('zh-Hans')
    expect(text.noneLabel).toBe('无')
  })

  it('returns English text for en', () => {
    const text = getResumeAiLocaleText('en')
    expect(text.noneLabel).toBe('none')
    expect(text.yearsUnitSuffix).toBe(' years')
  })

  it('provides all required locale fields', () => {
    const text = getResumeAiLocaleText('en')
    const keys: (keyof typeof text)[] = [
      'noneLabel', 'emptyFieldLabel', 'noWorkHistoryLabel', 'yearsUnitSuffix',
      'verifiedLabel', 'unverifiedLabel', 'signalsLabel', 'indirectRoleLabel',
      'serviceUnavailableSummary', 'analysisErrorSummary', 'analysisErrorConcernPrefix',
      'noAnalysisResult', 'parseErrorConcern', 'parseErrorSummary',
    ]
    for (const key of keys) {
      expect(typeof text[key]).toBe('string')
      expect(text[key].length).toBeGreaterThan(0)
    }
  })
})
