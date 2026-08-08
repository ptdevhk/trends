import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const mockUseCompanyPolicies = vi.fn()

vi.mock('@/hooks/useCompanyPolicies', () => ({
  useCompanyPolicies: (...args: unknown[]) => mockUseCompanyPolicies(...args),
}))

vi.mock('@/pages/BlacklistPage', () => ({
  BlacklistPage: () => <div data-testid="blacklist-page">Candidate blocks</div>,
}))

vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ title }: { title?: string }) => <div>{title || 'Policies'}</div>,
}))

const mockT = (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    slug: 'hr',
  }),
}))

import { PoliciesPage } from './PoliciesPage'

function renderPolicies(initialEntry = '/hr/settings/policies') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/:teamSlug/settings/policies" element={<PoliciesPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PoliciesPage', () => {
  beforeEach(() => {
    mockUseCompanyPolicies.mockReturnValue({
      companies: [
        {
          _id: '1',
          companyKey: 'pro-technic-machinery',
          status: 'confirmed',
          displayName: '宝力机械 / Pro-Technic Machinery',
          nameCn: '宝力机械',
          nameEn: 'Pro-Technic Machinery',
          createdAt: 1,
          updatedAt: 1,
          aliases: [{ aliasDisplay: '宝力机械', aliasNormalized: '宝力机械', source: 'seed' }],
        },
        {
          _id: '2',
          companyKey: 'legacy-cnc',
          status: 'confirmed',
          displayName: 'Legacy CNC',
          createdAt: 1,
          updatedAt: 1,
          archivedAt: 42,
          aliases: [],
        },
      ],
      policies: [
        {
          companyKey: 'pro-technic-machinery',
          displayName: '宝力机械 / Pro-Technic Machinery',
          status: 'confirmed',
          scopeType: 'workspace',
          scopeId: 'hr',
          revision: 1,
          effects: { rankingEffect: 'band_known_good' },
          createdAt: 1,
        },
      ],
      loading: false,
      error: null,
      load: vi.fn(),
      seedCanonical: vi.fn(),
      upsertCompany: vi.fn(),
      addAlias: vi.fn(),
      setPolicyPreset: vi.fn().mockResolvedValue(true),
      setCompanyArchived: vi.fn().mockResolvedValue(true),
    })
  })

  it('shows candidates tab by default', () => {
    renderPolicies()
    expect(screen.getByTestId('blacklist-page')).toBeInTheDocument()
  })

  it('switches to companies tab and shows Pro-Technic policy', () => {
    renderPolicies('/hr/settings/policies?tab=companies')
    expect(screen.getByTestId('company-policies-panel')).toBeInTheDocument()
    expect(screen.getAllByText(/Pro-Technic Machinery/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Known good/i).length).toBeGreaterThan(0)
  })

  it('can click companies tab from candidates', () => {
    renderPolicies()
    fireEvent.click(screen.getByTestId('policies-tab-companies'))
    expect(screen.getByTestId('company-policies-panel')).toBeInTheDocument()
  })

  it('hides archived companies by default and reveals them via the toggle', () => {
    renderPolicies('/hr/settings/policies?tab=companies')
    expect(screen.queryByText(/Legacy CNC/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('company-show-archived-toggle'))
    expect(screen.getByText(/Legacy CNC/)).toBeInTheDocument()
    expect(screen.getByTestId('company-archived-badge')).toBeInTheDocument()
  })

  it('archives and restores a company via the toggle button', () => {
    const { setCompanyArchived } = mockUseCompanyPolicies()
    renderPolicies('/hr/settings/policies?tab=companies')
    // Archive the active Pro-Technic row.
    fireEvent.click(screen.getAllByTestId('company-archive-toggle')[0]!)
    expect(setCompanyArchived).toHaveBeenCalledWith('pro-technic-machinery', true)

    // Restore the archived Legacy CNC row (reveal it first).
    fireEvent.click(screen.getByTestId('company-show-archived-toggle'))
    const restoreButtons = screen
      .getAllByTestId('company-archive-toggle')
      .map((button) => button.textContent)
    expect(restoreButtons).toContain('Restore')
    const legacyRow = screen.getByText(/Legacy CNC/)
    fireEvent.click(legacyRow.closest('tr')!.querySelector('[data-testid="company-archive-toggle"]')!)
    expect(setCompanyArchived).toHaveBeenCalledWith('legacy-cnc', false)
  })
})
