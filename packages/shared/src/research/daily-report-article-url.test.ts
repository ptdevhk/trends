import { describe, expect, it } from 'vitest'
import {
  googleNewsArticleId,
  isGoogleNewsArticleUrl,
  parseGarturlresResponse,
  preferHttpsArticleUrl,
} from './daily-report-article-url.js'

describe('isGoogleNewsArticleUrl', () => {
  it('detects news.google.com/rss/articles/…', () => {
    expect(
      isGoogleNewsArticleUrl(
        'https://news.google.com/rss/articles/CBMid0FVX3lxTE54WGJs?oc=5',
      ),
    ).toBe(true)
  })

  it('rejects publisher URLs', () => {
    expect(isGoogleNewsArticleUrl('https://finance.ce.cn/stock/a.shtml')).toBe(false)
    expect(isGoogleNewsArticleUrl('https://www.thepaper.cn/newsDetail_forward_1')).toBe(false)
  })
})

describe('googleNewsArticleId', () => {
  it('extracts CBMi id', () => {
    expect(
      googleNewsArticleId(
        'https://news.google.com/rss/articles/CBMid0FVX3lxTE54WGJsSFFQ?oc=5',
      ),
    ).toBe('CBMid0FVX3lxTE54WGJsSFFQ')
  })
})

describe('parseGarturlresResponse', () => {
  it('extracts publisher URL from batchexecute wrapper', () => {
    const body = `)]}'

[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"http://finance.ce.cn/stock/gsgdbd/202302/16/t20230216_38395893.shtml\\",1]",null,null,null,""],["di",16]]`
    expect(parseGarturlresResponse(body)).toBe(
      'http://finance.ce.cn/stock/gsgdbd/202302/16/t20230216_38395893.shtml',
    )
  })

  it('returns null when Fbv4je payload missing', () => {
    expect(parseGarturlresResponse(`)]}'\n\n[["wrb.fr","Fbv4je",null]]`)).toBeNull()
  })
})

describe('preferHttpsArticleUrl', () => {
  it('upgrades http → https', () => {
    expect(preferHttpsArticleUrl('http://finance.ce.cn/a.shtml')).toBe(
      'https://finance.ce.cn/a.shtml',
    )
  })
})
