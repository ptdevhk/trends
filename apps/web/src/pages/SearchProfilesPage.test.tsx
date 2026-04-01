import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SearchProfilesPage } from './SearchProfilesPage'

const { getMock, postMock, deleteMock, routerState, setSearchParamsMock, toastSuccessMock, toastErrorMock, tMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  deleteMock: vi.fn(),
  routerState: {
    search: '',
  },
  setSearchParamsMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  tMock: vi.fn((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key),
}))

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(routerState.search), setSearchParamsMock],
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
  PageHeader: ({ title, description, actions }: { title?: string; description?: string; actions?: ReactNode }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      <div>{actions}</div>
    </div>
  ),
}))

vi.mock('@/components/SearchProfileEditorDialog', () => ({
  SearchProfileEditorDialog: () => null,
}))

describe('SearchProfilesPage run behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    routerState.search = ''
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
    expect(toastSuccessMock).toHaveBeenCalledWith('Opened collection in a new tab')
  })

  it('opens 51job profiles in conservative single-page mode', async () => {
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
                name: '51job profile',
                updatedAt: '2026-03-17T00:00:00.000Z',
                status: 'active',
                location: '东莞',
                keywords: ['CNC', '销售'],
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
              name: '51job profile',
              status: 'active',
              location: '东莞',
              keywords: ['CNC', '销售'],
              filters: {
                minAge: 25,
                maxAge: 40,
              },
              schedule: {
                enabled: true,
                cron: '0 9 * * 1-5',
                maxCandidates: 120,
              },
              sources: [
                {
                  type: '51job',
                  enabled: true,
                  priority: 1,
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

    await user.click(await screen.findByRole('button', { name: 'Run 51job profile' }))

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledTimes(1)
    })

    const openedUrl = new URL(String(openSpy.mock.calls[0]?.[0]))
    expect(`${openedUrl.origin}${openedUrl.pathname}`).toBe('https://ehire.51job.com/Revision/talent/search')
    expect(openedUrl.searchParams.get('keyword')).toBe('CNC 销售')
    expect(openedUrl.searchParams.get('location')).toBe('东莞')
    expect(openedUrl.searchParams.get('tr_limit')).toBe('50')
    expect(openedUrl.searchParams.get('tr_max_pages')).toBe('1')
    expect(openedUrl.searchParams.get('tr_min_age')).toBe('25')
    expect(openedUrl.searchParams.get('tr_max_age')).toBe('40')
    expect(openedUrl.searchParams.get('tr_job51_detail_wait')).toBe('page1')
    expect(postMock).not.toHaveBeenCalled()
    expect(toastSuccessMock).toHaveBeenCalledWith('Opened collection in a new tab')
  })

  it('opens 51job profiles with explicit extended limits when the source enables them', async () => {
    const user = userEvent.setup()
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/search-profiles') {
        return {
          data: {
            success: true,
            profiles: [
              {
                id: 'profile-unsafe-1',
                name: '51job extended profile',
                updatedAt: '2026-03-17T00:00:00.000Z',
                status: 'active',
                location: '东莞',
                keywords: ['CNC', '销售'],
              },
            ],
          },
        }
      }

      if (path === '/api/search-profiles/profile-unsafe-1') {
        return {
          data: {
            success: true,
            profile: {
              id: 'profile-unsafe-1',
              name: '51job extended profile',
              status: 'active',
              location: '东莞',
              keywords: ['CNC', '销售'],
              filters: {
                minAge: 25,
                maxAge: 40,
              },
              schedule: {
                enabled: true,
                cron: '0 9 * * 1-5',
                maxCandidates: 250,
              },
              sources: [
                {
                  type: '51job',
                  enabled: true,
                  priority: 1,
                  unsafeLimits: true,
                },
              ],
            },
          },
        }
      }

      if (path === '/api/search-profiles/profile-unsafe-1/status') {
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

    await user.click(await screen.findByRole('button', { name: 'Run 51job extended profile' }))

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledTimes(1)
    })

    const openedUrl = new URL(String(openSpy.mock.calls[0]?.[0]))
    expect(`${openedUrl.origin}${openedUrl.pathname}`).toBe('https://ehire.51job.com/Revision/talent/search')
    expect(openedUrl.searchParams.get('tr_limit')).toBe('250')
    expect(openedUrl.searchParams.get('tr_max_pages')).toBe('10')
    expect(openedUrl.searchParams.get('tr_unsafe_limits')).toBe('1')
    expect(openedUrl.searchParams.get('tr_job51_detail_wait')).toBe('page1')
    expect(openedUrl.searchParams.get('tr_min_age')).toBe('25')
    expect(openedUrl.searchParams.get('tr_max_age')).toBe('40')
  })

  it('opens Job5156 profiles in a new tab when head-mode collection is enabled', async () => {
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
                name: 'Job5156 profile',
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

    render(<SearchProfilesPage />)

    await user.click(await screen.findByRole('button', { name: 'Run Job5156 profile' }))

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledTimes(1)
    })

    const openedUrl = new URL(String(openSpy.mock.calls[0]?.[0]))
    expect(`${openedUrl.origin}${openedUrl.pathname}`).toBe('https://hr.job5156.com/search')
    expect(openedUrl.searchParams.get('keyword')).toBe('招聘 简历')
    expect(openedUrl.searchParams.get('location')).toBe('东莞')
    expect(openedUrl.searchParams.get('tr_limit')).toBe('120')
    expect(openedUrl.searchParams.get('tr_max_pages')).toBe('10')
    expect(postMock).not.toHaveBeenCalled()
    expect(toastSuccessMock).toHaveBeenCalledWith('Opened collection in a new tab')
  })

  it('keeps the legacy quick-start view URL on the unified page', async () => {
    routerState.search = 'view=quick-starts'

    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/search-profiles') {
        return {
          data: {
            success: true,
            profiles: [
              {
                id: 'profile-1',
                name: 'Quick Start Profile',
                updatedAt: '2026-03-17T00:00:00.000Z',
                status: 'active',
                location: 'China',
                keywords: ['CNC', '销售'],
                quickStart: {
                  enabled: true,
                },
              },
              {
                id: 'profile-2',
                name: 'Scheduled Only Profile',
                updatedAt: '2026-03-17T00:00:00.000Z',
                status: 'active',
                location: 'Dongguan',
                keywords: ['车床', '销售'],
              },
            ],
          },
        }
      }

      if (path.endsWith('/status')) {
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
          profile: {
            id: 'profile-1',
            name: 'Quick Start Profile',
            status: 'active',
            location: 'China',
            keywords: ['CNC', '销售'],
          },
        },
      }
    })

    render(<SearchProfilesPage />)

    expect(await screen.findByText('Manage landing quick starts and scheduled profile-based resume searches.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Quick Start Profile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Scheduled Only Profile' })).toBeInTheDocument()
    expect(screen.queryByText('This filtered view shows only profiles with landing quick-start metadata enabled.')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(setSearchParamsMock).toHaveBeenCalledWith(expect.any(URLSearchParams), { replace: true })
    })

    const [nextParams] = setSearchParamsMock.mock.calls[0]
    expect(nextParams.toString()).toBe('')
  })
})
