import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, vi } from 'vitest'
import ResearchDailyPage from './ResearchDailyPage'

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'hr' }),
}))

// Stub global fetch to serve the frozen pack from the Vite public path.
const FIXTURE = {
  date: '2026-09-22',
  localeDefault: 'zh-Hans',
  source: 'live',
  generatedAt: '2026-09-22T08:00:00Z',
  hero: {
    headline: '今日商机热度',
    value: '37',
    delta: '+12%',
    meta: '3 行业 · 8 新公司',
    sparkline: [1, 2, 3, 4, 5, 6, 7],
    dayDates: ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22'],
  },
  opportunities: [
    { kind: '商机', label: '3D 扫描 销售', heat: '3.8万', growth: '+1,200%', started: 't1', sparkline: [1, 2], chips: ['三坐标'] },
  ],
  stories: [{ title: '数控机床订单回暖' }],
}

afterEach(() => {
  vi.restoreAllMocks()
})

function renderAt(date: string) {
  return render(
    <MemoryRouter initialEntries={[`/hr/research/daily/${date}`]}>
      <Routes>
        <Route path="/hr/research/daily/:date" element={<ResearchDailyPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ResearchDailyPage (in-app twin)', () => {
  it('fetches the pack and renders the M3 report HTML into the iframe', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === '/daily/2026-09-22.json') {
          return { ok: true, json: async () => FIXTURE }
        }
        return { ok: false, json: async () => [] }
      }),
    )

    renderAt('2026-09-22')

    await waitFor(() => {
      const iframe = document.querySelector('iframe[title="daily-report-2026-09-22"]')
      expect(iframe).not.toBeNull()
      const srcdoc = iframe?.getAttribute('srcdoc') ?? ''
      expect(srcdoc).toContain('今日商机')
    })
    expect(screen.getByTestId('research-daily-back')).toHaveAttribute('href', '/hr/research')
    const download = screen.getByTestId('research-daily-download')
    expect(download).toBeEnabled()
    expect(download).toHaveTextContent(/下载完整 HTML|Download complete HTML/)
  })

  it('download button triggers a blob save of the rendered HTML', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === '/daily/2026-09-22.json') {
          return { ok: true, json: async () => FIXTURE }
        }
        return { ok: false, json: async () => [] }
      }),
    )
    const click = vi.fn()
    const revoke = vi.fn()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:daily-test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke)
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag)
      if (tag === 'a') {
        Object.defineProperty(el, 'click', { value: click })
      }
      return el
    })

    renderAt('2026-09-22')
    await waitFor(() => {
      expect(screen.getByTestId('research-daily-download')).toBeEnabled()
    })
    screen.getByTestId('research-daily-download').click()
    expect(click).toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledWith('blob:daily-test')
  })

  it('falls back to the latest day when the requested date has no pack', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === '/daily/2026-09-99.json') return { ok: false, json: async () => [] }
        if (path === '/daily/index.json') return { ok: true, json: async () => ({ dates: ['2026-09-21', '2026-09-22'] }) }
        if (path === '/daily/2026-09-22.json') return { ok: true, json: async () => FIXTURE }
        return { ok: false, json: async () => [] }
      }),
    )

    renderAt('2026-09-99')
    await waitFor(() => {
      expect(screen.queryByText(/HTTP 404|No daily report/i)).toBeNull()
    })
    await waitFor(() => {
      const iframe = document.querySelector('iframe[title^="daily-report-2026-09-22"]')
      expect(iframe).not.toBeNull()
    })
  })

  it('does not render PII/resume in the srcdoc', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === '/daily/2026-09-22.json') return { ok: true, json: async () => FIXTURE }
        return { ok: false, json: async () => [] }
      }),
    )
    renderAt('2026-09-22')
    await waitFor(() => {
      const iframe = document.querySelector('iframe')
      const srcdoc = iframe?.getAttribute('srcdoc') ?? ''
      expect(srcdoc).not.toMatch(/resumeId|phone|身份证|email@/i)
    })
  })

  it('falls back to the latest day when BFF index.json is desc-ordered (Convex listDates)', async () => {
    // Production BFF returns dates DESC (listDates order by_date desc); the page
    // must still pick the newest date, not the last array element.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === '/daily/2026-09-99.json') return { ok: false, json: async () => [] }
        if (path === '/daily/index.json') return { ok: true, json: async () => ({ dates: ['2026-09-22', '2026-09-21'] }) }
        if (path === '/daily/2026-09-22.json') return { ok: true, json: async () => FIXTURE }
        return { ok: false, json: async () => [] }
      }),
    )

    renderAt('2026-09-99')
    await waitFor(() => {
      const iframe = document.querySelector('iframe[title^="daily-report-2026-09-22"]')
      expect(iframe).not.toBeNull()
    })
  })

  it('renders day-switcher chips using pack.hero.dayDates with active state and correct hrefs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === '/daily/2026-09-22.json') return { ok: true, json: async () => FIXTURE }
        return { ok: false, json: async () => [] }
      }),
    )

    renderAt('2026-09-22')

    await waitFor(() => {
      expect(screen.getByTestId('daily-day-nav')).toBeInTheDocument()
    })

    for (const ymd of FIXTURE.hero.dayDates) {
      const chip = screen.getByTestId(`daily-day-link-${ymd}`)
      expect(chip).toHaveAttribute('href', `/hr/research/daily/${ymd}`)
    }

    const active = screen.getByTestId('daily-day-link-2026-09-22')
    expect(active).toHaveAttribute('aria-current', 'page')
  })

  it('falls back to a client-side 7-day Shanghai window when pack has no dayDates', async () => {
    const fixtureNoDates = { ...FIXTURE, hero: { ...FIXTURE.hero, dayDates: undefined } }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === '/daily/2026-09-22.json') return { ok: true, json: async () => fixtureNoDates }
        return { ok: false, json: async () => [] }
      }),
    )

    renderAt('2026-09-22')

    await waitFor(() => {
      expect(screen.getByTestId('daily-day-nav')).toBeInTheDocument()
    })

    const expected = ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22']
    for (const ymd of expected) {
      expect(screen.getByTestId(`daily-day-link-${ymd}`)).toHaveAttribute('href', `/hr/research/daily/${ymd}`)
    }
  })
})
