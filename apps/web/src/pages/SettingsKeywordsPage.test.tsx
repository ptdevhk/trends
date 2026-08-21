import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BrowserRouter } from 'react-router-dom'

const requestJsonMock = vi.hoisted(() => vi.fn())

vi.mock('@/pages/system-settings/lib', () => ({
  createEmptyCustomKeywordForm: () => ({ id: '', keyword: '', english: '', category: '', markets: [] as string[], visible: true }),
  customKeywordToForm: (tag: Record<string, unknown>) => ({
    id: tag.id ?? '',
    keyword: tag.keyword ?? '',
    english: tag.english ?? '',
    category: tag.category ?? '',
    markets: (tag.markets as string[]) ?? [],
    visible: tag.visible !== false,
  }),
  parseCustomKeywordsPayload: (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return null
    const p = payload as Record<string, unknown>
    return {
      tags: p.tags ?? [],
      categories: p.categories ?? [],
      systemLocations: p.systemLocations ?? [],
      workflowSeeds: p.workflowSeeds ?? [],
    }
  },
  parseBrandKeywordsPayload: (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return null
    const p = payload as Record<string, unknown>
    return p.data ?? null
  },
  useSettingsRequestJson: () => ({ apiBaseUrl: '/api', requestJson: requestJsonMock }),
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
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  CardContent: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, disabled, placeholder, list }: {
    value: string
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    disabled?: boolean
    placeholder?: string
    list?: string
  }) => (
    <input value={value} onChange={onChange} disabled={disabled} placeholder={placeholder} list={list} data-testid="input" />
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span>,
}))

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange }: { checked: boolean | 'indeterminate'; onCheckedChange: (v: boolean | 'indeterminate') => void }) => (
    <input type="checkbox" checked={checked === true} onChange={(e) => onCheckedChange(e.target.checked)} data-testid="checkbox" />
  ),
}))

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
  TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableCell: ({ children, className, colSpan }: { children: React.ReactNode; className?: string; colSpan?: number }) => <td className={className} colSpan={colSpan}>{children}</td>,
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children, onOpenChange }: { open: boolean; children: React.ReactNode; onOpenChange: (open: boolean) => void }) =>
    open ? <div data-testid="dialog">{children}<button data-testid="dialog-backdrop" onClick={() => onOpenChange(false)} /></div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import { SettingsKeywordsPage } from './SettingsKeywordsPage'

const mockCustomKeywords = {
  tags: [
    { id: 'cnc', keyword: 'CNC', english: 'CNC Machining', category: 'industry', markets: ['CN'], visible: true, source: 'system' },
    { id: 'lathe', keyword: '车床', category: 'industry', visible: true, source: 'workspace' },
  ],
  categories: [
    { id: 'industry', name: 'Industry', icon: '🏭' },
  ],
  systemLocations: [
    { id: '1', keyword: 'Guangdong', level: 'province', parentKeyword: null, visible: true },
    { id: '2', keyword: 'Shenzhen', level: 'city', parentKeyword: 'Guangdong', visible: true },
    { id: '3', keyword: 'Dongguan', level: 'city', parentKeyword: 'Guangdong', visible: false },
  ],
  workflowSeeds: [],
}

const mockBrandKeywords = {
  data: [
    { id: 1, nameCn: '华为', nameEn: 'Huawei', type: 'tech', origin: 'system' },
    { id: 2, nameCn: '小米', nameEn: 'Xiaomi', type: 'tech', origin: 'workspace' },
  ],
}

