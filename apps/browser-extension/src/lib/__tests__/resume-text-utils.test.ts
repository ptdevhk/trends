import { describe, expect, it } from 'vitest'

import {
  buildWorkHistoryRawParts,
  normalizeResumeMultilineText,
  normalizeResumeText,
  stripHtmlTags,
} from '../resume-text-utils'

describe('resume-text-utils', () => {
  it('normalizes single-line resume text whitespace', () => {
    expect(normalizeResumeText('  张先生　 销售经理  ')).toBe('张先生 销售经理')
  })

  it('returns an empty string for non-string resume text values', () => {
    expect(normalizeResumeText(null)).toBe('')
    expect(normalizeResumeText(18)).toBe('')
  })

  it('strips html tags while preserving visible text', () => {
    expect(stripHtmlTags('<p>负责<b>区域</b>客户</p>')).toBe(' 负责 区域 客户 ')
  })

  it('returns an empty string for non-string html inputs', () => {
    expect(stripHtmlTags(undefined)).toBe('')
  })

  it('normalizes multiline text and removes blank lines', () => {
    expect(normalizeResumeMultilineText('  第一行\r\n\r\n第二行\t　内容  ')).toBe(
      '第一行\n第二行 内容',
    )
  })

  it('returns an empty string for non-string multiline inputs', () => {
    expect(normalizeResumeMultilineText({})).toBe('')
  })

  it('builds a raw work-history string from truthy parts', () => {
    expect(
      buildWorkHistoryRawParts(['2021-03~至今', '(3年)', '苏州德扬数控机械有限公司', '销售工程师']),
    ).toBe('2021-03~至今 · (3年) · 苏州德扬数控机械有限公司 · 销售工程师')
  })

  it('drops empty work-history parts when joining', () => {
    expect(buildWorkHistoryRawParts(['', null, '销售工程师', undefined, '工业自动化'])).toBe(
      '销售工程师 · 工业自动化',
    )
  })
})
