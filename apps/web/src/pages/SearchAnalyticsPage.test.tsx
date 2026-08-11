import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BrowserRouter } from 'react-router-dom'

const getMock = vi.hoisted(() => vi.fn())
const postMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => getMock(...args),
    POST: (...args: unknown[]) => postMock(...args),
  },
}))

const mockT = (_key: string, fallback?: string | Record<string, unknown>) => {
  if (typeof fallback === 'string') return fallback
  if (fallback && typeof fallback === 'object' && 'defaultValue' in fallback) {
    return fallback.defaultValue as string
  }
  return _key
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div><h1>{title}</h1>{actions}</div>
  ),
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}))

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
  TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableCell: ({ children, ...props }: { children: React.ReactNode; colSpan?: number; className?: string }) => <td {...props}>{children}</td>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled} {...props}>{children}</button>
  ),
}))

const mockSummary = {
  totalSearches: 42,
  zeroResultSearches: 5,
  zeroResultRate: 0.119,
  topQueries: [
    { query: 'CNC', count: 10 },
    { query: '铣工', count: 7 },
  ],
  actionDistribution: { shortlist: 15, reject: 8 },
  dailyTrend: [
    { date: '2026-05-24', searches: 20, zeroResults: 2, shortlist: 5, reject: 3 },
    { date: '2026-05-23', searches: 22, zeroResults: 3, shortlist: 10, reject: 5 },
  ],
}

function createGetMock(overrides: Record<string, unknown> = {}) {
  return (url: string) => {
    if (url.includes('/summary')) {
      return { data: { success: true, summary: mockSummary, ...overrides } }
    }
    if (url.includes('/zero-results')) {
      return {
        data: {
          success: true,
          items: [
            { query: 'nonexistent', count: 3, lastSeen: '2026-05-24' },
            { query: 'unknown_skill', count: 2, lastSeen: '2026-05-23' },
          ],
        },
      }
    }
    if (url.includes('/synonym-suggestions')) {
      return {
        data: {
          success: true,
          suggestions: [
            { query: 'nonexistent', variant: 'nonexistant', canonical: 'nonexistent', confidence: 0.85, reason: 'typo' },
          ],
        },
      }
    }
    return { data: { success: false } }
  }
}

// Need to import after mocks
import SearchAnalyticsPage from './SearchAnalyticsPage'

describe('SearchAnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state initially', () => {
    getMock.mockReturnValue(new Promise(() => {})) // never resolves

    render(
      <BrowserRouter>
        <SearchAnalyticsPage />
      </BrowserRouter>,
    )

    expect(screen.getByText('Loading analytics...')).toBeInTheDocument()
  })

  it('renders analytics dashboard after data loads', async () => {
    getMock.mockImplementation(createGetMock())

    render(
      <BrowserRouter>
        <SearchAnalyticsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Search Accuracy Dashboard')).toBeInTheDocument()
    })

    expect(screen.getByText('42')).toBeInTheDocument() // totalSearches
    expect(screen.getByText('11.9%')).toBeInTheDocument() // zeroResultRate
    expect(screen.getByText('15')).toBeInTheDocument() // shortlist
    expect(screen.getByText('8')).toBeInTheDocument() // reject
  })

  it('shows no data message when summary fetch fails', async () => {
    getMock.mockImplementation((url: string) => {
      if (url.includes('/summary')) {
        return { data: { success: false } }
      }
      return { data: { success: true, items: [], suggestions: [] } }
    })

    render(
      <BrowserRouter>
        <SearchAnalyticsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('No analytics data available yet.')).toBeInTheDocument()
    })
  })

  it('shows error toast when API call fails', async () => {
    const { toast } = await import('sonner')
    getMock.mockRejectedValue(new Error('Network error'))

    render(
      <BrowserRouter>
        <SearchAnalyticsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })
  })

  it('renders top queries', async () => {
    getMock.mockImplementation(createGetMock())

    render(
      <BrowserRouter>
        <SearchAnalyticsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC')).toBeInTheDocument()
      expect(screen.getByText('铣工')).toBeInTheDocument()
    })
  })

  it('renders zero-result queries with suggestions', async () => {
    getMock.mockImplementation(createGetMock())

    render(
      <BrowserRouter>
        <SearchAnalyticsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('nonexistent')).toBeInTheDocument()
    })

    expect(screen.getByText('Suggest Synonym')).toBeInTheDocument()
    expect(screen.getByText(/nonexistant → nonexistent/)).toBeInTheDocument()
  })

  it('submits synonym suggestion on button click', async () => {
    getMock.mockImplementation(createGetMock())
    postMock.mockResolvedValue({ data: { success: true } })

    render(
      <BrowserRouter>
        <SearchAnalyticsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Suggest Synonym')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('Suggest Synonym'))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/api/resumes/learning-feedback',
        expect.objectContaining({
          body: expect.objectContaining({
            observation: expect.stringContaining('synonym_suggestion'),
          }),
        }),
      )
    })
  })

  it('refreshes data when refresh button is clicked', async () => {
    getMock.mockImplementation(createGetMock())

    render(
      <BrowserRouter>
        <SearchAnalyticsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Search Accuracy Dashboard')).toBeInTheDocument()
    })

    const initialCallCount = getMock.mock.calls.length
    await userEvent.click(screen.getByText('Refresh'))

    await waitFor(() => {
      expect(getMock.mock.calls.length).toBeGreaterThan(initialCallCount)
    })
  })

  it('shows no suggestion available for queries without synonyms', async () => {
    getMock.mockImplementation((url: string) => {
      if (url.includes('/summary')) {
        return { data: { success: true, summary: mockSummary } }
      }
      if (url.includes('/zero-results')) {
        return {
          data: {
            success: true,
            items: [{ query: 'orphan_query', count: 1, lastSeen: '2026-05-24' }],
          },
        }
      }
      if (url.includes('/synonym-suggestions')) {
        return { data: { success: true, suggestions: [] } }
      }
      return { data: { success: false } }
    })

    render(
      <BrowserRouter>
        <SearchAnalyticsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('No suggestion available')).toBeInTheDocument()
    })
  })
})
