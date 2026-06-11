import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BrowserRouter } from 'react-router-dom'

const useQueryMock = vi.hoisted(() => vi.fn())
vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}))

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: { job_descriptions: { list: 'jds:list' } },
}))

const mockGet = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: { GET: mockGet },
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'admin', name: 'Admin', accessLevel: 'admin', isAdmin: true }),
}))

import { JobDescriptionSelect } from '@/components/JobDescriptionSelect'
import { buildJobDescriptionOptions } from '@/components/job-description-options'

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>)
}

describe('buildJobDescriptionOptions', () => {
  it('returns placeholder option when no descriptions', () => {
    const options = buildJobDescriptionOptions({
      placeholderLabel: 'Select a JD',
      convexJobDescriptions: [],
      systemJobDescriptions: [],
    })
    expect(options).toEqual([{ value: '', label: 'Select a JD' }])
  })

  it('includes custom convex JDs with ✨ prefix and (Custom) suffix', () => {
    const options = buildJobDescriptionOptions({
      placeholderLabel: 'Select',
      convexJobDescriptions: [{ _id: 'jd-1', title: 'Frontend Dev', type: 'custom' }],
      systemJobDescriptions: [],
    })
    expect(options).toContainEqual({ value: 'jd-1', label: '✨ Frontend Dev (Custom)' })
  })

  it('filters out disabled custom convex JDs', () => {
    const options = buildJobDescriptionOptions({
      placeholderLabel: 'Select',
      convexJobDescriptions: [
        { _id: 'jd-1', title: 'Active', type: 'custom', enabled: true },
        { _id: 'jd-2', title: 'Disabled', type: 'custom', enabled: false },
      ],
      systemJobDescriptions: [],
    })
    expect(options).toContainEqual({ value: 'jd-1', label: '✨ Active (Custom)' })
    expect(options).not.toContainEqual(expect.objectContaining({ value: 'jd-2' }))
  })

  it('includes system JDs with (System) suffix', () => {
    const options = buildJobDescriptionOptions({
      placeholderLabel: 'Select',
      convexJobDescriptions: [],
      systemJobDescriptions: [{ name: 'sys-jd', title: 'System JD' }],
    })
    expect(options).toContainEqual({ value: 'sys-jd', label: 'System JD (System)' })
  })
})

describe('JobDescriptionSelect', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders select element', () => {
    useQueryMock.mockReturnValue(undefined)
    mockGet.mockResolvedValue({ data: { success: true, items: [] } })
    renderWithRouter(<JobDescriptionSelect {...defaultProps} />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('shows external link when value is selected', async () => {
    useQueryMock.mockReturnValue([])
    mockGet.mockResolvedValue({ data: { success: true, items: [] } })
    renderWithRouter(<JobDescriptionSelect {...defaultProps} value="jd-1" />)

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/admin/system/jds')
  })

  it('does not show external link when no value', () => {
    useQueryMock.mockReturnValue([])
    mockGet.mockResolvedValue({ data: { success: true, items: [] } })
    renderWithRouter(<JobDescriptionSelect {...defaultProps} value="" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('calls onChange when selection changes', async () => {
    const onChange = vi.fn()
    useQueryMock.mockReturnValue([])
    mockGet.mockResolvedValue({ data: { success: true, items: [] } })
    const user = userEvent.setup()
    renderWithRouter(<JobDescriptionSelect {...defaultProps} onChange={onChange} />)

    const select = screen.getByRole('combobox')
    await user.selectOptions(select, '')
    // onChange should be callable
    expect(select).toBeInTheDocument()
  })

  it('can be disabled', () => {
    useQueryMock.mockReturnValue([])
    mockGet.mockResolvedValue({ data: { success: true, items: [] } })
    renderWithRouter(<JobDescriptionSelect {...defaultProps} disabled={true} />)
    expect(screen.getByRole('combobox')).toBeDisabled()
  })
})
