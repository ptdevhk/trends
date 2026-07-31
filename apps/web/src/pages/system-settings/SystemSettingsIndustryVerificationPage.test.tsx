import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SystemSettingsIndustryVerificationPage } from './SystemSettingsIndustryVerificationPage'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dev/settings/industry-verification']}>
      <SystemSettingsIndustryVerificationPage />
    </MemoryRouter>,
  )
}

const coverageSummary = {
  generatedAt: 1_700_000_000_000,
  workspaceSlug: 'dev',
  proposalsByStatus: {
    new: 427,
    researching: 0,
    ready_for_review: 0,
    needs_more_evidence: 60,
    approved: 16,
    rejected: 3,
    superseded: 3,
  },
  openTotal: 487,
  openWithSources: 0,
  openWithoutSources: 487,
  emptyEvidenceBottleneck: true,
  readyBacklogBottleneck: true,
  resumes: { total: 83, withVerifiedEvidence: 1 },
  profiles: { total: 9, verified: 4, rejected: 5 },
  maintenance: {
    latest: {
      runId: 'run-fail',
      status: 'failed',
      triggerSource: 'restore',
      failureMessage: 'fetch failed',
      operatorSummary: 'failed; worker unreachable.',
      startedAt: 10,
      counts: {
        proposalsResearched: 0,
        readyCreated: 0,
        sourcesDemoted: 0,
        freshnessChecked: 0,
        freshnessRefreshed: 0,
        errors: 0,
      },
    },
    lastUseful: {
      runId: 'run-useful',
      status: 'completed',
      triggerSource: 'manual',
      operatorSummary: 'completed; 0 ready, 0 demoted, 0 refreshed.',
      startedAt: 5,
      counts: {
        proposalsResearched: 20,
        readyCreated: 0,
        sourcesDemoted: 0,
        freshnessChecked: 0,
        freshnessRefreshed: 0,
        errors: 0,
      },
    },
    lastFailed: {
      runId: 'run-fail',
      status: 'failed',
      triggerSource: 'restore',
      failureMessage: 'fetch failed',
      operatorSummary: 'failed; worker unreachable.',
      startedAt: 10,
      counts: {
        proposalsResearched: 0,
        readyCreated: 0,
        sourcesDemoted: 0,
        freshnessChecked: 0,
        freshnessRefreshed: 0,
        errors: 0,
      },
    },
  },
}

const { requestJsonMock, toastSuccessMock, tMock } = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  tMock: vi.fn((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tMock,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: vi.fn(),
  },
}))

vi.mock('@/pages/system-settings/lib', async () => {
  const actual = await vi.importActual<typeof import('@/pages/system-settings/lib')>('@/pages/system-settings/lib')
  return {
    ...actual,
    useSettingsRequestJson: () => ({ requestJson: requestJsonMock }),
  }
})

const proposal = {
  _id: 'proposal-row',
  proposalId: 'proposal-1',
  companyKey: 'acme-cnc',
  triggerReasons: ['scheduled_freshness'],
  priority: 90,
  suggestedIndustryClass: 'cnc',
  suggestedVerificationLevel: 'verified',
  materialChangeSummary: 'Official catalog changed.',
  status: 'ready_for_review',
  createdAt: 1,
  updatedAt: 2,
}

const source = {
  _id: 'source-row',
  sourceId: 'source-1',
  companyKey: 'acme-cnc',
  proposalId: 'proposal-1',
  url: 'https://acme.example/products/cnc',
  sourceDomain: 'acme.example',
  sourceType: 'official_site',
  trustTier: 'primary',
  title: 'CNC products',
  evidenceExcerpt: 'Official catalog confirms CNC machine tools.',
  fetchStatus: 'fetched',
  reviewStatus: 'unreviewed',
  sourceState: 'active',
  createdAt: 1,
  updatedAt: 2,
}

describe('SystemSettingsIndustryVerificationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requestJsonMock.mockImplementation((path: string) => {
      if (path === '/api/company-industry-coverage') {
        return Promise.resolve({ success: true, item: coverageSummary })
      }
      if (path.startsWith('/api/company-industry-proposals?')) {
        return Promise.resolve({ success: true, items: [proposal] })
      }
      if (path.startsWith('/api/company-industry-profiles')) {
        return Promise.resolve({
          success: true,
          items: [
            {
              companyKey: 'eonmetall-group',
              industryClass: 'cnc',
              verificationLevel: 'verified',
            },
          ],
        })
      }
      if (path === '/api/company-industry-evidence-sources?proposalId=proposal-1') {
        return Promise.resolve({ success: true, items: [source] })
      }
      if (path === '/api/company-industry-bundles/acme-cnc') {
        return Promise.resolve({
          success: true,
          profile: {
            companyKey: 'acme-cnc',
            industryClass: 'cnc',
            verificationLevel: 'verified',
            currentRevisionId: 'revision-1',
          },
          revisions: [
            {
              revisionId: 'revision-1',
              verificationLevel: 'verified',
              industryClass: 'cnc',
              evidenceSummary: 'Current approved truth.',
              reviewedBy: 'reviewer-1',
              reviewedAt: 100,
            },
          ],
          sources: [],
        })
      }
      if (path === '/api/company-industry-bundles/eonmetall-group') {
        return Promise.resolve({
          success: true,
          profile: {
            companyKey: 'eonmetall-group',
            industryClass: 'cnc',
            verificationLevel: 'verified',
            currentRevisionId: 'my-rev-eonmetall-cnc-20260730',
          },
          revisions: [
            {
              revisionId: 'my-rev-eonmetall-cnc-20260730',
              verificationLevel: 'verified',
              industryClass: 'cnc',
              evidenceSummary:
                'Bursa-listed Eonmetall Group Bhd: flat steel products and CNC machinery.',
              reviewedBy: 'bootstrap',
              reviewedAt: 1_753_900_000_000,
            },
          ],
          sources: [
            {
              sourceId: 'src-star',
              companyKey: 'eonmetall-group',
              url: 'https://www.thestar.com.my/',
              sourceDomain: 'thestar.com.my',
              sourceType: 'reporting',
              trustTier: 'corroborating',
              title: 'The Star',
              reviewStatus: 'approved',
              sourceState: 'active',
            },
          ],
        })
      }
      // Maintenance history optional
      if (path.startsWith('/api/company-industry-maintenance-runs')) {
        return Promise.resolve({ success: true, items: [] })
      }
      return Promise.resolve({ success: true })
    })
  })

  it('loads the proposal queue, evidence, current verdict, and history', async () => {
    renderPage()

    expect((await screen.findAllByText('ACME CNC')).length).toBeGreaterThanOrEqual(2)
    expect(await screen.findByText('CNC products')).toBeInTheDocument()
    expect(screen.getByText('Current approved truth.')).toBeInTheDocument()
    expect(screen.getAllByText('revision-1')).toHaveLength(2)
  })

  it('shows coverage pipeline, empty-evidence bottleneck, and maintenance health', async () => {
    renderPage()

    expect(await screen.findByTestId('industry-coverage-health')).toBeInTheDocument()
    expect(screen.getByTestId('industry-coverage-bottleneck-empty')).toBeInTheDocument()
    expect(screen.getByTestId('industry-coverage-bottleneck-failed')).toBeInTheDocument()
    expect(screen.getByTestId('industry-coverage-status-new')).toHaveTextContent('427')
    expect(screen.getByTestId('industry-coverage-status-needs_more_evidence')).toHaveTextContent(
      '60',
    )
    expect(screen.getByTestId('industry-coverage-status-ready_for_review')).toHaveTextContent('0')
    expect(screen.getByTestId('industry-coverage-open-sources')).toHaveTextContent('0')
    expect(screen.getByTestId('industry-coverage-open-sources')).toHaveTextContent('487')
    expect(screen.getByTestId('industry-coverage-resumes')).toHaveTextContent('1')
    expect(screen.getByTestId('industry-coverage-resumes')).toHaveTextContent('83')
    expect(screen.getByTestId('industry-coverage-maintenance')).toHaveTextContent(
      'researched 20, ready 0',
    )
    expect(screen.getByTestId('industry-coverage-bottleneck-failed')).toHaveTextContent(
      'worker unreachable',
    )
  })

  it('does not surface a historical failure after a newer run completes', async () => {
    const defaultRequestJson = requestJsonMock.getMockImplementation()
    requestJsonMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/company-industry-coverage') {
        return Promise.resolve({
          success: true,
          item: {
            ...coverageSummary,
            maintenance: {
              ...coverageSummary.maintenance,
              latest: {
                ...coverageSummary.maintenance.lastUseful,
                runId: 'run-success',
                status: 'completed',
                startedAt: 20,
              },
              lastFailed: {
                ...coverageSummary.maintenance.lastFailed,
                runId: 'run-old-fail',
                startedAt: 10,
              },
            },
          },
        })
      }
      return defaultRequestJson?.(path, init) ?? Promise.resolve({ success: true })
    })

    renderPage()

    expect(await screen.findByTestId('industry-coverage-health')).toBeInTheDocument()
    expect(screen.queryByTestId('industry-coverage-bottleneck-failed')).not.toBeInTheDocument()
    expect(screen.getByTestId('industry-coverage-maintenance')).toHaveTextContent(
      'completed · manual · researched 20, ready 0',
    )
  })

  it('looks up an approved profile by companyKey and shows bundle sources', async () => {
    const user = userEvent.setup()
    renderPage()

    // Verified quick-pick chip from profiles list
    expect(await screen.findByTestId('industry-lookup-chip-eonmetall-group')).toBeInTheDocument()

    await user.type(screen.getByTestId('industry-lookup-company-key'), 'eonmetall-group')
    await user.click(screen.getByTestId('industry-lookup-submit'))

    await waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalledWith(
        '/api/company-industry-bundles/eonmetall-group',
      )
    })
    expect(await screen.findByTestId('industry-lookup-result')).toBeInTheDocument()
    // Summary appears in the result body and revision history.
    expect(screen.getAllByText(/Bursa-listed Eonmetall Group Bhd/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('my-rev-eonmetall-cnc-20260730').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('industry-lookup-source-src-star')).toBeInTheDocument()
    expect(screen.getByText('https://www.thestar.com.my/')).toBeInTheDocument()
  })

  it('approves selected evidence into an immutable revision', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('CNC products')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Evidence summary'))
    await user.type(screen.getByLabelText('Evidence summary'), 'Reviewed official evidence.')
    await user.type(screen.getByLabelText('Decision reason'), 'Primary source confirmed.')
    await user.click(screen.getByRole('button', { name: 'Approve revision' }))

    await waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalledWith(
        '/api/company-industry-proposals/proposal-1/approve',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    const call = requestJsonMock.mock.calls.find(
      ([path, init]) => path.endsWith('/approve') && init?.method === 'POST',
    )
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      expectedCurrentRevisionId: 'revision-1',
      verificationLevel: 'verified',
      industryClass: 'cnc',
      approvedSourceIds: ['source-1'],
      evidenceSummary: 'Reviewed official evidence.',
      decisionReason: 'Primary source confirmed.',
    })
    expect(toastSuccessMock).toHaveBeenCalledWith('Industry verdict revision approved')
  })

  it('requests more evidence without changing current truth', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('CNC products')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Request more evidence' }))

    await waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalledWith(
        '/api/company-industry-proposals/proposal-1/resolve',
        {
          method: 'POST',
          body: JSON.stringify({
            resolution: 'needs_more_evidence',
            reviewNote: 'Reviewer requested additional evidence.',
          }),
        },
      )
    })
  })

  it('renders run history section with recent maintenance runs', async () => {
    requestJsonMock.mockImplementation((path: string) => {
      if (path.startsWith('/api/company-industry-proposals?')) {
        return Promise.resolve({ success: true, items: [proposal] })
      }
      if (path === '/api/company-industry-evidence-sources?proposalId=proposal-1') {
        return Promise.resolve({ success: true, items: [source] })
      }
      if (path === '/api/company-industry-bundles/acme-cnc') {
        return Promise.resolve({ success: true, profile: { companyKey: 'acme-cnc', industryClass: 'cnc', verificationLevel: 'verified', currentRevisionId: 'revision-1' }, revisions: [], sources: [] })
      }
      if (path === '/api/company-industry-maintenance-runs?limit=20') {
        return Promise.resolve({
          success: true,
          items: [
            { runId: 'run-h1', triggerSource: 'manual', status: 'completed', operatorSummary: 'completed; 1 ready.', startedAt: 1000 },
          ],
        })
      }
      return Promise.resolve({ success: true })
    })
    renderPage()

    expect(await screen.findByText('completed; 1 ready.')).toBeInTheDocument()
  })

  it('shows empty-queue hint pointing at run history when queue is empty', async () => {
    requestJsonMock.mockImplementation((path: string) => {
      if (path.startsWith('/api/company-industry-proposals?')) {
        return Promise.resolve({ success: true, items: [] })
      }
      if (path === '/api/company-industry-maintenance-runs?limit=20') {
        return Promise.resolve({
          success: true,
          items: [
            { runId: 'run-h2', triggerSource: 'restore', status: 'completed', operatorSummary: 'completed; 0 ready.', startedAt: 2000 },
          ],
        })
      }
      return Promise.resolve({ success: true })
    })
    renderPage()

    // Queue empty hint is shown.
    expect(await screen.findByText('No proposals ready for review.')).toBeInTheDocument()
    // Run history still renders.
    expect(await screen.findByText('completed; 0 ready.')).toBeInTheDocument()
  })
})
