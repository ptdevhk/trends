import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ResearchCompanyPage } from './ResearchCompanyPage'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => getMock(...args),
    POST: (...args: unknown[]) => postMock(...args),
  },
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'hr' }),
}))

vi.mock('@/lib/research-recent-companies', () => ({
  upsertResearchRecentCompany: vi.fn(),
}))

vi.mock('@/lib/research-company-refresh', () => ({
  isCompanyOnOpenRefreshEnabled: () => false,
  readLastCompanyRefreshAt: () => null,
  shouldAutoRefreshCompany: () => false,
  writeLastCompanyRefreshAt: vi.fn(),
}))

function mockGetDefault() {
  getMock.mockImplementation(async (path: string) => {
    if (typeof path === 'string' && path.includes('/signals')) {
      return {
        data: {
          success: true,
          items: [
            {
              companyKey: 'fanuc',
              kind: 'hiring_signal',
              title: '发那科扩产',
              evidence: {
                title: '发那科扩产',
                platform: 'rss:gnews-fanuc-cn',
                url: 'https://news.google.com/rss/articles/x',
                seenAt: Date.now(),
              },
              capturedAt: Date.now(),
            },
          ],
          meta: { liveCount: 1, showcaseCount: 0, liveFirst: true },
        },
      }
    }
    if (path === '/api/research/industry/resolve') {
      return {
        data: {
          success: true,
          hit: {
            companyKey: 'fanuc',
            nameCn: '发那科',
            nameEn: 'FANUC',
            displayName: '发那科 / FANUC',
          },
        },
      }
    }
    if (path === '/api/research/ingest/latest') {
      return { data: { success: true, run: null } }
    }
    if (path === '/api/research/pulse') {
      return {
        data: {
          success: true,
          items: [
            {
              title: '娱乐热搜',
              platform: 'weibo',
              capturedAt: Date.now(),
              url: 'https://s.weibo.com/x',
            },
            {
              title: '发那科相关讨论',
              platform: 'zhihu',
              capturedAt: Date.now() - 1000,
            },
          ],
          meta: {
            filtered: false,
            effectiveKeywords: [],
            rawCount: 2,
            matchedCount: 0,
          },
        },
      }
    }
    return { data: { success: true } }
  })
}

describe('ResearchCompanyPage route mount', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
    mockGetDefault()
  })

  it('App mounts /:teamSlug/research/:companyKey', () => {
    const appPath = resolve(__dirname, '../App.tsx')
    const source = readFileSync(appPath, 'utf8')
    expect(source).toContain('path="research/:companyKey"')
    expect(source).toContain('ResearchCompanyPage')
  })

  it('defaults to 品牌动态 and switches to 综合热榜 loading pulse with hotlistOnly', async () => {
    render(
      <MemoryRouter initialEntries={['/hr/research/fanuc?persona=hr']}>
        <Routes>
          <Route path="/:teamSlug/research/:companyKey" element={<ResearchCompanyPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('research-company-surface-tabs')).toBeInTheDocument()
    })

    expect(screen.getByTestId('research-company-tab-brand')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('research-company-brand-panel')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('research-company-tab-hotlist'))

    await waitFor(() => {
      expect(screen.getByTestId('research-company-hotlist-panel')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getAllByTestId('research-company-hotlist-item').length).toBeGreaterThan(0)
    })

    const pulseCalls = getMock.mock.calls.filter(
      (call) => call[0] === '/api/research/pulse',
    )
    expect(pulseCalls.length).toBeGreaterThanOrEqual(1)
    const pulseOpts = pulseCalls[0]![1] as {
      params?: { query?: { hotlistOnly?: number; all?: number } }
    }
    expect(pulseOpts?.params?.query?.hotlistOnly).toBe(1)
    expect(pulseOpts?.params?.query?.all).toBe(1)

    // Alias highlight is visual only
    const highlighted = screen
      .getAllByTestId('research-company-hotlist-item')
      .find((el) => el.getAttribute('data-highlighted') === 'true')
    expect(highlighted).toBeTruthy()
    expect(highlighted).toHaveTextContent('发那科')
  })
})
