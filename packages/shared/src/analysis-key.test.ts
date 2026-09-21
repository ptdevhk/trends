import { describe, expect, it } from 'vitest'
import {
  isSalesRequiredContext,
  getCurrentResumeAiPromptVersion,
  buildKeywordAnalysisId,
  normalizeResumeAnalysisSourceKey,
  buildResumeAnalysisLookupKeys,
  isResumeAnalysisKeyForJobDescription,
  buildResumeAnalysisStorageKey,
} from './analysis-key'

describe('isSalesRequiredContext', () => {
  it('detects English sales keyword', () => {
    expect(isSalesRequiredContext('Worked as sales engineer')).toBe(true)
  })

  it('detects Chinese sales keyword', () => {
    expect(isSalesRequiredContext('担任销售工程师')).toBe(true)
  })

  it('detects BD keyword', () => {
    expect(isSalesRequiredContext('business development manager')).toBe(true)
  })

  it('returns false for unrelated text', () => {
    expect(isSalesRequiredContext('Software engineer at Google')).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isSalesRequiredContext(undefined)).toBe(false)
  })

  it('detects across multiple text arguments', () => {
    expect(isSalesRequiredContext('Software engineer', 'Sales manager')).toBe(true)
  })

  it('handles empty inputs', () => {
    expect(isSalesRequiredContext()).toBe(false)
  })

  it('detects account manager', () => {
    expect(isSalesRequiredContext('Account Manager')).toBe(true)
  })

  it('detects channel sales', () => {
    expect(isSalesRequiredContext('Channel Sales Manager')).toBe(true)
  })
})

describe('getCurrentResumeAiPromptVersion', () => {
  it('returns a positive number', () => {
    const version = getCurrentResumeAiPromptVersion()
    expect(typeof version).toBe('number')
    expect(version).toBeGreaterThan(0)
  })
})

describe('resume AI prompt source contract', () => {
  it('locks prompt version at 14 and enforces screeningChecklist contract across all sources', async () => {
    const { RESUME_AI_PROMPT_SOURCES, RESUME_AI_PROMPT_LOCALES } = await import('./generated/resume-ai-prompts.js')
    const checklistKeys = [
      'sellsMachines',
      'machineOrigin',
      'channel',
      'region',
      'contactStatus',
    ]

    expect(RESUME_AI_PROMPT_LOCALES.length).toBeGreaterThan(0)

    for (const locale of RESUME_AI_PROMPT_LOCALES) {
      const source = RESUME_AI_PROMPT_SOURCES[locale]
      expect(source.metadata.version).toBe(14)
      expect(source.sections.outputContract).toContain('screeningChecklist')
      for (const key of checklistKeys) {
        expect(source.sections.outputContract).toContain(key)
      }
    }
  })
})

describe('buildKeywordAnalysisId', () => {
  it('returns the literal keyword-search for empty or whitespace-only keywords', () => {
    expect(buildKeywordAnalysisId([])).toBe('keyword-search')
    expect(buildKeywordAnalysisId(['', '  '])).toBe('keyword-search')
    expect(buildKeywordAnalysisId(['\t', '\n'])).toBe('keyword-search')
  })
})

describe('normalizeResumeAnalysisSourceKey', () => {
  it('returns undefined for empty, whitespace, and unknown tokens', () => {
    expect(normalizeResumeAnalysisSourceKey('')).toBeUndefined()
    expect(normalizeResumeAnalysisSourceKey('   ')).toBeUndefined()
    expect(normalizeResumeAnalysisSourceKey('\t\n')).toBeUndefined()
    expect(normalizeResumeAnalysisSourceKey(null)).toBeUndefined()
    expect(normalizeResumeAnalysisSourceKey(undefined)).toBeUndefined()
    expect(normalizeResumeAnalysisSourceKey('linkedin')).toBeUndefined()
    expect(normalizeResumeAnalysisSourceKey('unknown')).toBeUndefined()
  })
})

