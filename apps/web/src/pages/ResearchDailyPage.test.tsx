import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, vi } from 'vitest'
import ResearchDailyPage from './ResearchDailyPage'

// Stub global fetch to serve the frozen pack from the Vite public path.
const FIXTURE = {
  date: '2026-09-22',
  localeDefault: 'zh-Hans',
  source: 'live',
  generatedAt: '2026-09-22T08:00:00Z',
  hero: { headline: '今日商机热度', value: '37', delta: '+12%', meta: '3 行业 · 8 新公司', sparkline: [1, 2, 3] },
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
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/daily/2026-09-22.json') {
        return { ok: true, json: async () => FIXTURE }
      }
      return { ok: false, json: async () => [] }
    }))

    renderAt('2026-09-22')

    await waitFor(() => {
      const iframe = document.querySelector('iframe[title="daily-report-2026-09-22"]')
      expect(iframe).not.toBeNull()
      const srcdoc = iframe?.getAttribute('srcdoc') ?? ''
      expect(srcdoc).toContain('今日商机')
      expect(srcdoc).toContain('>37 <span')
    })
  })

  it('falls back to the latest day when the requested date has no pack', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/daily/2026-09-99.json') return { ok: false, json: async () => [] }
      if (path === '/daily/index.json') return { ok: true, json: async () => ['2026-09-21', '2026-09-22'] }
      if (path === '/daily/2026-09-22.json') return { ok: true, json: async () => FIXTURE }
      return { ok: false, json: async () => [] }
    }))

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
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/daily/2026-09-22.json') return { ok: true, json: async () => FIXTURE }
      return { ok: false, json: async () => [] }
    }))
    renderAt('2026-09-22')
    await waitFor(() => {
      const iframe = document.querySelector('iframe')
      const srcdoc = iframe?.getAttribute('srcdoc') ?? ''
      expect(srcdoc).not.toMatch(/resume|身份证|手机号|email/i)
    })
  })
})
