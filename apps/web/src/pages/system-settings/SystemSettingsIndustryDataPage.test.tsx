import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRequestJson = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: mockToast,
}))

const mockT = (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}))

vi.mock('@/pages/system-settings/lib', () => ({
  useSettingsRequestJson: () => ({
    apiBaseUrl: 'http://localhost:8000',
    requestJson: (path: string, init?: RequestInit) => mockRequestJson(path, init),
  }),
}))

vi.mock('@/lib/ui-error-reporting', () => ({
  reportUiError: vi.fn(),
}))

import { SystemSettingsIndustryDataPage } from './SystemSettingsIndustryDataPage'

describe('SystemSettingsIndustryDataPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequestJson.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/industry-data/entries')) {
        return {
          success: true,
          entries: [
            {
              entryType: 'brand',
              entryId: 'brand-1',
              data: {
                id: 1,
                nameCn: '发那科',
                nameEn: 'FANUC',
                type: '加工中心',
                origin: 'international',
              },
            },
          ],
        }
      }
      if (path.startsWith('/api/industry-data/schedule')) {
        return { success: true, paused: false }
      }
      if (path.startsWith('/api/industry-data/audit')) {
        return { success: true, items: [] }
      }
      if (path.startsWith('/api/company-industry-maintenance-runs')) {
        return { success: true, items: [] }
      }
      if (path === '/api/industry-data/trigger') {
        return { success: true, runId: 'run-scoped', coalesced: false }
      }
      return { success: true }
    })
  })

  it('renders Manage, Control center, and Audit tabs', async () => {
    render(<SystemSettingsIndustryDataPage />)
    expect(screen.getByTestId('industry-data-tab-manage')).toBeInTheDocument()
    expect(screen.getByTestId('industry-data-tab-control')).toBeInTheDocument()
    expect(screen.getByTestId('industry-data-tab-audit')).toBeInTheDocument()
  })

  it('Manage lists a brand from mocked /api/industry-data/entries', async () => {
    render(<SystemSettingsIndustryDataPage />)
    expect(await screen.findByText('发那科')).toBeInTheDocument()
    expect(screen.getByTestId('industry-data-row-brand-1')).toBeInTheDocument()
    const entryCalls = mockRequestJson.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('/api/industry-data/entries'),
    )
    expect(entryCalls.length).toBeGreaterThan(0)
  })

  it('Control center scoped-trigger form posts companyKey to /api/industry-data/trigger', async () => {
    const user = userEvent.setup()
    render(<SystemSettingsIndustryDataPage />)

    await user.click(screen.getByTestId('industry-data-tab-control'))
    await waitFor(() => {
      expect(screen.getByTestId('industry-data-company-key')).toBeInTheDocument()
    })

    await user.type(screen.getByTestId('industry-data-company-key'), 'lung-kee-metal')
    await user.click(screen.getByTestId('industry-data-scoped-trigger'))

    await waitFor(() => {
      expect(mockRequestJson).toHaveBeenCalledWith(
        '/api/industry-data/trigger',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ companyKey: 'lung-kee-metal' }),
        }),
      )
    })
    expect(mockToast.success).toHaveBeenCalled()
  })
})
