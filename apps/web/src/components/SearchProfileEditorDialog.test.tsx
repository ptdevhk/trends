import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
const { tMock } = vi.hoisted(() => ({
  tMock: vi.fn((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key),
}))

const CONVEX_JOB_DESCRIPTIONS = [{
  _id: 'custom-jd-id',
  title: '车床销售',
  type: 'custom',
  enabled: true,
}]

const CONVEX_JOB_DESCRIPTION_DETAIL = {
  _id: 'custom-jd-id',
  title: '车床销售',
  location: '广东,江苏',
  customKeywords: ['车床', '销售'],
  minExperience: 2,
  maxExperience: 5,
  minAge: 25,
  maxAge: 38,
}

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

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({
    id,
    checked,
    onCheckedChange,
  }: {
    id?: string
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tMock,
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
        return CONVEX_JOB_DESCRIPTIONS
      }

      if (typeof args === 'object' && args !== null && 'id' in args) {
        if (args.id === 'custom-jd-id') {
          return CONVEX_JOB_DESCRIPTION_DETAIL
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
          suggestedFilters: {
            minExperience: 3,
            maxExperience: 6,
            minAge: 24,
            maxAge: 40,
          },
          autoMatch: {
            keywords: ['车床', '销售'],
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
    render(
      <SearchProfileEditorDialog
        open
        onOpenChange={vi.fn()}
        profileId={null}
      />
    )

    fireEvent.change(screen.getByTestId('job-description-select'), { target: { value: 'custom-jd-id' } })

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
    render(
      <SearchProfileEditorDialog
        open
        onOpenChange={vi.fn()}
        profileId={null}
      />
    )

    fireEvent.change(screen.getByTestId('job-description-select'), { target: { value: 'lathe-sales' } })

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/api/job-descriptions/lathe-sales')
      expect(screen.getByLabelText('地区:')).toHaveValue('东莞')
      expect(screen.getByLabelText('关键词:')).toHaveValue('车床 销售')
      expect(screen.getByLabelText('最低相关经验(年)')).toHaveValue(4)
      expect(screen.getByLabelText('最高相关经验(年)')).toHaveValue(6)
      expect(screen.getByLabelText('最低年龄')).toHaveValue(24)
      expect(screen.getByLabelText('最高年龄')).toHaveValue(40)
    })
  })

  it('persists Seek source job URLs in the profile payload', async () => {
    const user = userEvent.setup()

    render(
      <SearchProfileEditorDialog
        open
        onOpenChange={vi.fn()}
        profileId={null}
      />
    )

    await user.type(screen.getByLabelText('Name'), 'Seek profile')
    await user.type(screen.getByLabelText('关键词:'), '"Sales Engineer" OR "Sales Manager"')
    await user.click(screen.getByLabelText('Seek'))
    await user.clear(screen.getByLabelText('Seek job URL'))
    await user.type(
      screen.getByLabelText('Seek job URL'),
      'https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1'
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/api/search-profiles', {
        body: expect.objectContaining({
          keywords: ['Sales Engineer', 'Sales Manager'],
          sources: expect.arrayContaining([
            expect.objectContaining({
              type: 'job5156',
              enabled: true,
              priority: 1,
            }),
            expect.objectContaining({
              type: 'seek',
              enabled: true,
              priority: 2,
              jobUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1',
            }),
          ]),
        }),
      })
    })
  })

  it('persists explicit 51job extended-limit settings in the profile payload', async () => {
    const user = userEvent.setup()

    render(
      <SearchProfileEditorDialog
        open
        onOpenChange={vi.fn()}
        profileId={null}
      />
    )

    await user.type(screen.getByLabelText('Name'), '51job extended profile')
    await user.type(screen.getByLabelText('关键词:'), '"Sales Engineer" OR "Sales Manager"')
    await user.click(screen.getByLabelText('51job eHire'))
    await user.clear(screen.getByLabelText('Limit'))
    await user.type(screen.getByLabelText('Limit'), '100')
    await user.clear(screen.getByLabelText('Pages'))
    await user.type(screen.getByLabelText('Pages'), '3')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/api/search-profiles', {
        body: expect.objectContaining({
          keywords: ['Sales Engineer', 'Sales Manager'],
          sources: expect.arrayContaining([
            expect.objectContaining({
              type: '51job',
              enabled: true,
              priority: 3,
              unsafeLimits: true,
              job51CollectLimit: 100,
              job51MaxPages: 3,
            }),
          ]),
        }),
      })
    })
  })

  it('hides the JD select for seeded profiles and clears stale JD on save', async () => {
    const user = userEvent.setup()

    render(
      <SearchProfileEditorDialog
        open
        onOpenChange={vi.fn()}
        profileId="job5156-cn-cnc-sales"
        initialData={{
          id: 'job5156-cn-cnc-sales',
          name: 'China Job5156 CNC Sales',
          status: 'active',
          location: 'China',
          keywords: ['CNC', '销售'],
          jobDescription: 'lathe-sales',
          filters: {
            minExperience: 2,
          },
          schedule: {
            enabled: true,
            cron: '0 9 * * 1-5',
          },
        }}
      />
    )

    expect(screen.queryByTestId('job-description-select')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith('/api/search-profiles/job5156-cn-cnc-sales', {
        body: expect.objectContaining({
          jobDescription: null,
        }),
      })
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

    fireEvent.change(screen.getByTestId('job-description-select'), { target: { value: '' } })
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

  it('sends an explicit empty location when the editor clears all location tags', async () => {
    const user = userEvent.setup()

    putMock.mockResolvedValueOnce({
      data: {
        success: true,
        profile: {
          id: 'custom-profile-1',
          name: 'CNC销售-Demo',
          status: 'active',
          location: '',
          keywords: ['销售', 'CNC'],
        },
      },
    })

    render(
      <SearchProfileEditorDialog
        open
        onOpenChange={vi.fn()}
        profileId="custom-profile-1"
        initialData={{
          id: 'custom-profile-1',
          name: 'CNC销售-Demo',
          status: 'active',
          location: '广东,江苏',
          keywords: ['销售', 'CNC'],
        }}
      />
    )

    await user.clear(screen.getByLabelText('地区:'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith('/api/search-profiles/custom-profile-1', {
        body: expect.objectContaining({
          location: '',
        }),
      })
    })
  })
})
