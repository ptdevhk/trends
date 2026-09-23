import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  extractThumbFromHtml,
  isImageUrl,
  fetchThumbsForUrls,
  fetchArticleThumb,
} from './daily-report-thumb-fetch'

describe('extractThumbFromHtml', () => {
  it('returns an ordered candidate list, og:image first', () => {
    const html =
      '<html><head><meta property="og:image" content="https://cdn.example.com/cover.jpg"></head>' +
      '<body><img src="https://cdn.example.com/photo1.jpg"><img src="https://cdn.example.com/photo2.jpg"></body></html>'
    expect(extractThumbFromHtml(html, 'https://example.com/x')).toEqual([
      'https://cdn.example.com/cover.jpg',
      'https://cdn.example.com/photo1.jpg',
      'https://cdn.example.com/photo2.jpg',
    ])
  })

  it('matches og:image:secure_url and og:image:url (not just og:image)', () => {
    const html =
      '<meta property="og:image:secure_url" content="https://cdn.example.com/s.jpg">' +
      '<meta property="og:image:url" content="https://cdn.example.com/u.jpg">'
    // secure_url comes first in document order
    expect(extractThumbFromHtml(html, 'https://example.com/x')[0]).toBe(
      'https://cdn.example.com/s.jpg',
    )
  })

  it('matches twitter:image', () => {
    const html = '<meta name="twitter:image" content="https://cdn.example.com/t.jpg">'
    expect(extractThumbFromHtml(html, 'https://example.com/x')).toEqual([
      'https://cdn.example.com/t.jpg',
    ])
  })

  it('resolves a relative og:image against the base', () => {
    const html = '<meta property="og:image" content="/img/cover.png">'
    expect(extractThumbFromHtml(html, 'https://example.com/article')).toEqual([
      'https://example.com/img/cover.png',
    ])
  })

  it('upgrades plain-http candidate to https (mixed-content safe)', () => {
    const html = '<meta property="og:image" content="http://i.ce.cn/district/images/item.png">'
    expect(extractThumbFromHtml(html, 'https://example.com/x')).toEqual([
      'https://i.ce.cn/district/images/item.png',
    ])
  })

  it('resolves scheme-relative // CDN og:image against the base scheme', () => {
    const html = '<meta property="og:image" content="//n.sinaimg.cn/spider/a.png">'
    expect(extractThumbFromHtml(html, 'https://finance.sina.com.cn/x')).toEqual([
      'https://n.sinaimg.cn/spider/a.png',
    ])
  })

  it('skips site-chrome og:image (logo / wx poster) but keeps the body cover', () => {
    const html =
      '<meta property="og:image" content="https://n.sinaimg.cn/finance/wx_poster_finance1.png">' +
      '<img src="https://n.sinaimg.cn/photo/actual-cover-12345.png">'
    const out = extractThumbFromHtml(html, 'https://finance.sina.com.cn/x')
    expect(out.some((u) => u.includes('wx_poster'))).toBe(false)
    expect(out[0]).toBe('https://n.sinaimg.cn/photo/actual-cover-12345.png')
  })

  it('skips site-chrome body imgs (login placeholder, share, language) and reaches the real photo', () => {
    // people.cn-like page: no og:image, chrome first, real article photo deep in the body.
    const html =
      '<img src="/img/2016people/images/shoujidenglu.jpg">' +
      '<img src="/img/MAIN/logo.png">' +
      '<img src="/img/MAIN/share.png">' +
      '<img src="https://paper.people.com.cn/pic/cover-20260822.jpg">'
    const out = extractThumbFromHtml(html, 'https://cpc.people.com.cn/n1/2026/0822/x.html')
    expect(out).toContain('https://paper.people.com.cn/pic/cover-20260822.jpg')
    expect(out.some((u) => u.includes('shoujidenglu'))).toBe(false)
  })

  it('dedupes candidates', () => {
    const html =
      '<meta property="og:image" content="https://cdn.example.com/cover.jpg">' +
      '<img src="https://cdn.example.com/cover.jpg">'
    expect(extractThumbFromHtml(html, 'https://example.com/x')).toEqual([
      'https://cdn.example.com/cover.jpg',
    ])
  })

  it('returns empty array when no usable image exists', () => {
    expect(extractThumbFromHtml('<div>no image</div>', 'https://example.com/x')).toEqual([])
    expect(extractThumbFromHtml('', 'https://example.com/x')).toEqual([])
  })

  it('drops short placeholder srcs and data: markers', () => {
    const html =
      '<img src="/s/">' +
      '<img src="data:image/gif;base64,R0lGOD">' +
      '<img src="https://cdn.example.com/real.jpg">'
    const out = extractThumbFromHtml(html, 'https://example.com/x')
    expect(out).toEqual(['https://cdn.example.com/real.jpg'])
  })
})

