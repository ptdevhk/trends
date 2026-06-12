import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PublicSharePage } from './PublicSharePage'

const { apiGetMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => apiGetMock(...args),
  },
}))

function renderPublicShare(path = '/s/public-token-1') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/s/:token" element={<PublicSharePage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('PublicSharePage', () => {
  beforeEach(() => {
    apiGetMock.mockReset()
  })

  it('fetches and renders a public-safe immutable snapshot', async () => {
    apiGetMock.mockResolvedValue({
      data: {
        success: true,
        share: {
          title: 'Public CNC sales snapshot',
          description: 'External recruiter view',
          createdAt: '2026-06-12T09:00:00.000Z',
          expiresAt: '2026-07-12T09:00:00.000Z',
          snapshot: {
            scoringMode: 'hybrid',
            promptVersion: 'prompt-v1',
            skillConfigVersion: 'skills-v1',
            modelProvider: 'openai',
            modelName: 'gpt-test',
            payload: {
              search: {
                query: 'CNC sales',
                filters: { locations: ['Malaysia'] },
              },
              results: [{
                resumeKey: 'resume-1',
                displayName: 'Candidate A',
                location: 'Kuala Lumpur',
                summary: 'Strong CNC sales background',
                score: 91,
                recommendation: 'strong_match',
                highlights: ['CNC'],
                concerns: [],
              }],
            },
          },
        },
      },
    })

    renderPublicShare()

    expect(apiGetMock).toHaveBeenCalledWith('/api/public-shares/public-token-1')
    expect(await screen.findByRole('heading', { name: 'Public CNC sales snapshot' })).toBeInTheDocument()
    expect(screen.getByText('Snapshot')).toBeInTheDocument()
    expect(screen.getByText('CNC sales')).toBeInTheDocument()
    expect(screen.getByText('Candidate A')).toBeInTheDocument()
    expect(screen.getByText('Strong CNC sales background')).toBeInTheDocument()
    expect(screen.getByText('91')).toBeInTheDocument()
    expect(screen.queryByText(/candidate status/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/actions/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/notes/i)).not.toBeInTheDocument()
  })

  it('shows an unavailable state for revoked or expired tokens', async () => {
    apiGetMock.mockResolvedValue({
      error: { message: 'gone' },
      response: { status: 410 },
    })

    renderPublicShare('/s/revoked-token')

    await waitFor(() => {
      expect(apiGetMock).toHaveBeenCalledWith('/api/public-shares/revoked-token')
    })
    expect(await screen.findByRole('heading', { name: 'Public share unavailable' })).toBeInTheDocument()
  })
})
