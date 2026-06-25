import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PublicSharePage } from './PublicSharePage'
import { workspaceRef } from '@/lib/workspace-ref'

const {
  apiGetMock,
  apiPatchMock,
  apiPostMock,
  authMock,
  blockCandidatesMock,
  exportDownloadMock,
  saveActionMock,
  unblockCandidateMock,
  updateStatusMock,
  useCandidateActionsMock,
  useSearchPrefetchMock,
  useQueryMock,
} = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  apiPatchMock: vi.fn(),
  apiPostMock: vi.fn(),
  authMock: {
    user: { id: 'manager-1' },
    isLoading: false,
  },
  blockCandidatesMock: vi.fn(async () => true),
  exportDownloadMock: vi.fn(async (baseUrl: string, payload: unknown) => {
    void baseUrl
    void payload
  }),
  saveActionMock: vi.fn(async () => null),
  unblockCandidateMock: vi.fn(async () => true),
  updateStatusMock: vi.fn(async () => true),
  useCandidateActionsMock: vi.fn(),
  useSearchPrefetchMock: vi.fn(),
  useQueryMock: vi.fn(),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => apiGetMock(...args),
    PATCH: (...args: unknown[]) => apiPatchMock(...args),
    POST: (...args: unknown[]) => apiPostMock(...args),
  },
}))

vi.mock('@/lib/api-client', () => ({
  apiBaseUrl: '',
}))

vi.mock('@/lib/resume-export', () => ({
  submitResumeExportDownload: (baseUrl: string, payload: unknown) =>
    exportDownloadMock(baseUrl, payload),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authMock,
}))

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}))

vi.mock('@/hooks/useSearchPrefetch', () => ({
  useSearchPrefetch: (...args: unknown[]) => useSearchPrefetchMock(...args),
}))

vi.mock('@/hooks/useCandidateStatus', () => ({
  useCandidateStatus: () => ({
    statusByIdentity: {
      'identity-1': {
        _id: 'status-1',
        identityKey: 'identity-1',
        workspaceSlug: 'hr',
        status: 'contacted',
        notes: 'Existing note',
        updatedAt: 1,
      },
    },
    updateStatus: updateStatusMock,
  }),
}))

vi.mock('@/hooks/useCandidateActions', () => ({
  useCandidateActions: (...args: unknown[]) => useCandidateActionsMock(...args),
}))

vi.mock('@/hooks/useCandidateBlocks', () => ({
  useCandidateBlocks: () => ({
    blocksByIdentity: {},
    blockCandidates: blockCandidatesMock,
    unblockCandidate: unblockCandidateMock,
  }),
}))