describe('isImageUrl', () => {
  // Minimal valid 400x260 PNG header (IHDR) — a plausible cover size.
  const bigPng = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000190000001040806000000' +
      'f8f8f8f80000000049454e44ae426082',
    'hex',
  )
  it('accepts a raster image content-type that is a plausible cover size', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const method = (init && init.method) || 'GET'
        if (method === 'HEAD') return new Response('', { headers: { 'content-type': 'image/jpeg' } })
        return new Response(bigPng, { headers: { 'content-type': 'image/jpeg' } })
      }),
    )
    await expect(isImageUrl('https://example.com/a.jpg')).resolves.toBe(true)
    vi.unstubAllGlobals()
  })
  it('rejects a raster content-type whose image is too small (chrome-scale)', async () => {
    const tinyPng = Buffer.from(
      '89504e470d0a1a0a0000000d4948445200000008000000080806000000' +
        'c47d7d8d0000000049454e44ae426082',
      'hex',
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        const method = (init && init.method) || 'GET'
        if (method === 'HEAD') return new Response('', { headers: { 'content-type': 'image/png' } })
        return new Response(tinyPng, { headers: { 'content-type': 'image/png' } })
      }),
    )
    await expect(isImageUrl('https://example.com/icon.png')).resolves.toBe(false)
    vi.unstubAllGlobals()
  })
  it('rejects non-http', async () => {
    await expect(isImageUrl('data:image/svg+xml,x')).resolves.toBe(false)
  })
  it('rejects svg / gif / icon content-types even when image/*', async () => {
    for (const ct of ['image/svg+xml', 'image/gif', 'image/x-icon']) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { headers: { 'content-type': ct } })))
      await expect(isImageUrl('https://example.com/x')).resolves.toBe(false)
      vi.unstubAllGlobals()
    }
  })
  it('rejects non-image content-type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { headers: { 'content-type': 'text/html' } })))
    await expect(isImageUrl('https://example.com/a')).resolves.toBe(false)
    vi.unstubAllGlobals()
  })
})

describe('fetchArticleThumb', () => {
  // A minimal valid 8x8 PNG (IHDR) — too small to be an article cover.
  const tinyPng = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000008000000080806000000' +
      'c47d7d8d0000000049454e44ae426082',
    'hex',
  )
  // A minimal valid 400x260 PNG (IHDR) — a plausible real cover.
  const bigPng = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000190000001040806000000' +
      'f8f8f8f80000000049454e44ae426082',
    'hex',
  )

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('')))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the first clean raster candidate that is big enough (skips a tiny icon that sorts first)', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('article')) {
        return new Response(
          '<html><body><img src="https://cdn.example.com/icons/s.png">' +
            '<img src="https://cdn.example.com/cover.jpg"></body></html>',
          { headers: { 'content-type': 'text/html' } },
        )
      }
      if (url.includes('icons/')) return new Response(tinyPng, { headers: { 'content-type': 'image/png' } })
      return new Response(bigPng, { headers: { 'content-type': 'image/png' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const thumb = await fetchArticleThumb('https://example.com/article/1')
    expect(thumb).toBe('https://cdn.example.com/cover.jpg')
  })

  it('returns null when only tiny chrome images exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input)
        if (url.includes('article')) {
          return new Response('<img src="https://cdn.example.com/s.png">', {
            headers: { 'content-type': 'text/html' },
          })
        }
        return new Response(tinyPng, { headers: { 'content-type': 'image/png' } })
      }),
    )
    await expect(fetchArticleThumb('https://example.com/article/2')).resolves.toBeNull()
  })

  it('returns null on a non-HTML page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('PNGDATA', { headers: { 'content-type': 'image/png' } })),
    )
    await expect(fetchArticleThumb('https://example.com/img.png')).resolves.toBeNull()
  })

  it('returns null on network timeout / failure (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
    await expect(fetchArticleThumb('https://example.com/article/3')).resolves.toBeNull()
  })
})

describe('fetchThumbsForUrls', () => {
  it('returns a map subset and never throws on flaky targets', async () => {
    const out = await fetchThumbsForUrls(
      ['https://example.com/a', 'https://example.com/b', 'not-a-url'],
      2,
      1,
    )
    expect(out).toBeInstanceOf(Map)
  })
})