describe('buildResumeAnalysisLookupKeys', () => {
  it('returns an empty list when jobDescriptionId is missing and keywords are empty', () => {
    expect(buildResumeAnalysisLookupKeys(undefined, [])).toEqual([])
    expect(buildResumeAnalysisLookupKeys('', [])).toEqual([])
  })
})

describe('isResumeAnalysisKeyForJobDescription', () => {
  it('matches only the default key when jobDescriptionId is empty or undefined', () => {
    expect(isResumeAnalysisKeyForJobDescription('default', undefined)).toBe(true)
    expect(isResumeAnalysisKeyForJobDescription('default', '')).toBe(true)
    expect(isResumeAnalysisKeyForJobDescription('other-jd', undefined)).toBe(false)
    expect(isResumeAnalysisKeyForJobDescription('other-jd', '')).toBe(false)
  })
})

describe('buildResumeAnalysisStorageKey', () => {
  it('returns the jobDescriptionId when sourceKey and locale are missing', () => {
    expect(buildResumeAnalysisStorageKey('jd-123')).toBe('jd-123')
    expect(buildResumeAnalysisStorageKey('jd-123', {})).toBe('jd-123')
    expect(buildResumeAnalysisStorageKey('jd-123', { sourceKey: '', locale: '' })).toBe('jd-123')
  })
})

describe('preview CMM v14 keyword analysis storage contract', () => {
  const KEYWORDS = ['三坐标', '3D扫描']
  const KEYWORD_ID = 'keyword-search:2:4dc6f7f9'
  const STORAGE_KEY = 'source:51job|locale:zh-hans|analysis:keyword-search:2:4dc6f7f9'

  it('locks the keyword-search id for the CMM v14 prompt with location China', () => {
    expect(buildKeywordAnalysisId(KEYWORDS, { location: 'China', promptVersion: 14 })).toBe(KEYWORD_ID)
  })

  it('produces the same id for trimmed/case-folded location variants', () => {
    expect(buildKeywordAnalysisId(KEYWORDS, { location: 'china', promptVersion: 14 })).toBe(KEYWORD_ID)
    expect(buildKeywordAnalysisId(KEYWORDS, { location: 'China ', promptVersion: 14 })).toBe(KEYWORD_ID)
  })

  it('produces a different id when location is omitted', () => {
    expect(buildKeywordAnalysisId(KEYWORDS, { promptVersion: 14 })).not.toBe(KEYWORD_ID)
  })

  it('produces a different id for the zh location 中国', () => {
    expect(buildKeywordAnalysisId(KEYWORDS, { location: '中国', promptVersion: 14 })).not.toBe(KEYWORD_ID)
  })

  it('produces a different id when keywords include 销售', () => {
    expect(buildKeywordAnalysisId([...KEYWORDS, '销售'], { location: 'China', promptVersion: 14 })).not.toBe(KEYWORD_ID)
  })

  it('builds the source+locale storage key for a 51job zh-Hans row', () => {
    expect(buildResumeAnalysisStorageKey(KEYWORD_ID, { sourceKey: '51job', locale: 'zh-Hans' })).toBe(STORAGE_KEY)
  })

  it('does not emit the storage key in lookup keys when locale is omitted', () => {
    const keys = buildResumeAnalysisLookupKeys(undefined, KEYWORDS, { location: 'China', promptVersion: 14, sourceKey: '51job' })
    expect(keys).not.toContain(STORAGE_KEY)
  })

  it('emits the storage key in lookup keys when locale zh-Hans is supplied', () => {
    const keys = buildResumeAnalysisLookupKeys(undefined, KEYWORDS, { location: 'China', promptVersion: 14, sourceKey: '51job', locale: 'zh-Hans' })
    expect(keys).toContain(STORAGE_KEY)
    expect(keys[0]).toBe(STORAGE_KEY)
  })
})

