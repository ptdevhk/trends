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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
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
})
