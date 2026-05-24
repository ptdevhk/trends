import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BrowserRouter } from 'react-router-dom'

const useQueryMock = vi.hoisted(() => vi.fn())

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}))

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: { resumes: { list: 'resumes:list' } },
}))

vi.mock('@/lib/debug-ai-score-utils', () => ({
  extractBreakdown: () => ({ overall: 85, experience: 90, skills: 80, education: 70, relevance: 88 }),
  readTextField: (obj: Record<string, unknown>, field: string) => typeof obj[field] === 'string' ? obj[field] : undefined,
}))

vi.mock('@trends/shared', () => ({
  DEBUG_AI_BREAKDOWN_LABELS: [
    { key: 'overall', labelKey: 'debugAi.overall', defaultLabel: 'Overall' },
    { key: 'experience', labelKey: 'debugAi.experience', defaultLabel: 'Experience' },
    { key: 'skills', labelKey: 'debugAi.skills', defaultLabel: 'Skills' },
  ],
  DEBUG_AI_KEYWORD_PROMPT_VARIANT: { title: 'Keyword Variant', body: 'keyword prompt body' },
  getResumeAiPromptDefinition: () => ({
    sections: { systemPrompt: 'System prompt text' },
    normalized: { userPromptTemplate: 'User prompt template' },
  }),
  isRecord: (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v),
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
    i18n: { resolvedLanguage: 'en' },
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}))

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onChange, options }: { value: string; onChange: (e: { target: { value: string } }) => void; options: Array<{ value: string; label: string }> }) => (
    <select value={value} onChange={onChange} data-testid="resume-select">
      {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
    </select>
  ),
}))

vi.mock('@/contexts/ResumeFieldUsagePolicyContext', () => ({
  useResumeFieldUsagePolicy: () => ({ name: 'show', jobIntention: 'show' }),
}))

vi.mock('lucide-react', () => ({
  Copy: () => <span>copy-icon</span>,
}))

import DebugAI from './DebugAI'

const mockResumes = [
  {
    _id: 'resume-1',
    content: { name: 'Alice', jobIntention: 'CNC Operator' },
    analysis: { score: 85 },
    analyses: undefined,
  },
  {
    _id: 'resume-2',
    content: { name: 'Bob' },
    analysis: undefined,
    analyses: undefined,
  },
]

describe('DebugAI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows skeleton while resumes are loading', () => {
    useQueryMock.mockReturnValue(undefined)

    render(
      <BrowserRouter>
        <DebugAI />
      </BrowserRouter>,
    )

    expect(screen.getByTestId('skeleton')).toBeInTheDocument()
  })

  it('renders prompt sections after data loads', async () => {
    useQueryMock.mockReturnValue(mockResumes)

    render(
      <BrowserRouter>
        <DebugAI />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('System prompt text')).toBeInTheDocument()
    })
    expect(screen.getByText('User prompt template')).toBeInTheDocument()
    expect(screen.getByText('keyword prompt body')).toBeInTheDocument()
  })

  it('renders resume selector with loaded resumes', async () => {
    useQueryMock.mockReturnValue(mockResumes)

    render(
      <BrowserRouter>
        <DebugAI />
      </BrowserRouter>,
    )

    await waitFor(() => {
      const select = screen.getByTestId('resume-select')
      expect(select).toBeInTheDocument()
    })

    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThanOrEqual(2) // placeholder + resumes
  })

  it('shows no analysis when no resume is selected', async () => {
    useQueryMock.mockReturnValue(mockResumes)

    render(
      <BrowserRouter>
        <DebugAI />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('debugAi.noAnalysis')).toBeInTheDocument()
    })
  })

  it('shows analysis JSON when a resume is selected', async () => {
    useQueryMock.mockReturnValue(mockResumes)

    render(
      <BrowserRouter>
        <DebugAI />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('resume-select')).toBeInTheDocument()
    })

    const select = screen.getByTestId('resume-select')
    await userEvent.selectOptions(select, 'resume-1')

    await waitFor(() => {
      expect(screen.getByText(/"score": 85/)).toBeInTheDocument()
    })
  })

  it('shows copy button when analysis is displayed', async () => {
    useQueryMock.mockReturnValue(mockResumes)

    render(
      <BrowserRouter>
        <DebugAI />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('resume-select')).toBeInTheDocument()
    })

    const select = screen.getByTestId('resume-select')
    await userEvent.selectOptions(select, 'resume-1')

    await waitFor(() => {
      expect(screen.getByText('Copy')).toBeInTheDocument()
    })
  })

  it('renders score breakdown bars', async () => {
    useQueryMock.mockReturnValue(mockResumes)

    render(
      <BrowserRouter>
        <DebugAI />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Overall')).toBeInTheDocument()
    })
    expect(screen.getByText('Experience')).toBeInTheDocument()
    expect(screen.getByText('Skills')).toBeInTheDocument()
  })

  it('handles empty resume list', async () => {
    useQueryMock.mockReturnValue([])

    render(
      <BrowserRouter>
        <DebugAI />
      </BrowserRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('resume-select')).toBeInTheDocument()
    })
  })
})
