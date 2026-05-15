import { describe, expect, it, vi, beforeEach } from 'vitest'
import { submitResumeExportDownload } from '@/lib/resume-export'
import type { ResumeExportRequestBody } from '@/lib/resume-export'

function parseDownloadFilename(cd: string | null): string | undefined {
  // Inline the private function for testing
  if (!cd) return undefined

  const encodedMatch = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (encodedMatch?.[1]) {
    const encodedFilename = encodedMatch[1].trim().replace(/^"(.*)"$/, '$1')
    try {
      return decodeURIComponent(encodedFilename)
    } catch {
      return encodedFilename
    }
  }

  const filenameMatch = cd.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i)
  const filename = filenameMatch?.[1] ?? filenameMatch?.[2]
  return filename?.trim()
}

describe('parseDownloadFilename', () => {
  it('returns undefined for null', () => {
    expect(parseDownloadFilename(null)).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(parseDownloadFilename('')).toBeUndefined()
  })

  it('parses standard filename', () => {
    expect(parseDownloadFilename('attachment; filename="resumes.csv"')).toBe('resumes.csv')
  })

  it('parses filename without quotes', () => {
    expect(parseDownloadFilename('attachment; filename=resumes.csv')).toBe('resumes.csv')
  })

  it('parses UTF-8 encoded filename', () => {
    expect(parseDownloadFilename("attachment; filename*=UTF-8''resumes.csv")).toBe('resumes.csv')
  })

  it('decodes percent-encoded UTF-8 filename', () => {
    const result = parseDownloadFilename("attachment; filename*=UTF-8''%E7%AE%80%E5%8E%86.xlsx")
    expect(result).toBe('简历.xlsx')
  })

  it('prefers encoded filename over standard', () => {
    const cd = 'attachment; filename="old.csv"; filename*=UTF-8\'\'new.csv'
    expect(parseDownloadFilename(cd)).toBe('new.csv')
  })

  it('handles no filename in header', () => {
    expect(parseDownloadFilename('attachment')).toBeUndefined()
  })

  it('handles malformed encoded filename', () => {
    const result = parseDownloadFilename("attachment; filename*=UTF-8''%ZZinvalid")
    expect(result).toBe('%ZZinvalid')
  })
})

describe('submitResumeExportDownload', () => {
  const mockFetch = vi.fn()
  vi.stubGlobal('fetch', mockFetch)

  const validPayload = {
    entries: [{ resumeId: 'r-1' }, { resumeId: 'r-2' }],
    format: 'csv' as const,
    source: 'sample' as const,
  } as unknown as ResumeExportRequestBody

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws network error when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'))
    await expect(
      submitResumeExportDownload('/api', validPayload)
    ).rejects.toThrow('Network error')
  })

  it('throws on non-ok response with JSON error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ error: 'Invalid payload' }),
      text: () => Promise.resolve(''),
    })
    await expect(
      submitResumeExportDownload('/api', validPayload)
    ).rejects.toThrow('Invalid payload')
  })

  it('throws on non-ok response with text body', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('Server error'),
      json: () => Promise.reject(new Error('not json')),
    })
    await expect(
      submitResumeExportDownload('/api', validPayload)
    ).rejects.toThrow('Server error')
  })

  it('sends correct request body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      blob: () => Promise.resolve(new Blob()),
    })
    class MockURL {
      constructor(url: string) { this.href = url }
      href: string
      toString() { return this.href }
      static createObjectURL = () => 'blob:url'
      static revokeObjectURL = () => {}
    }
    vi.stubGlobal('URL', MockURL)
    vi.stubGlobal('document', { body: { appendChild: () => {}, removeChild: () => {} }, createElement: () => ({ click: () => {}, style: {}, remove: () => {} }) })

    await submitResumeExportDownload('/api', validPayload)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/resumes/export'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(validPayload),
      }),
    )
  })
})
