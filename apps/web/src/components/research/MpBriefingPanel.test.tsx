import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MpBriefingPanel } from './MpBriefingPanel'

const postMock = vi.fn()

const mockT = (key: string, options?: { defaultValue?: string } & Record<string, unknown>) => {
  let text = options?.defaultValue ?? key
  if (options) {
    for (const [k, v] of Object.entries(options)) {
      if (k === 'defaultValue') continue
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
    }
  }
  return text
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    POST: (...args: unknown[]) => postMock(...args),
  },
}))

const MP_URLS = [
  'https://mp.weixin.qq.com/s/AbC123xyz_89',
  'https://mp.weixin.qq.com/s?__biz=MzA3NDk&mid=2247&idx=1&sn=a1b2c3',
]

const MP_BRIEFING_FIXTURE = {
  success: true as const,
  briefing: {
    generatedAt: '2026-09-16T00:00:00.000Z',
    cards: [
      { url: 'https://mp.weixin.qq.com/s/AbC123xyz_89', articleId: 'AbC123xyz_89', kind: 'mp' as const },
      { url: 'https://mp.weixin.qq.com/s?__biz=MzA3NDk&mid=2247&idx=1&sn=a1b2c3', kind: 'mp' as const },
    ],
  },
}

function pasteMpUrls() {
  fireEvent.change(screen.getByTestId('research-mp-briefing-textarea'), {
    target: { value: MP_URLS.join('\n') },
  })
}

describe('MpBriefingPanel', () => {
  beforeEach(() => {
    postMock.mockReset()
  })

  it('renders the empty state initially', () => {
    render(
      <MemoryRouter>
        <MpBriefingPanel />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('research-mp-briefing-empty')).toBeInTheDocument()
  })

  it('validates mp links and shows an error for a non-mp link', () => {
    render(
      <MemoryRouter>
        <MpBriefingPanel />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByTestId('research-mp-briefing-textarea'), {
      target: { value: 'https://weixin.qq.com/sph/ALr3ch0zp9' },
    })
    expect(screen.getByTestId('research-mp-briefing-validation')).toBeInTheDocument()
  })

  it('POSTs mp links to /api/research/mp-briefing and renders staged cards', async () => {
    postMock.mockResolvedValue({ data: MP_BRIEFING_FIXTURE })
    render(
      <MemoryRouter>
        <MpBriefingPanel />
      </MemoryRouter>,
    )
    pasteMpUrls()
    fireEvent.click(screen.getByTestId('research-mp-briefing-generate'))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/api/research/mp-briefing',
        expect.objectContaining({ body: { urls: MP_URLS } }),
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId('research-mp-briefing-result')).toBeInTheDocument()
    })
    const cards = screen.getAllByTestId('research-mp-briefing-card')
    expect(cards).toHaveLength(2)
    expect(screen.getAllByText('公众号').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByTestId('research-mp-briefing-error')).not.toBeInTheDocument()
  })

  it('surfaces an error envelope and allows retry', async () => {
    postMock.mockResolvedValue({ data: { success: false, error: 'bad' } })
    render(
      <MemoryRouter>
        <MpBriefingPanel />
      </MemoryRouter>,
    )
    pasteMpUrls()
    fireEvent.click(screen.getByTestId('research-mp-briefing-generate'))

    await waitFor(() => {
      expect(screen.getByTestId('research-mp-briefing-error')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('research-mp-briefing-result')).not.toBeInTheDocument()
  })
})
