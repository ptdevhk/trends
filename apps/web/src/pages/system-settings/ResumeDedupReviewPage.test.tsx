import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const queryMock = vi.hoisted(() => vi.fn())

vi.mock('convex/react', () => ({
  useQuery: (ref: string, args: unknown) => {
    if (args === 'skip') return undefined
    return queryMock(ref, args)
  },
}))

vi.mock('../../../../../packages/convex/convex/_generated/api', () => ({
  api: {
    resume_dedup: {
      suggestMergeCandidates: 'dedup:suggest',
    },
  },
}))

vi.mock('lucide-react', () => ({
  Loader2: () => <svg data-testid="loader-icon" />,
}))

const mockT = (key: string, opts?: string | Record<string, unknown>): string => {
  if (typeof opts === 'string') return opts
  if (opts && typeof opts === 'object' && 'defaultValue' in opts) {
    const { defaultValue, ...rest } = opts as Record<string, unknown>
    return String(defaultValue).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(rest[name] ?? ''))
  }
  return key
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

import SystemSettingsResumeDedupReviewPage from './ResumeDedupReviewPage'

const emptyResult = { candidates: [], scannedBlocks: 0 }

const graceCandidate = {
  score: 2.5,
  evidence: ['shared email: grace@example.com'],
  left: {
    resumeId: 'resume-c',
    name: 'Grace Hopper',
    source: '51job',
    externalId: 'ext-3',
    identityKey: 'externalId:ext-3',
    contactSignals: { email: 'grace@example.com' },
  },
  right: {
    resumeId: 'resume-d',
    name: 'Grace Hopper',
    source: 'seek',
    externalId: 'ext-4',
    identityKey: 'externalId:ext-4',
    contactSignals: { email: 'grace@example.com' },
  },
}

const candidateResult = {
  scannedBlocks: 4,
  candidates: [
    {
      score: 5.5,
      evidence: ['shared email: ada@example.com', 'shared phone: 13800138000', 'shared name: Ada Lovelace'],
      left: {
        resumeId: 'resume-a',
        name: 'Ada Lovelace',
        source: 'job5156',
        externalId: 'ext-1',
        identityKey: 'externalId:ext-1',
        contactSignals: { email: 'ada@example.com', phone: '13800138000' },
      },
      right: {
        resumeId: 'resume-b',
        name: 'Ada Lovelace',
        source: 'seek',
        externalId: 'ext-2',
        identityKey: 'externalId:ext-2',
        contactSignals: { email: 'ada@example.com', phone: '13800138000' },
      },
    },
  ],
}

const twoCandidateResult = {
  scannedBlocks: 4,
  candidates: [...candidateResult.candidates, graceCandidate],
}

describe('SystemSettingsResumeDedupReviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the loading state while the query is pending', () => {
    queryMock.mockReturnValue(undefined)
    render(<SystemSettingsResumeDedupReviewPage />)
    expect(screen.getByTestId('resume-dedup-loading')).toBeInTheDocument()
  })

  it('renders the empty state when there are no suggestions', () => {
    queryMock.mockReturnValue(emptyResult)
    render(<SystemSettingsResumeDedupReviewPage />)
    expect(screen.getByTestId('resume-dedup-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('resume-dedup-candidate-row')).not.toBeInTheDocument()
  })

  it('renders suggestion rows with score, evidence, and both resume summaries', () => {
    queryMock.mockReturnValue(candidateResult)
    render(<SystemSettingsResumeDedupReviewPage />)

    expect(queryMock).toHaveBeenCalledWith('dedup:suggest', {})

    const rows = screen.getAllByTestId('resume-dedup-candidate-row')
    expect(rows).toHaveLength(1)

    expect(rows[0]).toHaveTextContent('5.5')
    expect(rows[0]).toHaveTextContent('shared email: ada@example.com')
    expect(rows[0]).toHaveTextContent('shared phone: 13800138000')
    expect(rows[0]).toHaveTextContent('shared name: Ada Lovelace')

    expect(rows[0]).toHaveTextContent('job5156')
    expect(rows[0]).toHaveTextContent('ext-1')
    expect(rows[0]).toHaveTextContent('externalId:ext-1')
    expect(rows[0]).toHaveTextContent('seek')
    expect(rows[0]).toHaveTextContent('ext-2')
    expect(rows[0]).toHaveTextContent('externalId:ext-2')

    expect(screen.getByText(/Blocking keys scanned: 4/)).toBeInTheDocument()
  })

  it('renders dash placeholders for resumes without a name, externalId, or identityKey', () => {
    queryMock.mockReturnValue({
      scannedBlocks: 2,
      candidates: [
        {
          score: 2,
          evidence: ['shared phone: 13900139000'],
          left: {
            resumeId: 'resume-c',
            name: null,
            source: '51job',
            externalId: null,
            identityKey: null,
          },
          right: {
            resumeId: 'resume-d',
            name: 'Grace Hopper',
            source: 'seek',
            externalId: 'ext-9',
            identityKey: 'externalId:ext-9',
            contactSignals: { email: 'grace@example.com' },
          },
        },
      ],
    })
    render(<SystemSettingsResumeDedupReviewPage />)

    const row = screen.getByTestId('resume-dedup-candidate-row')
    expect(row).toHaveTextContent('grace@example.com')
    expect(row).not.toHaveTextContent('null')
  })

  it('filters candidate pairs by minimum score threshold', () => {
    queryMock.mockReturnValue(twoCandidateResult)
    render(<SystemSettingsResumeDedupReviewPage />)
    expect(screen.getAllByTestId('resume-dedup-candidate-row')).toHaveLength(2)

    fireEvent.change(screen.getByTestId('resume-dedup-min-score'), { target: { value: '4' } })

    const rows = screen.getAllByTestId('resume-dedup-candidate-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Ada Lovelace')
    expect(rows[0]).not.toHaveTextContent('Grace Hopper')
    expect(screen.getByTestId('resume-dedup-count')).toHaveTextContent('Showing 1 of 2 candidate pairs')
  })

  it('searches candidate pairs by name or contact signal', () => {
    queryMock.mockReturnValue(twoCandidateResult)
    render(<SystemSettingsResumeDedupReviewPage />)

    fireEvent.change(screen.getByTestId('resume-dedup-search-input'), { target: { value: 'hopper' } })

    const rows = screen.getAllByTestId('resume-dedup-candidate-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Grace Hopper')
    expect(rows[0]).not.toHaveTextContent('Ada Lovelace')
  })

  it('shows the filter empty state with a clear action when nothing matches', () => {
    queryMock.mockReturnValue(twoCandidateResult)
    render(<SystemSettingsResumeDedupReviewPage />)

    fireEvent.change(screen.getByTestId('resume-dedup-search-input'), { target: { value: 'nobody' } })

    expect(screen.getByTestId('resume-dedup-no-matches')).toBeInTheDocument()
    expect(screen.queryByTestId('resume-dedup-candidate-row')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('resume-dedup-clear-filter'))

    expect(screen.queryByTestId('resume-dedup-no-matches')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('resume-dedup-candidate-row')).toHaveLength(2)
  })
})
