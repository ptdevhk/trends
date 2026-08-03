import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { EvidenceRecoveryPanel } from './EvidenceRecoveryPanel'

const research = {
  featureEnabled: true,
  active: null,
  history: [],
}

const candidate = {
  candidateFingerprint: 'candidate-vision',
  proposalId: 'proposal-vision',
  normalizedLegalName: 'VISION MACHINE TOOLS SDN. BHD.',
  jurisdiction: 'MY',
  sourceIds: ['source-1'],
  confidence: 0.88,
  conflictCodes: [],
  reviewState: 'candidate' as const,
  extractionVersion: 'legal-name-v1',
  createdAt: 1,
  updatedAt: 2,
}

describe('EvidenceRecoveryPanel', () => {
  it('queues one exact admin-review request and reloads progress', async () => {
    const requestJson = vi.fn().mockResolvedValue({ success: true })
    const onReload = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <EvidenceRecoveryPanel
        proposalId="proposal-vision"
        proposalUpdatedAt={10}
        employerSurface="Vision Machine Tools"
        research={research}
        identityCandidates={[]}
        requestJson={requestJson}
        onReload={onReload}
      />,
    )
    await user.click(screen.getByTestId('queue-industry-evidence-research'))
    await waitFor(() => expect(requestJson).toHaveBeenCalledWith(
      '/api/company-industry-proposals/proposal-vision/research-requests',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ origin: 'admin_review' }) }),
    ))
    expect(onReload).toHaveBeenCalled()
  })

  it('maps a fetched candidate without issuing an approval request', async () => {
    const requestJson = vi.fn().mockResolvedValue({ success: true })
    const onReload = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <EvidenceRecoveryPanel
        proposalId="proposal-vision"
        proposalUpdatedAt={10}
        employerSurface="Vision Machine Tools"
        research={research}
        identityCandidates={[candidate]}
        requestJson={requestJson}
        onReload={onReload}
      />,
    )
    await user.click(screen.getByRole('button', { name: /VISION MACHINE TOOLS/i }))
    await user.click(screen.getByRole('button', { name: /Create provisional identity/i }))
    await waitFor(() => expect(requestJson).toHaveBeenCalledWith(
      '/api/company-industry-proposals/proposal-vision/identity-resolution',
      expect.objectContaining({ method: 'POST' }),
    ))
    expect(requestJson.mock.calls.some(([path]) => String(path).includes('/approve'))).toBe(false)
  })

  it('shows the latest completed request when no request is active', () => {
    render(
      <EvidenceRecoveryPanel
        proposalId="proposal-vision"
        proposalUpdatedAt={10}
        employerSurface="Vision Machine Tools"
        research={{
          ...research,
          history: [{
            requestId: 'request-vision',
            proposalId: 'proposal-vision',
            origin: 'admin_review' as const,
            state: 'completed' as const,
            priority: 60,
            requestedAt: 1,
            demandCount: 1,
            attemptCount: 1,
            updatedAt: 2,
            canRetry: false,
            canCancel: false,
            lastOutcome: 'Evidence is ready for review',
          }],
        }}
        identityCandidates={[]}
        requestJson={vi.fn().mockResolvedValue({ success: true })}
        onReload={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    expect(screen.getAllByText('Evidence ready for review')).toHaveLength(2)
    expect(screen.getByText('Latest worker note: Evidence is ready for review')).toBeInTheDocument()
  })
})
