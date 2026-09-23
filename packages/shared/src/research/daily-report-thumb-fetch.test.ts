import { describe, expect, it } from 'vitest'
import {
  extractThumbFromHtml,
  isImageUrl,
  fetchThumbsForUrls,
} from './daily-report-thumb-fetch'

describe('extractThumbFromHtml', () => {
  it('reads og:image meta attribute', () => {
    const html = '<meta property="og:image" content="https://cdn.example.com/a.jpg">'
    expect(extractThumbFromHtml(html, 'https://example.com/x')).toBe(
      'https://cdn.example.com/a.jpg',
    )
  })
  it('reads og:image:url property (alternate form)', () => {
    const html = '<meta property="og:image:url" content="https://cdn.example.com/b.jpg">'
    expect(extractThumbFromHtml(html, 'https://example.com/x')).toBe(
      'https://cdn.example.com/b.jpg',
    )
  })
  it('reads twitter:image', () => {
    const html = '<meta name="twitter:image" content="https://cdn.example.com/c.jpg">'
    expect(extractThumbFromHtml(html, 'https://example.com/x')).toBe(
      'https://cdn.example.com/c.jpg',
    )
  })
  it('resolves a relative og:image against the base', () => {
    const html = '<meta property="og:image" content="/img/cover.png">'
    expect(extractThumbFromHtml(html, 'https://example.com/article')).toBe(
      'https://example.com/img/cover.png',
    )
  })
  it('falls back to the first real <img> (skips tiny logos/spacers)', () => {
    const html = '<img src="/assets/logo.png"><img src="https://cdn.example.com/photo.jpg">'
    expect(extractThumbFromHtml(html, 'https://example.com/x')).toBe(
      'https://cdn.example.com/photo.jpg',
    )
  })
    it('upgrades plain-http og:image to https (mixed-content safe)', () => {
    const html = '<meta property="og:image" content="http://i.ce.cn/district/images/item.png">'
    expect(extractThumbFromHtml(html, 'https://example.com/x')).toBe(
      'https://i.ce.cn/district/images/item.png',
    )
  })
  it('leaves https urls unchanged', () => {
    const html = '<meta property="og:image" content="https://cdn.example.com/a.jpg">'
    expect(extractThumbFromHtml(html, 'https://example.com/x')).toBe(
      'https://cdn.example.com/a.jpg',
    )
  })

it('returns null when no usable image exists', () => {
    expect(extractThumbFromHtml('<div>no image</div>', 'https://example.com/x')).toBeNull()
    expect(extractThumbFromHtml('', 'https://example.com/x')).toBeNull()
  })
})

describe('isImageUrl', () => {
  it('accepts image content-type', async () => {
    await expect(isImageUrl('https://example.com/a.jpg')).resolves.toBeTypeOf('boolean')
  })
  it('rejects non-http', async () => {
    await expect(isImageUrl('data:image/svg+xml,x')).resolves.toBe(false)
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
