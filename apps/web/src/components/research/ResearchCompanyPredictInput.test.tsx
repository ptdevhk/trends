import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { ResearchCompanyPredictInput } from './ResearchCompanyPredictInput'

const getMock = vi.fn()
const loadRecentMock = vi.fn()
const upsertRecentMock = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => getMock(...args),
  },
}))

vi.mock('@/lib/research-recent-companies', () => ({
  loadResearchRecentCompanies: (...args: unknown[]) => loadRecentMock(...args),
  upsertResearchRecentCompany: (...args: unknown[]) => upsertRecentMock(...args),
}))

const fanucIndustry = {
  companyKey: 'fanuc',
  nameCn: '发那科',
  nameEn: 'FANUC',
  displayName: '发那科 / FANUC',
  type: '加工中心/数控车床',
  aliases: ['发那科', 'FANUC'],
  cnc: true,
}

const mazakIndustry = {
  companyKey: 'mazak',
  nameCn: '山崎马扎克',
  nameEn: 'Yamazaki Mazak',
  displayName: '山崎马扎克 / Yamazaki Mazak',
  type: '数控机床',
  aliases: [],
  cnc: true,
}

function renderPredict(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

function typeQuery(input: HTMLElement, value: string) {
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
}

/** Advance debounce + flush microtasks from mock API promises (no waitFor — hangs under fake timers). */
async function flushDebouncedFetch(ms = 250) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
  // settle GET mock promises
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ResearchCompanyPredictInput', () => {
  beforeEach(() => {
    getMock.mockReset()
    loadRecentMock.mockReset()
    upsertRecentMock.mockReset()
    loadRecentMock.mockReturnValue([])
    upsertRecentMock.mockImplementation((entry: { companyKey: string; nameCn: string }) => [
      { ...entry, openedAt: 1 },
    ])
    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/research/industry') {
        return { data: { success: true, items: [fanucIndustry, mazakIndustry] } }
      }
      if (path === '/api/research/industry/resolve') {
        return { data: { success: true, hit: fanucIndustry } }
      }
      return { data: { success: true } }
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('focus empty shows recent from storage mock', () => {
    loadRecentMock.mockReturnValue([
      { companyKey: 'fanuc', nameCn: '发那科', nameEn: 'FANUC', openedAt: 2 },
      { companyKey: 'mazak', nameCn: '山崎马扎克', openedAt: 1 },
    ])

    renderPredict(
      <ResearchCompanyPredictInput teamSlug="hr" onNavigate={vi.fn()} />,
    )

    const input = screen.getByTestId('research-company-search')
    fireEvent.focus(input)

    expect(screen.getByTestId('research-predict-listbox')).toBeInTheDocument()
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('发那科')
    expect(options[1]).toHaveTextContent('山崎马扎克')
    expect(screen.getByText('最近打开')).toBeInTheDocument()
  })

  it('type "发那" debounced → industry GET with q + resolve; list includes fanuc nameCn 发那科', async () => {
    renderPredict(
      <ResearchCompanyPredictInput teamSlug="hr" debounceMs={250} onNavigate={vi.fn()} />,
    )

    const input = screen.getByTestId('research-company-search')
    typeQuery(input, '发那')

    expect(getMock).not.toHaveBeenCalled()

    await flushDebouncedFetch(250)

    const industryCalls = getMock.mock.calls.filter((c) => c[0] === '/api/research/industry')
    const resolveCalls = getMock.mock.calls.filter((c) => c[0] === '/api/research/industry/resolve')
    expect(industryCalls.length).toBeGreaterThanOrEqual(1)
    expect(resolveCalls.length).toBeGreaterThanOrEqual(1)

    const industryOpts = industryCalls[0]?.[1] as { params?: { query?: { q?: string; limit?: number } } }
    expect(industryOpts?.params?.query?.q).toBe('发那')
    expect(industryOpts?.params?.query?.limit).toBe(24)

    const resolveOpts = resolveCalls[0]?.[1] as { params?: { query?: { q?: string } } }
    expect(resolveOpts?.params?.query?.q).toBe('发那')

    expect(screen.getByTestId('research-predict-listbox')).toHaveTextContent('发那科')
  })

  it('resolve pin first when hit present', async () => {
    getMock.mockImplementation(async (path: string) => {
      if (path === '/api/research/industry') {
        return { data: { success: true, items: [mazakIndustry, fanucIndustry] } }
      }
      if (path === '/api/research/industry/resolve') {
        return { data: { success: true, hit: fanucIndustry } }
      }
      return { data: { success: true } }
    })

    renderPredict(
      <ResearchCompanyPredictInput teamSlug="hr" debounceMs={250} onNavigate={vi.fn()} />,
    )

    const input = screen.getByTestId('research-company-search')
    typeQuery(input, 'fanuc')
    await flushDebouncedFetch(250)

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('发那科')
    expect(options[0]).toHaveAttribute('data-company-key', 'fanuc')
  })

  it('click / Enter calls navigate with /hr/research/fanuc?persona=hr and upserts recent', async () => {
    const onNavigate = vi.fn()

    renderPredict(
      <ResearchCompanyPredictInput teamSlug="hr" debounceMs={250} onNavigate={onNavigate} />,
    )

    const input = screen.getByTestId('research-company-search')
    typeQuery(input, '发那')
    await flushDebouncedFetch(250)

    expect(screen.getByText('发那科')).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onNavigate).toHaveBeenCalledWith('/hr/research/fanuc?persona=hr')
    expect(upsertRecentMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyKey: 'fanuc', nameCn: '发那科' }),
    )
  })

  it('click option navigates and upserts', async () => {
    const onNavigate = vi.fn()

    renderPredict(
      <ResearchCompanyPredictInput teamSlug="hr" debounceMs={250} onNavigate={onNavigate} />,
    )

    const input = screen.getByTestId('research-company-search')
    typeQuery(input, '发那')
    await flushDebouncedFetch(250)

    expect(screen.getByText('发那科')).toBeInTheDocument()

    const option = screen.getByRole('option', { name: /发那科/ })
    fireEvent.mouseDown(option)
    fireEvent.click(option)

    expect(onNavigate).toHaveBeenCalledWith('/hr/research/fanuc?persona=hr')
    expect(upsertRecentMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyKey: 'fanuc', nameCn: '发那科' }),
    )
  })

  it('type A then type B does not keep A options clickable after B is typed', async () => {
    getMock.mockImplementation(async (path: string, opts?: { params?: { query?: { q?: string } } }) => {
      const q = opts?.params?.query?.q ?? ''
      if (path === '/api/research/industry') {
        if (q === '发那') {
          return { data: { success: true, items: [fanucIndustry] } }
        }
        if (q === '马扎') {
          return { data: { success: true, items: [mazakIndustry] } }
        }
        return { data: { success: true, items: [] } }
      }
      if (path === '/api/research/industry/resolve') {
        if (q === '发那') {
          return { data: { success: true, hit: fanucIndustry } }
        }
        if (q === '马扎') {
          return { data: { success: true, hit: mazakIndustry } }
        }
        return { data: { success: true, hit: null } }
      }
      return { data: { success: true } }
    })

    const onNavigate = vi.fn()
    renderPredict(
      <ResearchCompanyPredictInput teamSlug="hr" debounceMs={250} onNavigate={onNavigate} />,
    )

    const input = screen.getByTestId('research-company-search')
    typeQuery(input, '发那')
    await flushDebouncedFetch(250)

    expect(screen.getByRole('option', { name: /发那科/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /山崎马扎克/ })).not.toBeInTheDocument()

    // Query change must clear prior matches immediately (before debounce settles)
    typeQuery(input, '马扎')

    expect(screen.queryByRole('option', { name: /发那科/ })).not.toBeInTheDocument()
    // During debounce: no stale A options clickable; loading may show
    expect(screen.queryByRole('option')).not.toBeInTheDocument()

    await flushDebouncedFetch(250)

    expect(screen.queryByRole('option', { name: /发那科/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /山崎马扎克/ })).toBeInTheDocument()
  })
})
