import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { components } from '@/lib/api-types'
import { DebugPage } from './DebugPage'

const useConvexResumesMock = vi.fn()

const tMock = (_key: string, options?: string | { defaultValue?: string }) => {
  if (typeof options === 'string') {
    return options
  }
  return options?.defaultValue ?? _key
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tMock,
  }),
}))

vi.mock('@/hooks/useConvexResumes', () => ({
  useConvexResumes: (...args: unknown[]) => useConvexResumesMock(...args),
}))

vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ title, actions }: { title?: string; actions?: ReactNode }) => (
    <div>
      <div>{title}</div>
      {actions}
    </div>
  ),
}))

vi.mock('@/components/SearchBar', () => ({
  SearchBar: () => <div>SearchBar</div>,
}))

function makeResume(
  overrides: Partial<components['schemas']['ResumeItem']> = {},
): components['schemas']['ResumeItem'] {
  return {
    name: '候选人',
    profileUrl: 'https://hr.job5156.com/resume/view/123',
    activityStatus: 'Active today',
    age: '30',
    experience: '5 years',
    education: 'Bachelor',
    location: '',
    selfIntro: '',
    jobIntention: '销售工程师',
    expectedSalary: '10-15K',
    workHistory: [],
    extractedAt: '2026-03-18T00:00:00.000Z',
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/debug/findings']}>
      <Routes>
        <Route path="/debug/*" element={<DebugPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('DebugPage location aggregation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useConvexResumesMock.mockReturnValue({
      resumes: [
        makeResume({
          name: '张先生',
          location: '广东东莞长安镇',
          locationHierarchy: { country: '中国', province: '广东', city: '东莞', district: '长安' },
        }),
        makeResume({
          name: '李女士',
          locationHierarchy: { country: '中国', province: '广东', city: '东莞', district: '长安' },
        }),
        makeResume({
          name: '陈先生',
          location: '广东深圳宝安区',
          locationHierarchy: { country: '中国', province: '广东', city: '深圳', district: '宝安' },
        }),
      ],
      loading: false,
    })
  })

  it('groups findings by canonical location hierarchy and does not mark hierarchy-backed rows as missing', () => {
    renderPage()

    const dongguanLabel = screen.getByText('广东东莞长安')
    const dongguanRow = dongguanLabel.closest('li')
    if (!dongguanRow) {
      throw new Error('Expected grouped location row for 广东东莞长安')
    }
    expect(within(dongguanRow).getByText('2')).toBeInTheDocument()
    expect(screen.queryByText('广东东莞长安镇')).not.toBeInTheDocument()
    expect(screen.getByText('广东深圳宝安')).toBeInTheDocument()
    expect(screen.getByText('location: 0')).toBeInTheDocument()
  })

  it('hides debug intention aggregations by default', () => {
    renderPage()

    const heading = screen.getByText('debug.findingsIntentions')
    const container = heading.nextElementSibling
    if (!(container instanceof HTMLElement)) {
      throw new Error('Expected intention findings list')
    }

    expect(within(container).getByText('debug.none')).toBeInTheDocument()
    expect(screen.queryByText('销售工程师')).not.toBeInTheDocument()
  })
})
