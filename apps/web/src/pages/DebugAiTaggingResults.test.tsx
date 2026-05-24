import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BrowserRouter } from 'react-router-dom'

const enqueueBatchMock = vi.hoisted(() => vi.fn())
const useQueryMock = vi.hoisted(() => vi.fn())
const useConvexResumesMock = vi.hoisted(() => vi.fn())

vi.mock('convex/react', () => ({
  useMutation: () => enqueueBatchMock,
  useQuery: (ref: string, args: unknown) => {
    if (args === 'skip') return undefined
    return useQueryMock(ref, args)
  },
}))

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: {
    ai_tagging_results: {
      enqueueBatch: 'ai:enqueue',
      getSummary: 'ai:summary',
      listForCompare: 'ai:compare',
    },
  },
}))

vi.mock('@trends/shared', () => ({
  sanitizeResumeRecordForSurface: (content: Record<string, unknown>) => content,
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
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

vi.mock('@/contexts/ResumeFieldUsagePolicyContext', () => ({
  useResumeFieldUsagePolicy: () => ({ name: 'show', jobIntention: 'show' }),
}))

vi.mock('@/hooks/useConvexResumes', () => ({
  useConvexResumes: (...args: unknown[]) => useConvexResumesMock(...args),
}))

vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
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
  Input: ({ value, onChange, placeholder }: { value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string }) => (
    <input value={value} onChange={onChange} placeholder={placeholder} />
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
    <span data-testid="badge" data-variant={variant}>{children}</span>
  ),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onChange, options }: { value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; options: Array<{ value: string; label: string }> }) => (
    <select value={value} onChange={onChange} data-testid="status-select">
      {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
    </select>
  ),
}))

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
  TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableCell: ({ children, className }: { children: React.ReactNode; className?: string }) => <td className={className}>{children}</td>,
}))

vi.mock('@/components/JobDescriptionSelect', () => ({
  JobDescriptionSelect: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} data-testid="jd-select">
      <option value="">None</option>
      <option value="jd-1">CNC Operator</option>
    </select>
  ),
}))

vi.mock('lucide-react', () => ({
  Brain: () => <span>brain-icon</span>,
}))

import DebugAiTaggingResults from './DebugAiTaggingResults'

const mockResumes = [
  { resumeId: 'r1', name: 'Alice', jobIntention: 'CNC', externalId: 'ext1', ingestData: { ruleScores: { 'jd-1': 85 } } },
  { resumeId: 'r2', name: 'Bob', jobIntention: 'Sales', externalId: 'ext2', ingestData: { ruleScores: { 'jd-1': 30 } } },
]

const mockSummary = { total: 10, pending: 3, processing: 2, completed: 4, failed: 1 }

const mockCompareRows = [
  {
    ai: { _id: 'tag-1', resumeId: 'r1', status: 'completed', result: { recommendation: 'Yes', confidence: 0.9, roleFit: 'high', tags: ['CNC'], evidenceLines: ['5 years CNC experience'] }, baseline: { ruleScore: 85 } },
    resume: { _id: 'r1' } as never,
  },
  {
    ai: { _id: 'tag-2', resumeId: 'r2', status: 'pending', result: undefined, error: undefined, baseline: { ruleScore: 30 } },
    resume: { _id: 'r2' } as never,
  },
]

describe('DebugAiTaggingResults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useConvexResumesMock.mockReturnValue({ resumes: mockResumes, loading: false })
    useQueryMock.mockImplementation((ref: string) => {
      if (ref === 'ai:summary') return mockSummary
      if (ref === 'ai:compare') return mockCompareRows
      return undefined
    })
    enqueueBatchMock.mockResolvedValue({ created: 5, reused: 2, retried: 1 })
  })

  it('renders config and results sections', async () => {
    render(
      <BrowserRouter>
        <DebugAiTaggingResults />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('AI Tagging (Compare)')).toBeInTheDocument()
    })
    expect(screen.getByText('Config')).toBeInTheDocument()
    expect(screen.getByText('Enqueue')).toBeInTheDocument()
    expect(screen.getByText('Results')).toBeInTheDocument()
  })

  it('shows summary with counts', async () => {
    render(
      <BrowserRouter>
        <DebugAiTaggingResults />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText(/total 10.*pending 3.*processing 2.*completed 4.*failed 1/)).toBeInTheDocument()
    })
  })

  it('renders candidate summary with filtered counts', async () => {
    render(
      <BrowserRouter>
        <DebugAiTaggingResults />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText(/Candidates: 2 \(loaded 2\)/)).toBeInTheDocument()
    })
  })

  it('enqueues batch tagging on button click', async () => {
    render(
      <BrowserRouter>
        <DebugAiTaggingResults />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Enqueue AI Tagging')).toBeInTheDocument()
    })

    const enqueueBtn = screen.getByText('Enqueue AI Tagging')
    await userEvent.click(enqueueBtn)

    await waitFor(() => {
      expect(enqueueBatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceSlug: 'dev',
          profileKey: 'cnc-sales-strict',
          retryFailed: true,
        }),
      )
    })
  })

  it('shows error toast when profile key is empty', async () => {
    const { toast } = await import('sonner')

    render(
      <BrowserRouter>
        <DebugAiTaggingResults />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Enqueue AI Tagging')).toBeInTheDocument()
    })

    // Clear the default profileKey
    const profileKeyInput = screen.getByPlaceholderText('cnc-sales-strict')
    await userEvent.clear(profileKeyInput)

    const enqueueBtn = screen.getByText('Enqueue AI Tagging')
    await userEvent.click(enqueueBtn)

    expect(toast.error).toHaveBeenCalledWith('profileKey is required')
    expect(enqueueBatchMock).not.toHaveBeenCalled()
  })

  it('shows compare rows in table', async () => {
    render(
      <BrowserRouter>
        <DebugAiTaggingResults />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Yes (1) · high')).toBeInTheDocument()
    })
    // "Pending" appears in the table for the pending row
    expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(1)
  })

  it('renders status select with options', async () => {
    render(
      <BrowserRouter>
        <DebugAiTaggingResults />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('status-select')).toBeInTheDocument()
    })

    const statusSelect = screen.getByTestId('status-select')
    expect(statusSelect).toBeInTheDocument()
  })

  it('shows loading state for results', async () => {
    useQueryMock.mockImplementation((ref: string) => {
      if (ref === 'ai:summary') return mockSummary
      if (ref === 'ai:compare') return undefined // Loading
      return undefined
    })

    render(
      <BrowserRouter>
        <DebugAiTaggingResults />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Loading…')).toBeInTheDocument()
    })
  })

  it('shows no results message', async () => {
    useQueryMock.mockImplementation((ref: string) => {
      if (ref === 'ai:summary') return mockSummary
      if (ref === 'ai:compare') return []
      return undefined
    })

    render(
      <BrowserRouter>
        <DebugAiTaggingResults />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('No results yet.')).toBeInTheDocument()
    })
  })

  it('handles enqueue error gracefully', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    enqueueBatchMock.mockRejectedValue(new Error('Network error'))

    render(
      <BrowserRouter>
        <DebugAiTaggingResults />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Enqueue AI Tagging')).toBeInTheDocument()
    })

    const enqueueBtn = screen.getByText('Enqueue AI Tagging')
    await userEvent.click(enqueueBtn)

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to enqueue AI tagging', expect.any(Error))
    })

    consoleErrorSpy.mockRestore()
  })
})
