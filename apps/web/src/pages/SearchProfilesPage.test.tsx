import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SearchProfilesPage } from './SearchProfilesPage'

const { getMock, postMock, deleteMock, setSearchParamsMock, toastSuccessMock, toastErrorMock, tMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  deleteMock: vi.fn(),
  setSearchParamsMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  tMock: vi.fn((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key),
}))

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), setSearchParamsMock],
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tMock,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => getMock(...args),
    POST: (...args: unknown[]) => postMock(...args),
    DELETE: (...args: unknown[]) => deleteMock(...args),
  },
}))

vi.mock('@/components/ProfileCard', () => ({
  ProfileCard: ({
    profile,
    onRunNow,
  }: {
    profile: { id: string; name: string }
    onRunNow: (profileId: string) => void
  }) => (
    <button type="button" onClick={() => onRunNow(profile.id)}>
      Run {profile.name}
    </button>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ title }: { title?: string }) => <div>{title}</div>,
}))

vi.mock('@/components/SearchProfileEditorDialog', () => ({
  SearchProfileEditorDialog: () => null,
}))

describe('SearchProfilesPage run behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 1 as never)
    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/search-profiles') {
        return {
          data: {
            success: true,
            profiles: [
              {
                id: 'profile-1',
                name: 'Profile 1',
                filename: 'profile-1.yaml',
                updatedAt: '2026-03-17T00:00:00.000Z',
                status: 'active',
                location: 'Kuala Lumpur MY',
                keywords: ['Sales Engineer', 'Sales Manager'],
              },
            ],
          },
        }
      }

      if (path === '/api/search-profiles/profile-1/status') {
        return {
          data: {
            success: true,
            status: null,
          },
        }
      }

      return {
        data: {
          success: true,
        },
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens Seek profiles in a new tab instead of dispatching a worker run', async () => {
    const user = userEvent.setup()
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/search-profiles') {
        return {
          data: {
            success: true,
            profiles: [
              {
                id: 'profile-1',
                name: 'Seek profile',
                filename: 'seek-profile.yaml',
                updatedAt: '2026-03-17T00:00:00.000Z',
                status: 'active',
                location: 'Kuala Lumpur MY',
                keywords: ['Sales Engineer', 'Sales Manager'],
              },
            ],
          },
        }
      }

      if (path === '/api/search-profiles/profile-1') {
        return {
          data: {
            success: true,
            profile: {
              id: 'profile-1',
              name: 'Seek profile',
              status: 'active',
              location: 'Kuala Lumpur MY',
              keywords: ['Sales Engineer', 'Sales Manager'],
              filters: {
                minAge: 25,
                maxAge: 40,
              },
              schedule: {
                enabled: true,
                cron: '0 9 * * 1-5',
                maxCandidates: 200,
              },
              sources: [
                {
                  type: 'seek',
                  enabled: true,
                  priority: 1,
                  jobUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1',
                },
                {
                  type: 'job5156',
                  enabled: true,
                  priority: 2,
                },
              ],
            },
          },
        }
      }

      if (path === '/api/search-profiles/profile-1/status') {
        return {
          data: {
            success: true,
            status: null,
          },
        }
      }

      return {
        data: {
          success: true,
        },
      }
    })

    render(<SearchProfilesPage />)

    await user.click(await screen.findByRole('button', { name: 'Run Seek profile' }))

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledTimes(1)
    })

    const openedUrl = new URL(String(openSpy.mock.calls[0]?.[0]))
    expect(`${openedUrl.origin}${openedUrl.pathname}`).toBe('https://my.employer.seek.com/candidates/recommended')
    expect(openedUrl.searchParams.get('jobId')).toBe('90842915')
    expect(openedUrl.searchParams.get('tr_limit')).toBe('200')
    expect(openedUrl.searchParams.get('tr_max_pages')).toBe('10')
    expect(openedUrl.searchParams.get('tr_min_age')).toBe('25')
    expect(openedUrl.searchParams.get('tr_max_age')).toBe('40')
    expect(postMock).not.toHaveBeenCalled()
    expect(getMock).toHaveBeenCalledTimes(3)
    expect(toastSuccessMock).toHaveBeenCalledWith('Opened Seek collection in a new tab')
  })

  it('keeps worker-backed sources on the existing dispatch and status polling flow', async () => {
    const user = userEvent.setup()

    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/search-profiles') {
        return {
          data: {
            success: true,
            profiles: [
              {
                id: 'profile-1',
                name: 'Job5156 profile',
                filename: 'job5156-profile.yaml',
                updatedAt: '2026-03-17T00:00:00.000Z',
                status: 'active',
                location: '东莞',
                keywords: ['招聘', '简历'],
              },
            ],
          },
        }
      }

      if (path === '/api/search-profiles/profile-1') {
        return {
          data: {
            success: true,
            profile: {
              id: 'profile-1',
              name: 'Job5156 profile',
              status: 'active',
              location: '东莞',
              keywords: ['招聘', '简历'],
              sources: [
                {
                  type: 'job5156',
                  enabled: true,
                  priority: 1,
                },
                {
                  type: 'seek',
                  enabled: true,
                  priority: 2,
                  jobUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1',
                },
              ],
            },
          },
        }
      }

      if (path === '/api/search-profiles/profile-1/status') {
        return {
          data: {
            success: true,
            status: {
              profileId: 'profile-1',
              taskId: 'task-1',
              taskStatus: 'pending',
              startedAt: '2026-03-17T00:00:00.000Z',
              updatedAt: '2026-03-17T00:00:00.000Z',
            },
          },
        }
      }

      return {
        data: {
          success: true,
        },
      }
    })

    postMock.mockResolvedValue({
      data: {
        success: true,
        profileId: 'profile-1',
        taskId: 'task-1',
      },
    })

    render(<SearchProfilesPage />)

    await user.click(await screen.findByRole('button', { name: 'Run Job5156 profile' }))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/api/search-profiles/profile-1/run', {
        body: {},
      })
    })

    await waitFor(() => {
      expect(getMock.mock.calls.filter(([path]) => path === '/api/search-profiles/profile-1/status')).toHaveLength(2)
    })
    expect(toastSuccessMock).toHaveBeenCalledWith('Profile run started')
  })
})
