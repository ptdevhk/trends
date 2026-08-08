import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CompanyResearchStrip } from './CompanyResearchStrip'

const getMock = vi.fn()

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => getMock(...args),
  },
}))

const mockT = (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

describe('CompanyResearchStrip', () => {
  beforeEach(() => {
    getMock.mockReset()
    window.history.replaceState({}, '', '/hr/resumes')
  })

  it('shows live count and link', async () => {
    getMock.mockResolvedValue({
      data: {
        success: true,
        items: [{ title: '宝力机械招聘', kind: 'hiring_signal' }],
        meta: { liveCount: 2, showcaseCount: 0, liveFirst: true },
      },
    })
    render(
      <MemoryRouter>
        <CompanyResearchStrip companyKey="pro-technic-machinery" />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('company-research-strip')).toBeInTheDocument()
    })
    expect(screen.getByTestId('company-research-strip-link')).toHaveAttribute(
      'href',
      '/hr/research/pro-technic-machinery?persona=hr',
    )
    expect(screen.getByTestId('company-research-strip-count')).toHaveTextContent('2')
    expect(screen.getByTestId('company-research-strip-title')).toHaveTextContent('宝力机械招聘')
    expect(getMock).toHaveBeenCalledWith(
      '/api/research/companies/pro-technic-machinery/signals',
      expect.anything(),
    )
  })

  it('soft empty when no signals', async () => {
    getMock.mockResolvedValue({
      data: {
        success: true,
        items: [],
        meta: { liveCount: 0, showcaseCount: 0, liveFirst: true },
      },
    })
    render(
      <MemoryRouter>
        <CompanyResearchStrip companyKey="fanuc" />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('company-research-strip-empty')).toBeInTheDocument()
    })
    expect(screen.getByTestId('company-research-strip-count')).toHaveTextContent('0')
  })
})
