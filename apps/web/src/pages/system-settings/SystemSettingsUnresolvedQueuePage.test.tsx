import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRequestJson = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: mockToast,
}))

const mockT = (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

vi.mock('@/pages/system-settings/lib', () => ({
  // requestJson must keep a stable identity across renders (the real hook
  // memoizes it) or the page's mount effect would refetch on every render.
  useSettingsRequestJson: () => ({
    apiBaseUrl: 'http://localhost:8000',
    requestJson: mockRequestJson,
  }),
}))

vi.mock('@/lib/ui-error-reporting', () => ({
  reportUiError: vi.fn(),
}))

import { SystemSettingsUnresolvedQueuePage } from './SystemSettingsUnresolvedQueuePage'

type QueueResolution = {
  action: 'link' | 'ignore'
  targetCompanyKey?: string
  resolvedAt: string
  resolvedBy: string
}

type QueueItem = {
  normalizedKey: string
  count: number
  examples: string[]
  maxNearbyScore: number
  reasons: string[]
  priority: boolean
  priorityReasons: string[]
  resolution?: QueueResolution
}

const unresolvedItem: QueueItem = {
  normalizedKey: 'unknownoema',
  count: 2,
  examples: ['UnknownOEM-A'],
  maxNearbyScore: 80,
  reasons: ['miss'],
  priority: true,
  priorityReasons: ['score>=70'],
}

const linkedItem: QueueItem = {
  normalizedKey: 'freqbrandx',
  count: 3,
  examples: ['FreqBrandX'],
  maxNearbyScore: 10,
  reasons: ['miss'],
  priority: true,
  priorityReasons: ['freq>=3'],
  resolution: {
    action: 'link',
    targetCompanyKey: 'polywell',
    resolvedAt: '2026-08-19T00:00:00.000Z',
    resolvedBy: 'admin-user',
  },
}

const ignoredItem: QueueItem = {
  normalizedKey: 'otherb',
  count: 1,
  examples: ['Other-B'],
  maxNearbyScore: 10,
  reasons: ['low_confidence_keyword'],
  priority: false,
  priorityReasons: [],
  resolution: {
    action: 'ignore',
    resolvedAt: '2026-08-19T01:00:00.000Z',
    resolvedBy: 'admin-user',
  },
}

const allItems: QueueItem[] = [unresolvedItem, linkedItem, ignoredItem]

function mockListResponse(path: string): unknown {
  const url = new URL(path, 'http://localhost')
  const status = url.searchParams.get('status') ?? 'unresolved'
  const searchTerm = url.searchParams.get('search') ?? ''
  const filtered = allItems
    .filter((item) => {
      if (status === 'unresolved') return !item.resolution
      if (status === 'linked') return item.resolution?.action === 'link'
      if (status === 'ignored') return item.resolution?.action === 'ignore'
      return true
    })
    .filter((item) => !searchTerm || item.normalizedKey.includes(searchTerm))
  return {
    success: true,
    items: filtered,
    total: filtered.length,
    counts: { unresolved: 1, linked: 1, ignored: 1, total: 3 },
  }
}

describe('SystemSettingsUnresolvedQueuePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequestJson.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/api/industry-data/unresolved/resolve')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { keys: string[] }
        return { success: true, resolved: body.keys, updatedAt: '2026-08-19T02:00:00.000Z' }
      }
      if (path.startsWith('/api/industry-data/unresolved')) {
        return mockListResponse(path)
      }
      return { success: true }
    })
  })

  it('renders status tabs with counts and unresolved rows', async () => {
    render(<SystemSettingsUnresolvedQueuePage />)

    expect(await screen.findByTestId('unresolved-queue-row-unknownoema')).toBeInTheDocument()
    expect(screen.getByTestId('unresolved-queue-tab-unresolved')).toHaveTextContent('unresolved (1)')
    expect(screen.getByTestId('unresolved-queue-tab-linked')).toHaveTextContent('linked (1)')
    expect(screen.getByTestId('unresolved-queue-tab-ignored')).toHaveTextContent('ignored (1)')
    expect(screen.getByTestId('unresolved-queue-tab-all')).toHaveTextContent('all (3)')
    expect(screen.getByTestId('unresolved-queue-priority-unknownoema')).toBeInTheDocument()
    expect(screen.getByText('UnknownOEM-A')).toBeInTheDocument()
    // unresolved tab hides resolved rows
    expect(screen.queryByTestId('unresolved-queue-row-freqbrandx')).not.toBeInTheDocument()
    expect(screen.queryByTestId('unresolved-queue-row-otherb')).not.toBeInTheDocument()
  })

  it('shows an empty state when the server returns no items', async () => {
    mockRequestJson.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/industry-data/unresolved')) {
        return { success: true, items: [], total: 0, counts: { unresolved: 0, linked: 0, ignored: 0, total: 0 } }
      }
      return { success: true }
    })
    render(<SystemSettingsUnresolvedQueuePage />)
    expect(await screen.findByTestId('unresolved-queue-empty')).toBeInTheDocument()
  })

  it('switches to the linked tab and shows the resolution badge', async () => {
    const user = userEvent.setup()
    render(<SystemSettingsUnresolvedQueuePage />)
    await screen.findByTestId('unresolved-queue-row-unknownoema')

    await user.click(screen.getByTestId('unresolved-queue-tab-linked'))

    expect(await screen.findByTestId('unresolved-queue-row-freqbrandx')).toBeInTheDocument()
    expect(screen.getByTestId('unresolved-queue-resolution-freqbrandx')).toHaveTextContent(
      'Linked: {{companyKey}}',
    )
    expect(screen.queryByTestId('unresolved-queue-row-unknownoema')).not.toBeInTheDocument()
  })

  it('refetches with a search query parameter', async () => {
    const user = userEvent.setup()
    render(<SystemSettingsUnresolvedQueuePage />)
    await screen.findByTestId('unresolved-queue-row-unknownoema')

    await user.type(screen.getByTestId('unresolved-queue-search-input'), 'unknown')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(mockRequestJson).toHaveBeenCalledWith(
        expect.stringContaining('/api/industry-data/unresolved?status=unresolved&search=unknown'),
      )
    })
  })

  it('links a single row with a target company key', async () => {
    const user = userEvent.setup()
    render(<SystemSettingsUnresolvedQueuePage />)
    await screen.findByTestId('unresolved-queue-row-unknownoema')

    await user.type(screen.getByTestId('unresolved-queue-link-target-unknownoema'), 'polywell')
    await user.click(screen.getByTestId('unresolved-queue-link-unknownoema'))

    await waitFor(() => {
      expect(mockRequestJson).toHaveBeenCalledWith(
        '/api/industry-data/unresolved/resolve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ keys: ['unknownoema'], action: 'link', targetCompanyKey: 'polywell' }),
        }),
      )
    })
    expect(mockToast.success).toHaveBeenCalledWith('Linked {{count}} employer key(s)')
  })

  it('blocks a link without a target company key', async () => {
    const user = userEvent.setup()
    render(<SystemSettingsUnresolvedQueuePage />)
    await screen.findByTestId('unresolved-queue-row-unknownoema')

    await user.click(screen.getByTestId('unresolved-queue-link-unknownoema'))

    expect(mockToast.error).toHaveBeenCalledWith('Enter a company key to link.')
    const resolveCalls = mockRequestJson.mock.calls.filter((call) =>
      String(call[0]).includes('/unresolved/resolve'),
    )
    expect(resolveCalls).toHaveLength(0)
  })

  it('ignores a single row without a target company key', async () => {
    const user = userEvent.setup()
    render(<SystemSettingsUnresolvedQueuePage />)
    await screen.findByTestId('unresolved-queue-row-unknownoema')

    await user.click(screen.getByTestId('unresolved-queue-ignore-unknownoema'))

    await waitFor(() => {
      expect(mockRequestJson).toHaveBeenCalledWith(
        '/api/industry-data/unresolved/resolve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ keys: ['unknownoema'], action: 'ignore' }),
        }),
      )
    })
    expect(mockToast.success).toHaveBeenCalledWith('Ignored {{count}} employer key(s)')
  })

  it('bulk-links all selected rows and clears the selection', async () => {
    const user = userEvent.setup()
    render(<SystemSettingsUnresolvedQueuePage />)
    await screen.findByTestId('unresolved-queue-row-unknownoema')

    await user.click(screen.getByTestId('unresolved-queue-tab-all'))
    await screen.findByTestId('unresolved-queue-row-otherb')

    await user.click(screen.getByTestId('unresolved-queue-select-unknownoema'))
    await user.click(screen.getByTestId('unresolved-queue-select-otherb'))
    expect(screen.getByTestId('unresolved-queue-bulk-bar')).toHaveTextContent('{{count}} selected')

    await user.type(screen.getByTestId('unresolved-queue-bulk-target'), 'polywell')
    await user.click(screen.getByTestId('unresolved-queue-bulk-link'))

    await waitFor(() => {
      expect(mockRequestJson).toHaveBeenCalledWith(
        '/api/industry-data/unresolved/resolve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            keys: ['unknownoema', 'otherb'],
            action: 'link',
            targetCompanyKey: 'polywell',
          }),
        }),
      )
    })
    expect(mockToast.success).toHaveBeenCalledWith('Linked {{count}} employer key(s)')
    await waitFor(() => {
      expect(screen.queryByTestId('unresolved-queue-bulk-bar')).not.toBeInTheDocument()
    })
  })

  it('selects and deselects all visible rows via the master checkbox', async () => {
    const user = userEvent.setup()
    render(<SystemSettingsUnresolvedQueuePage />)
    await screen.findByTestId('unresolved-queue-row-unknownoema')

    await user.click(screen.getByTestId('unresolved-queue-tab-all'))
    await screen.findByTestId('unresolved-queue-row-otherb')

    await user.click(screen.getByTestId('unresolved-queue-select-all'))
    expect(screen.getByTestId('unresolved-queue-bulk-bar')).toHaveTextContent('{{count}} selected')
    expect(screen.getByTestId('unresolved-queue-select-unknownoema')).toBeChecked()
    expect(screen.getByTestId('unresolved-queue-select-otherb')).toBeChecked()

    await user.click(screen.getByTestId('unresolved-queue-select-all'))
    await waitFor(() => {
      expect(screen.queryByTestId('unresolved-queue-bulk-bar')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('unresolved-queue-select-unknownoema')).not.toBeChecked()
    expect(screen.getByTestId('unresolved-queue-select-otherb')).not.toBeChecked()
  })

  it('shows an error panel on load failure and recovers via retry', async () => {
    const user = userEvent.setup()
    let failOnce = true
    mockRequestJson.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/industry-data/unresolved') && failOnce) {
        failOnce = false
        throw new Error('boom')
      }
      return mockListResponse(path)
    })

    render(<SystemSettingsUnresolvedQueuePage />)
    expect(await screen.findByTestId('unresolved-queue-error')).toBeInTheDocument()

    await user.click(screen.getByTestId('unresolved-queue-retry'))
    expect(await screen.findByTestId('unresolved-queue-row-unknownoema')).toBeInTheDocument()
  })
})
