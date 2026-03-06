import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchProfileEditorDialog } from './SearchProfileEditorDialog'

const { getMock, postMock, putMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  putMock: vi.fn(),
}))
const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
}))

vi.mock('./JobDescriptionSelect', () => ({
  JobDescriptionSelect: ({
    value,
    onChange,
  }: {
    value: string
    onChange?: (value: string) => void
  }) => (
    <select
      aria-label="职位描述"
      data-testid="job-description-select"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    >
      <option value="">Select job description</option>
      <option value="custom-jd-id">车床销售 (Custom)</option>
      <option value="lathe-sales">车床销售工程师</option>
    </select>
  ),
}))

vi.mock('./LocationSelector', () => ({
  LocationSelector: ({
    id,
    value,
    onChange,
  }: {
    id?: string
    value: string
    onChange?: (value: string) => void
  }) => (
    <input
      id={id}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}))

vi.mock('./KeywordInput', () => ({
  KeywordInput: ({
    id,
    value,
    onChange,
  }: {
    id?: string
    value: string
    onChange?: (value: string) => void
  }) => (
    <input
      id={id}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean
    children: React.ReactNode
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}))

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => getMock(...args),
    POST: (...args: unknown[]) => postMock(...args),
    PUT: (...args: unknown[]) => putMock(...args),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

describe('SearchProfileEditorDialog JD hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === 'skip') {
        return undefined
      }

      if (typeof args === 'object' && args !== null && 'workspaceSlug' in args) {
        return [{
          _id: 'custom-jd-id',
          title: '车床销售',
          type: 'custom',
          enabled: true,
        }]
      }

      if (typeof args === 'object' && args !== null && 'id' in args) {
        if (args.id === 'custom-jd-id') {
          return {
            _id: 'custom-jd-id',
            title: '车床销售',
            location: '广东,江苏',
            customKeywords: ['车床', '销售'],
            minExperience: 2,
            maxExperience: 5,
            minAge: 25,
            maxAge: 38,
          }
        }
        return null
      }

      return undefined
    })

    getMock.mockResolvedValue({
      data: {
        success: true,
        item: {
          title: '车床销售工程师',
          location: '东莞',
          autoMatch: {
            keywords: ['车床', '销售'],
            locations: ['广东', '江苏'],
            suggested_filters: {
              minExperience: 3,
              maxExperience: 6,
              minAge: 24,
              maxAge: 40,
            },
          },
          requiredRoles: [{ min_years: 4 }],
        },
      },
    })
    postMock.mockResolvedValue({
      data: {
        success: true,
        profile: {
          id: 'created-profile',
          name: '新配置',
          status: 'active',
          location: '广东',
          keywords: ['销售'],
        },
      },
    })
    putMock.mockResolvedValue({
      data: {
        success: true,
        profile: {
          id: 'custom-profile-1',
          name: 'CNC销售-Demo',
          status: 'active',
          location: '广东',
          keywords: ['销售', 'CNC'],
        },
      },
    })
  })

  it('loads custom JD defaults into the fast edit form', async () => {
    const user = userEvent.setup()

    render(
      <SearchProfileEditorDialog
        open
        onOpenChange={vi.fn()}
        profileId={null}
      />
    )

    await user.selectOptions(screen.getByTestId('job-description-select'), 'custom-jd-id')

    await waitFor(() => {
      expect(screen.getByLabelText('地区:')).toHaveValue('广东,江苏')
      expect(screen.getByLabelText('关键词:')).toHaveValue('车床 销售')
      expect(screen.getByLabelText('最低相关经验(年)')).toHaveValue(2)
      expect(screen.getByLabelText('最高相关经验(年)')).toHaveValue(5)
      expect(screen.getByLabelText('最低年龄')).toHaveValue(25)
      expect(screen.getByLabelText('最高年龄')).toHaveValue(38)
    })

    expect(getMock).not.toHaveBeenCalled()
  })

  it('falls back to system JD metadata when the selection is not a custom Convex JD', async () => {
    const user = userEvent.setup()

    render(
      <SearchProfileEditorDialog
        open
        onOpenChange={vi.fn()}
        profileId={null}
      />
    )

    await user.selectOptions(screen.getByTestId('job-description-select'), 'lathe-sales')

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/api/job-descriptions/lathe-sales')
      expect(screen.getByLabelText('地区:')).toHaveValue('广东,江苏')
      expect(screen.getByLabelText('关键词:')).toHaveValue('车床 销售')
      expect(screen.getByLabelText('最低相关经验(年)')).toHaveValue(4)
      expect(screen.getByLabelText('最高相关经验(年)')).toHaveValue(6)
      expect(screen.getByLabelText('最低年龄')).toHaveValue(24)
      expect(screen.getByLabelText('最高年龄')).toHaveValue(40)
    })
  })

  it('sends explicit null clears for optional linkage fields on save', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()

    render(
      <SearchProfileEditorDialog
        open
        onOpenChange={vi.fn()}
        profileId="custom-profile-1"
        initialData={{
          id: 'custom-profile-1',
          name: 'CNC销售-Demo',
          status: 'active',
          location: '广东',
          keywords: ['销售', 'CNC'],
          jobDescription: 'custom-jd-id',
          filters: {
            minExperience: 1,
            maxAge: 40,
          },
          schedule: {
            enabled: true,
            cron: '0 9 * * 1-5',
          },
        }}
        onSaved={onSaved}
      />
    )

    await user.selectOptions(screen.getByTestId('job-description-select'), '')
    await user.clear(screen.getByLabelText('最低相关经验(年)'))
    await user.clear(screen.getByLabelText('最高年龄'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith('/api/search-profiles/custom-profile-1', {
        body: expect.objectContaining({
          jobDescription: null,
          filters: null,
        }),
      })
    })

    expect(onSaved).toHaveBeenCalledWith({
      id: 'custom-profile-1',
      name: 'CNC销售-Demo',
      status: 'active',
      location: '广东',
      keywords: ['销售', 'CNC'],
    })
  })
})
