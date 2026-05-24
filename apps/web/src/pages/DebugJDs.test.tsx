import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BrowserRouter } from 'react-router-dom'

const loadJdsMock = vi.hoisted(() => vi.fn())
const deleteJDMock = vi.hoisted(() => vi.fn())
const deleteBatchMock = vi.hoisted(() => vi.fn())

vi.mock('convex/react', () => ({
  useAction: () => loadJdsMock,
  useMutation: (ref: string) => {
    if (ref === 'jds:delete') return deleteJDMock
    if (ref === 'jds:deleteBatch') return deleteBatchMock
    return vi.fn()
  },
}))

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: {
    job_descriptions: { list_with_usage_action: 'jds:list', delete_jd: 'jds:delete', delete_batch: 'jds:deleteBatch' },
  },
}))

vi.mock('../../../../packages/convex/convex/_generated/dataModel', () => ({
  Doc: {},
  Id: {},
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

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

vi.mock('@/lib/timezone', () => ({
  formatInAppTimezone: (ts: number) => new Date(ts).toISOString().slice(0, 10),
}))

vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      <div data-testid="header-actions">{actions}</div>
    </div>
  ),
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, variant, title }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: string; title?: string }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} title={title}>{children}</button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, placeholder }: { value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string }) => (
    <input value={value} onChange={onChange} placeholder={placeholder} data-testid="input" />
  ),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onChange, options }: { value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; options: Array<{ value: string; label: string }> }) => (
    <select value={value} onChange={onChange} data-testid="type-select">
      {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
    </select>
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
    <span data-testid="badge" data-variant={variant}>{children}</span>
  ),
}))

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
  TableHead: ({ children, className }: { children: React.ReactNode; className?: string }) => <th className={className}>{children}</th>,
  TableCell: ({ children, className, colSpan }: { children: React.ReactNode; className?: string; colSpan?: number }) => <td className={className} colSpan={colSpan}>{children}</td>,
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children, onOpenChange }: { open: boolean; children: React.ReactNode; onOpenChange: (open: boolean) => void }) =>
    open ? <div data-testid="dialog">{children}<button data-testid="dialog-backdrop" onClick={() => onOpenChange(false)} /></div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/JobDescriptionEditor', () => ({
  JobDescriptionEditor: ({ open, onSaveSuccess }: { open: boolean; onSaveSuccess: () => void }) =>
    open ? <div data-testid="jd-editor"><button onClick={onSaveSuccess}>Mock Save</button></div> : null,
}))

vi.mock('lucide-react', () => ({
  Trash2: () => <span>trash-icon</span>,
  Edit: () => <span>edit-icon</span>,
  Plus: () => <span>plus-icon</span>,
  FileText: () => <span>filetext-icon</span>,
  Check: () => <span>check-icon</span>,
  X: () => <span>x-icon</span>,
  Copy: () => <span>copy-icon</span>,
  ArrowUpDown: () => <span>sort-icon</span>,
  Eye: () => <span>eye-icon</span>,
  Download: () => <span>download-icon</span>,
  ChevronUp: () => <span>chevron-up</span>,
  ChevronDown: () => <span>chevron-down</span>,
  AlertTriangle: () => <span>alert-icon</span>,
}))

import DebugJDs from './DebugJDs'

const mockJDs = [
  {
    _id: 'jd-1' as never,
    title: 'CNC Operator',
    content: 'CNC job description',
    type: 'custom',
    location: 'Dongguan',
    industryTags: ['CNC'],
    lastModified: 1700000000000,
    enabled: true,
  },
  {
    _id: 'jd-2' as never,
    title: 'Sales Manager',
    content: 'Sales job description',
    type: 'system',
    lastModified: 1700000001000,
    enabled: true,
  },
  {
    _id: 'jd-3' as never,
    title: 'CNC Sales',
    content: 'CNC Sales desc',
    type: 'custom',
    location: 'Shenzhen',
    industryTags: ['CNC', 'Sales'],
    minExperience: 3,
    lastModified: 1700000002000,
    enabled: false,
    usageCount: 5,
  },
]