describe('SettingsKeywordsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requestJsonMock.mockImplementation((url: string) => {
      if (url === '/api/config/custom-keywords') return Promise.resolve(mockCustomKeywords)
      if (url === '/api/industry/brands') return Promise.resolve(mockBrandKeywords)
      return Promise.resolve({})
    })
  })

  it('loads custom keywords, locations, and brand keywords on one page', async () => {
    render(
      <BrowserRouter>
        <SettingsKeywordsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC')).toBeInTheDocument()
    })

    expect(screen.getByText('车床')).toBeInTheDocument()
    expect(screen.getAllByText('Guangdong').length).toBeGreaterThan(0)
    expect(screen.getByText('Shenzhen')).toBeInTheDocument()
    expect(screen.getByText('华为')).toBeInTheDocument()
    expect(screen.getByText('Huawei')).toBeInTheDocument()
  })

  it('links members to Search Profiles from the search setup page', async () => {
    render(
      <BrowserRouter>
        <SettingsKeywordsPage />
      </BrowserRouter>,
    )

    const link = await screen.findByRole('link', { name: 'Open Search Profiles' })
    expect(link).toHaveAttribute('href', '/dev/settings/profiles')
  })

  it('opens the add keyword dialog and saves a new custom keyword', async () => {
    const { toast } = await import('sonner')
    requestJsonMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/config/custom-keywords' && init?.method === 'POST') return Promise.resolve({ success: true })
      if (url === '/api/config/custom-keywords') return Promise.resolve(mockCustomKeywords)
      if (url === '/api/industry/brands') return Promise.resolve(mockBrandKeywords)
      return Promise.resolve({})
    })

    render(
      <BrowserRouter>
        <SettingsKeywordsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('Add Keyword'))
    expect(screen.getByTestId('dialog')).toBeInTheDocument()

    const dialog = screen.getByTestId('dialog')
    const inputs = within(dialog).getAllByTestId('input')
    await userEvent.type(inputs[0], 'test-kw')
    await userEvent.type(inputs[1], 'Test KW')
    await userEvent.type(inputs[3], 'industry')
    await userEvent.click(screen.getByText('debugConfig.save'))

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled()
    })
  })

  it('filters the embedded locations list by search query', async () => {
    const user = userEvent.setup()
    render(
      <BrowserRouter>
        <SettingsKeywordsPage />
      </BrowserRouter>,
    )

    expect(await screen.findAllByText('Guangdong')).toHaveLength(3)

    const searchInput = screen.getByPlaceholderText(/search locations/i)
    await user.type(searchInput, 'Shenzhen')

    expect(screen.getByText('Shenzhen')).toBeInTheDocument()
    expect(screen.queryByText('Dongguan')).not.toBeInTheDocument()
  })

  it('filters custom keywords table by search query (case-insensitive)', async () => {
    const user = userEvent.setup()
    render(
      <BrowserRouter>
        <SettingsKeywordsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText(/filter custom keywords/i)
    await user.type(searchInput, 'lathe')

    expect(screen.getByText('车床')).toBeInTheDocument()
    expect(screen.queryByText('CNC')).not.toBeInTheDocument()

    await user.clear(searchInput)
    await user.type(searchInput, 'CNC MACHINING')

    expect(screen.getByText('CNC')).toBeInTheDocument()
    expect(screen.queryByText('车床')).not.toBeInTheDocument()

    await user.clear(searchInput)
    await user.type(searchInput, 'zzzz-no-match')
    expect(screen.getByText('No matching keywords')).toBeInTheDocument()
  })

  it('filters custom keywords table by category', async () => {
    const user = userEvent.setup()
    requestJsonMock.mockImplementation((url: string) => {
      if (url === '/api/config/custom-keywords') {
        return Promise.resolve({
          ...mockCustomKeywords,
          tags: [
            ...mockCustomKeywords.tags,
            { id: 'welding', keyword: '焊接', category: 'process', visible: true, source: 'workspace' },
          ],
          categories: [
            { id: 'industry', name: 'Industry', icon: '🏭' },
            { id: 'process', name: 'Process', icon: '⚙️' },
          ],
        })
      }
      if (url === '/api/industry/brands') return Promise.resolve(mockBrandKeywords)
      return Promise.resolve({})
    })

    render(
      <BrowserRouter>
        <SettingsKeywordsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('焊接')).toBeInTheDocument()
    })

    const categoryFilter = screen.getByTestId('custom-keyword-category-filter')
    await user.selectOptions(categoryFilter, 'process')

    expect(screen.getByText('焊接')).toBeInTheDocument()
    expect(screen.queryByText('CNC')).not.toBeInTheDocument()
    expect(screen.queryByText('车床')).not.toBeInTheDocument()

    await user.selectOptions(categoryFilter, 'all')

    expect(screen.getByText('CNC')).toBeInTheDocument()
    expect(screen.getByText('车床')).toBeInTheDocument()
    expect(screen.getByText('焊接')).toBeInTheDocument()
  })

  it('toggles location visibility through the workspace search setup API', async () => {
    const user = userEvent.setup()

    render(
      <BrowserRouter>
        <SettingsKeywordsPage />
      </BrowserRouter>,
    )

    expect(await screen.findAllByText('Guangdong')).toHaveLength(3)

    const hideButtons = screen.getAllByText('Hide')
    await user.click(hideButtons[0])

    expect(requestJsonMock).toHaveBeenCalledWith(
      '/api/config/custom-keywords/system-locations/1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ visible: false }) }),
    )
  })

  it('shows an error banner when search setup data fails to load', async () => {
    requestJsonMock.mockRejectedValue(new Error('Network error'))

    render(
      <BrowserRouter>
        <SettingsKeywordsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('resumes.error')).toBeInTheDocument()
    })
  })

  it('filters brand keywords by CN/EN name', async () => {
    const user = userEvent.setup()
    render(
      <BrowserRouter>
        <SettingsKeywordsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('华为')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText(/search by cn\/en name/i)
    await user.type(searchInput, 'huawei')

    expect(screen.getByText('Huawei')).toBeInTheDocument()
    expect(screen.queryByText('小米')).not.toBeInTheDocument()

    await user.clear(searchInput)
    await user.type(searchInput, '小米')

    expect(screen.getByText('小米')).toBeInTheDocument()
    expect(screen.queryByText('Huawei')).not.toBeInTheDocument()

    await user.clear(searchInput)
    await user.type(searchInput, 'zzzz-no-match')
    expect(screen.getByText('No matching entries')).toBeInTheDocument()
  })
})
