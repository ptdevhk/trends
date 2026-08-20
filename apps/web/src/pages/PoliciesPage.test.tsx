import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const mockUseCompanyPolicies = vi.fn()
const authMock = vi.hoisted(() => ({ memberships: [] as Array<{ userId: string; workspaceSlug: string; role: string }> }))

vi.mock('@/hooks/useCompanyPolicies', () => ({
  useCompanyPolicies: (...args: unknown[]) => mockUseCompanyPolicies(...args),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authMock,
}))

vi.mock('@/pages/BlacklistPage', () => ({
  BlacklistPage: () => <div data-testid="blacklist-page">Candidate blocks</div>,
}))

vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ title }: { title?: string }) => <div>{title || 'Policies'}</div>,
}))

const mockT = (key: string, options?: Record<string, unknown>) => {
  let value = (options?.defaultValue as string | undefined) ?? key
  if (options) {
    for (const [name, replacement] of Object.entries(options)) {
      value = value.replaceAll(`{{${name}}}`, String(replacement))
    }
  }
  return value
}

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
    authMock.memberships = [{ userId: 'u1', workspaceSlug: 'hr', role: 'admin' }]
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
      marketPolicies: { cn: [], my: [] },
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

  it('switches policy scope to a market and shows the market column header', () => {
    mockUseCompanyPolicies.mockReturnValue({
      ...mockUseCompanyPolicies(),
      marketPolicies: {
        cn: [
          {
            companyKey: 'pro-technic-machinery',
            displayName: '宝力机械 / Pro-Technic Machinery',
            status: 'confirmed',
            scopeType: 'market',
            scopeId: 'cn',
            revision: 2,
            effects: { rankingEffect: 'band_known_bad' },
            createdAt: 1,
          },
        ],
        my: [],
      },
    })
    renderPolicies('/hr/settings/policies?tab=companies')

    // Workspace scope first: the workspace known-good row is shown.
    expect(screen.getAllByText(/Known good/i).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByTestId('policy-scope-cn'))

    // Market column header and per-row state now reflect the CN market row.
    expect(screen.getByText('CN market policy')).toBeInTheDocument()
    expect(screen.getAllByText(/^No-hire$/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/rev 2 · band_known_bad/)).toBeInTheDocument()
  })

  it('writes preset changes to the active market scope', () => {
    renderPolicies('/hr/settings/policies?tab=companies')

    fireEvent.click(screen.getByTestId('policy-scope-my'))
    fireEvent.click(screen.getByTestId('company-preset-no-hire'))

    const { setPolicyPreset } = mockUseCompanyPolicies()
    expect(setPolicyPreset).toHaveBeenCalledWith('pro-technic-machinery', 'no_hire', undefined, 'my')
  })

  it('writes preset changes to the workspace scope by default', () => {
    renderPolicies('/hr/settings/policies?tab=companies')

    fireEvent.click(screen.getByTestId('company-preset-known-good'))

    const { setPolicyPreset } = mockUseCompanyPolicies()
    expect(setPolicyPreset).toHaveBeenCalledWith(
      'pro-technic-machinery',
      'known_good',
      undefined,
      'workspace',
    )
  })

  it('shows market-scoped hints when a market has no policy rows', () => {
    renderPolicies('/hr/settings/policies?tab=companies')

    fireEvent.click(screen.getByTestId('policy-scope-cn'))

    expect(screen.getByText('No CN market policy yet')).toBeInTheDocument()
  })

  it('shows the market empty state when the registry has no companies', () => {
    mockUseCompanyPolicies.mockReturnValue({
      ...mockUseCompanyPolicies(),
      companies: [],
      policies: [],
    })
    renderPolicies('/hr/settings/policies?tab=companies')

    fireEvent.click(screen.getByTestId('policy-scope-cn'))

    expect(screen.getByText(/No CN market policy yet/)).toBeInTheDocument()
  })

  it('shows all three scope tabs to a workspace admin', () => {
    renderPolicies('/hr/settings/policies?tab=companies')
    expect(screen.getByTestId('policy-scope-workspace')).toBeInTheDocument()
    expect(screen.getByTestId('policy-scope-cn')).toBeInTheDocument()
    expect(screen.getByTestId('policy-scope-my')).toBeInTheDocument()
  })

  it('hides market scope tabs from a non-admin workspace member', () => {
    authMock.memberships = [{ userId: 'u1', workspaceSlug: 'hr', role: 'user' }]
    renderPolicies('/hr/settings/policies?tab=companies')
    expect(screen.getByTestId('policy-scope-workspace')).toBeInTheDocument()
    expect(screen.queryByTestId('policy-scope-cn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('policy-scope-my')).not.toBeInTheDocument()
  })

  it('hides market scope tabs when the user is an admin of another workspace only', () => {
    authMock.memberships = [{ userId: 'u1', workspaceSlug: 'dev', role: 'admin' }]
    renderPolicies('/hr/settings/policies?tab=companies')
    expect(screen.getByTestId('policy-scope-workspace')).toBeInTheDocument()
    expect(screen.queryByTestId('policy-scope-cn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('policy-scope-my')).not.toBeInTheDocument()
  })

  it('creates a company on form submit (Enter-to-create path)', () => {
    const { upsertCompany } = mockUseCompanyPolicies()
    upsertCompany.mockResolvedValue(true)
    renderPolicies('/hr/settings/policies?tab=companies')

    fireEvent.change(screen.getByTestId('company-new-key'), { target: { value: 'acme-cnc' } })
    fireEvent.change(screen.getByTestId('company-new-display-name'), { target: { value: 'Acme CNC' } })
    const form = screen.getByTestId('company-new-key').closest('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form!)

    expect(upsertCompany).toHaveBeenCalledWith(
      expect.objectContaining({ companyKey: 'acme-cnc', displayName: 'Acme CNC' }),
    )
  })

  it('adds an alias on Enter in the alias input', () => {
    const { addAlias } = mockUseCompanyPolicies()
    addAlias.mockResolvedValue(true)
    renderPolicies('/hr/settings/policies?tab=companies')

    fireEvent.change(screen.getByTestId('company-alias-input'), { target: { value: '宝力' } })
    fireEvent.keyDown(screen.getByTestId('company-alias-input'), { key: 'Enter' })

    expect(addAlias).toHaveBeenCalledWith('pro-technic-machinery', '宝力')
  })

  it('blocks implicit create submit while IME composition is in flight', () => {
    renderPolicies('/hr/settings/policies?tab=companies')

    const keyDownEvent = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true })
    const preventDefaultSpy = vi.spyOn(keyDownEvent, 'preventDefault')
    fireEvent(screen.getByTestId('company-new-key'), keyDownEvent)

    expect(preventDefaultSpy).toHaveBeenCalled()
  })
})
