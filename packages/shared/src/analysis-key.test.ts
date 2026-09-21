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

  it('falls back to the prod-era source-only key when looking up with a locale (old prod blobs must survive clone+upgrade)', () => {
    // Prod-era blobs were written without the locale segment. A newer lookup
    // (source+locale) must still reach them, so the source-only key must appear
    // in the lookup list, after the locale-first key.
    const prodEraKey = 'source:51job|analysis:keyword-search:2:4dc6f7f9'
    const keys = buildResumeAnalysisLookupKeys(undefined, KEYWORDS, { location: 'China', promptVersion: 14, sourceKey: '51job', locale: 'zh-Hans' })
    // Keyword lookups probe prompt versions current→1, so the list is longer
    // than three keys; the v14 contract keys must be the FIRST three, in the
    // established order (locale-first, prod-era source-only, bare).
    expect(keys.slice(0, 3)).toEqual([
      STORAGE_KEY,
      prodEraKey,
      'keyword-search:2:4dc6f7f9',
    ])
    expect(keys).toContain(prodEraKey)
  })

  it('dedupes the source-only and locale-first keys when locale is omitted', () => {
    // Without a locale, source+locale and source-only collapse to the same key;
    // it must appear exactly once, ahead of the bare keyword key — per prompt
    // version. The v14 pair is the first two entries of the probed list.
    const keys = buildResumeAnalysisLookupKeys(undefined, KEYWORDS, { location: 'China', promptVersion: 14, sourceKey: '51job' })
    expect(keys.slice(0, 2)).toEqual([
      'source:51job|analysis:keyword-search:2:4dc6f7f9',
      'keyword-search:2:4dc6f7f9',
    ])
  })

  it('probes older prompt-version keyword ids so cloned blobs from prior prompt eras stay reachable', () => {
    // A prompt bump renames the keyword-search id hash. A clone of a deployment
    // written under an older prompt must still display after upgrade: the
    // lookup now probes current→1 and concatenates each version's keys with the
    // current version first, so a v14 blob wins over a v13 sibling.
    const keywords = ['CNC', '销售']
    const options = { location: 'China', promptVersion: 14, sourceKey: '51job', locale: 'zh-Hans' }
    const keys = buildResumeAnalysisLookupKeys(undefined, keywords, options)

    // v14 (current) keys lead the list, in the established per-id order.
    expect(keys.slice(0, 3)).toEqual([
      'source:51job|locale:zh-hans|analysis:keyword-search:2:ad34baf8',
      'source:51job|analysis:keyword-search:2:ad34baf8',
      'keyword-search:2:ad34baf8',
    ])

    // Older prompt eras remain reachable: v13, v11, v10 ids each appear in
    // locale + source-only (+ bare) form, in descending-version order.
    expect(keys).toEqual(expect.arrayContaining([
      'source:51job|locale:zh-hans|analysis:keyword-search:2:b434c5fd',
      'source:51job|analysis:keyword-search:2:b434c5fd',
      'keyword-search:2:b434c5fd',
      'source:51job|locale:zh-hans|analysis:keyword-search:2:b234c2d7',
      'source:51job|analysis:keyword-search:2:b234c2d7',
      'keyword-search:2:b234c2d7',
      'source:51job|locale:zh-hans|analysis:keyword-search:2:b134c144',
      'source:51job|analysis:keyword-search:2:b134c144',
      'keyword-search:2:b134c144',
    ]))

    // Descending version order: every v14 key precedes every v13 key, and the
    // v13 keys precede v11/v10 — a current blob always wins the first-match probe.
    const v14Keys = keys.slice(0, 3)
    const v13Index = keys.indexOf('keyword-search:2:b434c5fd')
    const v11Index = keys.indexOf('keyword-search:2:b234c2d7')
    const v10Index = keys.indexOf('keyword-search:2:b134c144')
    expect(v13Index).toBeGreaterThan(2)
    expect(v11Index).toBeGreaterThan(v13Index)
    expect(v10Index).toBeGreaterThan(v11Index)
    expect(v14Keys.every((key) => keys.indexOf(key) < v13Index)).toBe(true)
  })
})

