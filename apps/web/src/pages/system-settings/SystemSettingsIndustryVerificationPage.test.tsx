import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SystemSettingsIndustryVerificationPage } from './SystemSettingsIndustryVerificationPage'

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
      if (path.startsWith('/api/company-industry-proposals?')) {
        return Promise.resolve({ success: true, items: [proposal] })
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
      return Promise.resolve({ success: true })
    })
  })

  it('loads the proposal queue, evidence, current verdict, and history', async () => {
    render(<SystemSettingsIndustryVerificationPage />)

    expect((await screen.findAllByText('ACME CNC')).length).toBeGreaterThanOrEqual(2)
    expect(await screen.findByText('CNC products')).toBeInTheDocument()
    expect(screen.getByText('Current approved truth.')).toBeInTheDocument()
    expect(screen.getAllByText('revision-1')).toHaveLength(2)
  })

  it('approves selected evidence into an immutable revision', async () => {
    const user = userEvent.setup()
    render(<SystemSettingsIndustryVerificationPage />)

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
    render(<SystemSettingsIndustryVerificationPage />)

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
})
