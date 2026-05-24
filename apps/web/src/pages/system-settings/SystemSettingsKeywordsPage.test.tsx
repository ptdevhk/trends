import { render, screen, waitFor } from '@testing-library/react'
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
    return { tags: p.tags ?? [], categories: p.categories ?? [], systemLocations: [] }
  },
  parseBrandKeywordsPayload: (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return null
    const p = payload as Record<string, unknown>
    return p.data ?? null
  },
  useSettingsRequestJson: () => ({ apiBaseUrl: '/api', requestJson: requestJsonMock }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback
      if (fallback && typeof fallback === 'object' && 'defaultValue' in fallback) {
        return fallback.defaultValue as string
      }
      return _key
    },
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
  Input: ({ value, onChange, disabled }: { value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; disabled?: boolean }) => (
    <input value={value} onChange={onChange} disabled={disabled} data-testid="input" />
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

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a> }
})

import { SystemSettingsKeywordsPage } from './SystemSettingsKeywordsPage'

const mockCustomKeywords = {
  tags: [
    { id: 'cnc', keyword: 'CNC', english: 'CNC Machining', category: 'industry', markets: ['CN'], visible: true, source: 'system' },
    { id: 'lathe', keyword: '车床', category: 'industry', visible: true, source: 'workspace' },
  ],
  categories: [
    { id: 'industry', name: 'Industry', icon: '🏭' },
  ],
}

const mockBrandKeywords = {
  data: [
    { id: 'b1', nameCn: '华为', nameEn: 'Huawei', type: 'tech', origin: 'system' },
    { id: 'b2', nameCn: '小米', nameEn: 'Xiaomi', type: 'tech', origin: 'workspace' },
  ],
}

describe('SystemSettingsKeywordsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requestJsonMock.mockImplementation((url: string) => {
      if (url === '/api/config/custom-keywords') return Promise.resolve(mockCustomKeywords)
      if (url === '/api/industry/brands') return Promise.resolve(mockBrandKeywords)
      return Promise.resolve({})
    })
  })

  it('loads and displays custom keyword tags', async () => {
    render(
      <BrowserRouter>
        <SystemSettingsKeywordsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC')).toBeInTheDocument()
    })
    expect(screen.getByText('车床')).toBeInTheDocument()
  })

  it('loads and displays brand keywords', async () => {
    render(
      <BrowserRouter>
        <SystemSettingsKeywordsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('华为')).toBeInTheDocument()
    })
    expect(screen.getByText('Huawei')).toBeInTheDocument()
    expect(screen.getByText('小米')).toBeInTheDocument()
  })

  it('shows loading state initially', () => {
    requestJsonMock.mockReturnValue(new Promise(() => {}))

    render(
      <BrowserRouter>
        <SystemSettingsKeywordsPage />
      </BrowserRouter>,
    )

    expect(screen.getByText('Keywords')).toBeInTheDocument()
  })

  it('shows error state on load failure', async () => {
    requestJsonMock.mockRejectedValue(new Error('Network error'))

    render(
      <BrowserRouter>
        <SystemSettingsKeywordsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('resumes.error')).toBeInTheDocument()
    })
  })

  it('opens add keyword dialog', async () => {
    render(
      <BrowserRouter>
        <SystemSettingsKeywordsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC')).toBeInTheDocument()
    })

    const addBtn = screen.getByText('Add Keyword')
    await userEvent.click(addBtn)

    expect(screen.getByTestId('dialog')).toBeInTheDocument()
  })

  it('opens edit keyword dialog', async () => {
    render(
      <BrowserRouter>
        <SystemSettingsKeywordsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC')).toBeInTheDocument()
    })

    const editButtons = screen.getAllByText('debugConfig.editCustomKeyword')
    await userEvent.click(editButtons[0])

    expect(screen.getByTestId('dialog')).toBeInTheDocument()
  })

  it('saves a new custom keyword', async () => {
    const { toast } = await import('sonner')
    requestJsonMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/config/custom-keywords' && init?.method === 'POST') return Promise.resolve({ success: true })
      if (url === '/api/config/custom-keywords') return Promise.resolve(mockCustomKeywords)
      if (url === '/api/industry/brands') return Promise.resolve(mockBrandKeywords)
      return Promise.resolve({})
    })

    render(
      <BrowserRouter>
        <SystemSettingsKeywordsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC')).toBeInTheDocument()
    })

    // Open add dialog
    const addBtn = screen.getByText('Add Keyword')
    await userEvent.click(addBtn)

    // Fill in the form — find the inputs
    const inputs = screen.getAllByTestId('input')
    await userEvent.type(inputs[0], 'test-kw')
    await userEvent.type(inputs[1], 'Test KW')
    await userEvent.type(inputs[3], 'industry')

    // Click save
    const saveBtn = screen.getByText('debugConfig.save')
    await userEvent.click(saveBtn)

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled()
    })
  })

  it('shows delete confirmation dialog', async () => {
    render(
      <BrowserRouter>
        <SystemSettingsKeywordsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC')).toBeInTheDocument()
    })

    const deleteButtons = screen.getAllByText('debugConfig.deleteCustomKeyword')
    await userEvent.click(deleteButtons[0])

    expect(screen.getByText('debugConfig.confirmDelete')).toBeInTheDocument()
  })

  it('deletes a custom keyword', async () => {
    const { toast } = await import('sonner')
    requestJsonMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/config/custom-keywords/') && init?.method === 'DELETE') return Promise.resolve({ success: true })
      if (url === '/api/config/custom-keywords') return Promise.resolve(mockCustomKeywords)
      if (url === '/api/industry/brands') return Promise.resolve(mockBrandKeywords)
      return Promise.resolve({})
    })

    render(
      <BrowserRouter>
        <SystemSettingsKeywordsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC')).toBeInTheDocument()
    })

    const deleteButtons = screen.getAllByText('debugConfig.deleteCustomKeyword')
    await userEvent.click(deleteButtons[0])

    // Confirm delete
    const confirmDeleteBtn = screen.getAllByText('debugConfig.deleteCustomKeyword').pop()!
    await userEvent.click(confirmDeleteBtn)

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled()
    })
  })

  it('refreshes data on button click', async () => {
    render(
      <BrowserRouter>
        <SystemSettingsKeywordsPage />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC')).toBeInTheDocument()
    })

    const refreshBtn = screen.getByText('Refresh')
    await userEvent.click(refreshBtn)

    // requestJson should be called again
    await waitFor(() => {
      expect(requestJsonMock.mock.calls.length).toBeGreaterThan(2)
    })
  })
})