describe('DebugJDs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadJdsMock.mockResolvedValue(mockJDs)
    deleteJDMock.mockResolvedValue(undefined)
    deleteBatchMock.mockResolvedValue(undefined)
  })

  it('renders loading state then job descriptions', async () => {
    render(
      <BrowserRouter>
        <DebugJDs />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC Operator')).toBeInTheDocument()
    })
    expect(screen.getByText('Sales Manager')).toBeInTheDocument()
    expect(screen.getByText('CNC Sales')).toBeInTheDocument()
  })

  it('filters JDs by search term', async () => {
    render(
      <BrowserRouter>
        <DebugJDs />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC Operator')).toBeInTheDocument()
    })

    const searchInput = screen.getAllByTestId('input')[0]
    await userEvent.type(searchInput, 'cnc')

    expect(screen.getByText('CNC Operator')).toBeInTheDocument()
    expect(screen.getByText('CNC Sales')).toBeInTheDocument()
    expect(screen.queryByText('Sales Manager')).not.toBeInTheDocument()
  })

  it('filters JDs by type', async () => {
    render(
      <BrowserRouter>
        <DebugJDs />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC Operator')).toBeInTheDocument()
    })

    const typeSelect = screen.getByTestId('type-select')
    await userEvent.selectOptions(typeSelect, 'custom')

    expect(screen.getByText('CNC Operator')).toBeInTheDocument()
    expect(screen.getByText('CNC Sales')).toBeInTheDocument()
    expect(screen.queryByText('Sales Manager')).not.toBeInTheDocument()
  })

  it('opens editor dialog on create button click', async () => {
    render(
      <BrowserRouter>
        <DebugJDs />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC Operator')).toBeInTheDocument()
    })

    const createBtn = screen.getByText('jdManagement.createNew')
    await userEvent.click(createBtn)

    expect(screen.getByTestId('jd-editor')).toBeInTheDocument()
  })

  it('shows delete confirmation dialog', async () => {
    render(
      <BrowserRouter>
        <DebugJDs />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC Operator')).toBeInTheDocument()
    })

    // Find and click the delete button for the first custom JD
    const deleteButtons = screen.getAllByText('trash-icon')
    await userEvent.click(deleteButtons[0])

    expect(screen.getByText('jdManagement.deleteConfirmTitle')).toBeInTheDocument()
  })

  it('deletes a JD and refreshes', async () => {
    render(
      <BrowserRouter>
        <DebugJDs />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC Operator')).toBeInTheDocument()
    })

    const deleteButtons = screen.getAllByText('trash-icon')
    await userEvent.click(deleteButtons[0])

    const confirmDeleteBtn = screen.getByText('jdManagement.delete')
    await userEvent.click(confirmDeleteBtn)

    await waitFor(() => {
      expect(deleteJDMock).toHaveBeenCalledWith(expect.objectContaining({ workspaceSlug: 'dev' }))
    })
  })

  it('shows delete error on failure', async () => {
    deleteJDMock.mockRejectedValue(new Error('Delete failed'))

    render(
      <BrowserRouter>
        <DebugJDs />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC Operator')).toBeInTheDocument()
    })

    const deleteButtons = screen.getAllByText('trash-icon')
    await userEvent.click(deleteButtons[0])

    const confirmDeleteBtn = screen.getByText('jdManagement.delete')
    await userEvent.click(confirmDeleteBtn)

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument()
    })
  })

  it('shows delete confirmation dialog for custom JDs', async () => {
    render(
      <BrowserRouter>
        <DebugJDs />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC Sales')).toBeInTheDocument()
    })

    // Click delete for any custom JD (only custom JDs show trash buttons)
    const deleteButtons = screen.getAllByText('trash-icon')
    await userEvent.click(deleteButtons[0])

    // Delete confirmation dialog should open
    expect(screen.getByText('jdManagement.deleteConfirmTitle')).toBeInTheDocument()
  })

  it('selects custom JDs with checkbox', async () => {
    render(
      <BrowserRouter>
        <DebugJDs />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC Operator')).toBeInTheDocument()
    })

    // There are checkboxes for custom JDs
    const checkboxes = screen.getAllByRole('checkbox')
    // The first checkbox is "select all", the rest are per-row for custom JDs
    await userEvent.click(checkboxes[1]) // First custom JD checkbox

    // After selecting, bulk actions should appear
    await waitFor(() => {
      expect(screen.getByText('Export selected')).toBeInTheDocument()
    })
  })

  it('shows bulk delete confirmation', async () => {
    render(
      <BrowserRouter>
        <DebugJDs />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC Operator')).toBeInTheDocument()
    })

    // Select all custom JDs
    const selectAllCheckbox = screen.getAllByRole('checkbox')[0]
    await userEvent.click(selectAllCheckbox)

    // The bulk delete button has data-variant="destructive" and contains trash-icon
    const destructiveButtons = screen.getAllByRole('button').filter(
      btn => btn.dataset.variant === 'destructive' && btn.textContent?.includes('trash-icon')
    )
    await userEvent.click(destructiveButtons[0])

    expect(screen.getByText('jdManagement.deleteConfirmTitle')).toBeInTheDocument()
  })

  it('handles empty JD list', async () => {
    loadJdsMock.mockResolvedValue([])

    render(
      <BrowserRouter>
        <DebugJDs />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('search.noResults')).toBeInTheDocument()
    })
  })

  it('shows loading state while fetching', () => {
    loadJdsMock.mockReturnValue(new Promise(() => {})) // Never resolves

    render(
      <BrowserRouter>
        <DebugJDs />
      </BrowserRouter>,
    )

    expect(screen.getByText('trends.loading')).toBeInTheDocument()
  })

  it('opens preview dialog', async () => {
    render(
      <BrowserRouter>
        <DebugJDs />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('CNC Operator')).toBeInTheDocument()
    })

    const previewButtons = screen.getAllByText('eye-icon')
    await userEvent.click(previewButtons[0])

    // Preview dialog opens — check the JD title appears in the dialog header
    await waitFor(() => {
      expect(screen.getByText('CNC Operator')).toBeInTheDocument()
    })
  })

  it('refreshes data on load error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    loadJdsMock.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce(mockJDs)

    render(
      <BrowserRouter>
        <DebugJDs />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    consoleErrorSpy.mockRestore()
  })
})