vi.mock('@/components/search/SearchResultsList', () => ({
  SearchResultsList: ({
    actionsByResume,
    items,
    onAction,
    onCandidateStatusChange,
    onRating,
    onToggleBlock,
    onToggleSelect,
    ratingsByResume,
    selectedIds,
  }: {
    actionsByResume?: Record<string, string>
    items: Array<{ identityKey: string; key: string; resume: { resumeId: string; name: string } }>
    onAction?: (resumeId: string, action: 'star') => void
    onCandidateStatusChange?: (identityKey: string, status: 'shortlisted', notes?: string) => void
    onRating?: (resumeId: string, rating: number) => void
    onToggleBlock?: (identityKey: string, blocked: boolean, reason?: string) => void
    onToggleSelect?: (key: string) => void
    ratingsByResume?: Record<string, number>
    selectedIds?: Set<string>
  }) => (
    <div>
      <div>
        Shared Results List {items.length} action:{String(Boolean(onAction))} rating:
        {String(Boolean(onRating))} status:{String(Boolean(onCandidateStatusChange))} block:
        {String(Boolean(onToggleBlock))} select:{String(Boolean(onToggleSelect))}
      </div>
      <div>First shared candidate {items[0]?.resume.name}</div>
      <div>First action {actionsByResume?.[items[0]?.resume.resumeId] ?? 'none'}</div>
      <div>First rating {ratingsByResume?.[items[0]?.resume.resumeId] ?? 'none'}</div>
      <div>Selected {Array.from(selectedIds ?? new Set()).join('|') || 'none'}</div>
      <button type="button" onClick={() => onToggleSelect?.(items[0].key)}>Select first</button>
      <button type="button" onClick={() => onAction?.(items[0].resume.resumeId, 'star')}>Star first</button>
      <button type="button" onClick={() => onRating?.(items[0].resume.resumeId, 5)}>Rate first</button>
      <button type="button" onClick={() => onCandidateStatusChange?.(items[0].identityKey, 'shortlisted', 'Shared note')}>Status first</button>
      <button type="button" onClick={() => onToggleBlock?.(items[0].identityKey, false, 'Duplicate')}>Block first</button>
    </div>
  ),
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
    apiPatchMock.mockReset()
    apiPostMock.mockReset()
    apiPostMock.mockResolvedValue({
      data: {
        success: true,
        session: {
          id: 'member-review-session-1',
        },
      },
    })
    authMock.user = { id: 'manager-1' }
    authMock.isLoading = false
    blockCandidatesMock.mockClear()
    exportDownloadMock.mockClear()
    saveActionMock.mockClear()
    unblockCandidateMock.mockClear()
    updateStatusMock.mockClear()
    useCandidateActionsMock.mockReset()
    useSearchPrefetchMock.mockClear()
    useCandidateActionsMock.mockReturnValue({
      actionsByResume: {
        'resume-1': 'star',
      },
      ratingsByResume: {
        'resume-1': 4,
      },
      commentsByResume: {},
      saveAction: saveActionMock,
    })
    useQueryMock.mockReset()
    localStorage.clear()
    workspaceRef.set('dev')
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
    expect(screen.getByTestId('public-snapshot-search-shell')).toBeInTheDocument()
    expect(screen.getByTestId('public-snapshot-query')).toHaveTextContent('CNC sales')
    expect(screen.getByTestId('public-snapshot-result-count')).toHaveTextContent('1 result')
    expect(screen.getByTestId('public-snapshot-filter-locations')).toHaveTextContent('locations: Malaysia')
    expect(screen.getByText('Snapshot')).toBeInTheDocument()
    expect(screen.getByText('CNC sales')).toBeInTheDocument()
    expect(screen.getByText('Candidate A')).toBeInTheDocument()
    expect(screen.getByText('Strong CNC sales background')).toBeInTheDocument()
    expect(screen.getByText('91')).toBeInTheDocument()
    expect(screen.queryByTestId('resume-search-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('bulk-export')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Share/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/candidate status/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/actions/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/notes/i)).not.toBeInTheDocument()
    expect(apiPostMock).not.toHaveBeenCalled()
    expect(useQueryMock).not.toHaveBeenCalled()
    expect(useCandidateActionsMock).not.toHaveBeenCalled()
    expect(useSearchPrefetchMock).not.toHaveBeenCalled()
  })

  it('hydrates member-visible shared resume keys and enables review controls', async () => {
    const user = userEvent.setup()
    useQueryMock.mockReturnValue([
      {
        _id: 'resume-1',
        identityKey: 'identity-1',
        externalId: 'resume-1',
        content: {
          name: 'Candidate A',
          location: 'China',
          experience: '5 years',
          education: 'Bachelor',
          extractedAt: '2026-06-12T09:00:00.000Z',
        },
        source: 'job5156',
        tags: [],
        crawledAt: 1,
      },
      {
        _id: 'resume-2',
        identityKey: 'identity-2',
        externalId: 'resume-2',
        content: {
          name: 'Candidate B',
          location: 'China',
          experience: '3 years',
          education: 'Bachelor',
          extractedAt: '2026-06-12T09:01:00.000Z',
        },
        source: 'job5156',
        tags: [],
        crawledAt: 2,
      },
    ])
    apiGetMock.mockResolvedValue({
      data: {
        success: true,
        share: {
          title: 'China CNC sales snapshot',
          createdAt: '2026-06-12T09:00:00.000Z',
          snapshot: {
            scoringMode: 'hybrid',
            promptVersion: 'prompt-v1',
            skillConfigVersion: 'skills-v1',
            modelProvider: 'openai',
            modelName: 'gpt-test',
            payload: {
              search: {
                query: 'CNC 销售 China',
                filters: {
                  locations: ['China'],
                  minRoleYears: 1,
                  roleFilterType: 'sales',
                  minAge: 25,
                  maxAge: 40,
                },
              },
              results: [
                {
                  resumeKey: 'identity-1',
                  displayName: 'Candidate A',
                  summary: 'Strong CNC sales background',
                  score: 91,
                  recommendation: 'strong_match',
                  highlights: ['CNC'],
                },
                {
                  resumeKey: 'identity-2',
                  displayName: 'Candidate B',
                  summary: 'Good territory sales profile',
                  score: 84,
                  recommendation: 'match',
                  highlights: ['Sales'],
                },
              ],
            },
          },
          member: {
            workspaceSlug: 'hr',
            canReview: true,
            searchRun: {
              id: 'run-1',
              resumeKeys: ['identity-1', 'identity-2'],
              query: { text: 'CNC 销售 China' },
              filters: {
                locations: ['China'],
                minRoleYears: 1,
                roleFilterType: 'sales',
                minAge: 25,
                maxAge: 40,
              },
            },
          },
        },
      },
    })

    renderPublicShare()

    expect(await screen.findByRole('heading', { name: 'China CNC sales snapshot' })).toBeInTheDocument()
    expect(await screen.findByText('Shared Results List 2 action:true rating:true status:true block:true select:true')).toBeInTheDocument()
    expect(screen.getByText('First shared candidate Candidate A')).toBeInTheDocument()
    expect(screen.getByText('First action star')).toBeInTheDocument()
    expect(screen.getByText('First rating 4')).toBeInTheDocument()
    expect(workspaceRef.get()).toBe('hr')
    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith('/api/sessions', {
        body: {
          jobDescriptionId: undefined,
          filters: {
            locations: ['China'],
            minRoleYears: 1,
            roleFilterType: 'sales',
            minAge: 25,
            maxAge: 40,
          },
          shareTitle: 'China CNC sales snapshot',
          searchState: {
            location: 'China',
            keywords: ['CNC', '销售', 'China'],
            filters: {
              locations: ['China'],
              minRoleYears: 1,
              roleFilterType: 'sales',
              minAge: 25,
              maxAge: 40,
            },
            referenceNote: 'Shared snapshot public-token-1',
          },
        },
      })
    })
    await waitFor(() => {
      expect(useCandidateActionsMock).toHaveBeenLastCalledWith('member-review-session-1', undefined, true)
    })
    expect(localStorage.getItem('trends.publicShare.reviewSessionId.hr.manager-1.public-token-1')).toBe('member-review-session-1')
    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
      identityKeys: ['identity-1', 'identity-2'],
    })

    await user.click(screen.getByRole('button', { name: 'Select first' }))
    expect(screen.getByText('Selected identity-1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Star first' }))
    expect(saveActionMock).toHaveBeenCalledWith({ resumeId: 'resume-1', actionType: 'star' })

    await user.click(screen.getByRole('button', { name: 'Rate first' }))
    expect(saveActionMock).toHaveBeenCalledWith({ resumeId: 'resume-1', actionType: 'rating', actionData: { rating: 5 } })

    await user.click(screen.getByRole('button', { name: 'Status first' }))
    expect(updateStatusMock).toHaveBeenCalledWith('identity-1', 'shortlisted', 'Shared note')

    await user.click(screen.getByRole('button', { name: 'Block first' }))
    expect(blockCandidatesMock).toHaveBeenCalledWith(['identity-1'], 'Duplicate')
  })

  it('renders the member bulk action bar and exports selected snapshot resumes', async () => {
    const user = userEvent.setup()
    useQueryMock.mockReturnValue([
      {
        _id: 'resume-1',
        identityKey: 'identity-1',
        externalId: 'resume-1',
        content: {
          name: 'Candidate A',
          location: 'China',
          experience: '5 years',
          education: 'Bachelor',
          extractedAt: '2026-06-12T09:00:00.000Z',
        },
        source: 'job5156',
        primaryRuleScore: 70,
        tags: [],
        crawledAt: 1,
      },
      {
        _id: 'resume-2',
        identityKey: 'identity-2',
        externalId: 'resume-2',
        content: {
          name: 'Candidate B',
          location: 'China',
          experience: '3 years',
          education: 'Bachelor',
          extractedAt: '2026-06-12T09:01:00.000Z',
        },
        source: 'job5156',
        primaryRuleScore: 65,
        tags: [],
        crawledAt: 2,
      },
    ])
    apiGetMock.mockResolvedValue({
      data: {
        success: true,
        share: {
          title: 'China CNC sales snapshot',
          createdAt: '2026-06-12T09:00:00.000Z',
          snapshot: {
            scoringMode: 'hybrid',
            promptVersion: 'prompt-v1',
            skillConfigVersion: 'skills-v1',
            modelProvider: 'openai',
            modelName: 'gpt-test',
            payload: {
              search: {
                query: 'CNC 销售 China',
                filters: {
                  locations: ['China'],
                  minRoleYears: 1,
                },
              },
              results: [
                {
                  resumeKey: 'identity-1',
                  displayName: 'Candidate A',
                  summary: 'Strong CNC sales background',
                  score: 91,
                  recommendation: 'strong_match',
                  highlights: ['CNC'],
                },
                {
                  resumeKey: 'identity-2',
                  displayName: 'Candidate B',
                  summary: 'Good territory sales profile',
                  score: 72,
                  recommendation: 'match',
                  highlights: ['Sales'],
                },
              ],
            },
          },
          member: {
            workspaceSlug: 'hr',
            canReview: true,
            searchRun: {
              id: 'run-1',
              resumeKeys: ['identity-1', 'identity-2'],
              query: { text: 'CNC 销售 China', jobDescriptionId: 'jd-1' },
              filters: {
                locations: ['China'],
                minRoleYears: 1,
              },
            },
          },
        },
      },
    })

    renderPublicShare()

    expect(await screen.findByTestId('bulk-export')).toBeInTheDocument()
    await waitFor(() => {
      expect(useCandidateActionsMock).toHaveBeenLastCalledWith('member-review-session-1', undefined, true)
    })

    await user.click(screen.getByTestId('bulk-select-all'))
    await user.click(screen.getByTestId('bulk-export'))

    expect(exportDownloadMock).toHaveBeenCalledWith('', {
      format: 'csv',
      source: 'convex',
      sessionId: 'member-review-session-1',
      jobDescriptionId: 'jd-1',
      entries: [
        expect.objectContaining({
          resumeId: 'identity-1',
          status: 'contacted',
          userComment: 'Existing note',
          userRating: 4,
          match: expect.objectContaining({
            score: 91,
            scoreSource: 'ai',
            summary: 'Strong CNC sales background',
          }),
        }),
        expect.objectContaining({
          resumeId: 'identity-2',
          status: 'new',
          match: expect.objectContaining({
            score: 72,
            scoreSource: 'ai',
            summary: 'Good territory sales profile',
          }),
        }),
      ],
    })
  })

  it('presents authenticated members with the resume search shell instead of the snapshot shell', async () => {
    useQueryMock.mockReturnValue([
      {
        _id: 'resume-1',
        identityKey: 'identity-1',
        externalId: 'resume-1',
        content: {
          name: 'Candidate A',
          location: 'China',
          experience: '5 years',
          education: 'Bachelor',
          extractedAt: '2026-06-12T09:00:00.000Z',
        },
        source: 'job5156',
        primaryRuleScore: 70,
        tags: [],
        crawledAt: 1,
      },
      {
        _id: 'resume-2',
        identityKey: 'identity-2',
        externalId: 'resume-2',
        content: {
          name: 'Candidate B',
          location: 'China',
          experience: '3 years',
          education: 'Bachelor',
          extractedAt: '2026-06-12T09:01:00.000Z',
        },
        source: '51job',
        primaryRuleScore: 65,
        tags: [],
        crawledAt: 2,
      },
    ])
    apiGetMock.mockResolvedValue({
      data: {
        success: true,
        share: {
          title: 'China CNC sales snapshot',
          createdAt: '2026-06-12T09:00:00.000Z',
          snapshot: {
            scoringMode: 'hybrid',
            promptVersion: 'prompt-v1',
            skillConfigVersion: 'skills-v1',
            modelProvider: 'openai',
            modelName: 'gpt-test',
            payload: {
              search: {
                query: 'CNC 销售 China',
                filters: {
                  locations: ['China'],
                  minRoleYears: 1,
                  roleFilterType: 'sales',
                  minAge: 25,
                  maxAge: 40,
                },
              },
              results: [
                {
                  resumeKey: 'identity-1',
                  displayName: 'Candidate A',
                  summary: 'Strong CNC sales background',
                  score: 91,
                  recommendation: 'strong_match',
                  highlights: ['CNC'],
                },
                {
                  resumeKey: 'identity-2',
                  displayName: 'Candidate B',
                  summary: 'Good territory sales profile',
                  score: 72,
                  recommendation: 'match',
                  highlights: ['Sales'],
                },
              ],
            },
          },
          member: {
            workspaceSlug: 'hr',
            canReview: true,
            searchRun: {
              id: 'run-1',
              resumeKeys: ['identity-1', 'identity-2'],
              query: { text: 'CNC 销售 China' },
              filters: {
                locations: ['China'],
                minRoleYears: 1,
                roleFilterType: 'sales',
                minAge: 25,
                maxAge: 40,
              },
            },
          },
        },
      },
    })

    renderPublicShare()

    expect(await screen.findByText('Shared Results List 2 action:true rating:true status:true block:true select:true')).toBeInTheDocument()
    expect(screen.getAllByText('Filters').length).toBeGreaterThan(0)
    expect(screen.getByText('Resume AI analysis')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Share/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /复制搜索链接|Copy link/i })).toBeInTheDocument()
    expect(useSearchPrefetchMock).toHaveBeenCalledWith('CNC 销售 China', false)
    expect(screen.queryByText('Snapshot')).not.toBeInTheDocument()
  })

  it('keeps member bulk actions disabled until shared resume rows hydrate', async () => {
    useQueryMock.mockReturnValue(undefined)
    apiGetMock.mockResolvedValue({
      data: {
        success: true,
        share: {
          title: 'Hydrating shared snapshot',
          createdAt: '2026-06-12T09:00:00.000Z',
          snapshot: {
            scoringMode: 'hybrid',
            promptVersion: 'prompt-v1',
            skillConfigVersion: 'skills-v1',
            modelProvider: 'openai',
            modelName: 'gpt-test',
            payload: {
              search: {
                query: 'CNC 销售 China',
                filters: {
                  locations: ['China'],
                },
              },
              results: [
                {
                  resumeKey: 'identity-1',
                  displayName: 'Candidate A',
                  score: 91,
                },
              ],
            },
          },
          member: {
            workspaceSlug: 'hr',
            canReview: true,
            searchRun: {
              id: 'run-1',
              resumeKeys: ['identity-1'],
              query: { text: 'CNC 销售 China' },
              filters: {
                locations: ['China'],
              },
            },
          },
        },
      },
    })

    renderPublicShare()

    expect(await screen.findByTestId('bulk-select-all')).toBeDisabled()
    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith('/api/sessions', expect.anything())
    })
    expect(screen.getByTestId('bulk-select-all')).toBeDisabled()
    expect(screen.getByTestId('bulk-export')).toBeDisabled()
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
