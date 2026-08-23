import { render, screen, waitFor, within } from '@testing-library/react'
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

const mockT = (key: string, opts?: { defaultValue?: string }) => {
  const value = opts?.defaultValue ?? key
  if (!opts) return value
  return value.replace(/\{\{(\w+)\}\}/g, (match: string, name: string) =>
    String((opts as Record<string, unknown>)[name] ?? match),
  )
}

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
    mockRequestJson.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/api/industry-data/entries') && init?.method === 'DELETE') {
        return { success: true, gitSha: 'abc1234' }
      }
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

  it('cancelling the row delete confirmation does not call DELETE', async () => {
    const user = userEvent.setup()
    render(<SystemSettingsIndustryDataPage />)

    expect(await screen.findByText('发那科')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByText('Delete industry data entry?')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByText(/brand-1/)).toBeInTheDocument()

    await user.click(screen.getByTestId('industry-data-delete-cancel'))

    expect(screen.queryByText('Delete industry data entry?')).not.toBeInTheDocument()
    const deleteCalls = mockRequestJson.mock.calls.filter(
      (call) => typeof call[1] === 'object' && call[1] !== null && (call[1] as RequestInit).method === 'DELETE',
    )
    expect(deleteCalls).toHaveLength(0)
  })

  it('deletes an entry after confirming the row delete dialog', async () => {
    const user = userEvent.setup()
    render(<SystemSettingsIndustryDataPage />)

    expect(await screen.findByText('发那科')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByText('Delete industry data entry?')).toBeInTheDocument()
    await user.click(screen.getByTestId('industry-data-delete-confirm'))

    await waitFor(() => {
      expect(mockRequestJson).toHaveBeenCalledWith(
        '/api/industry-data/entries/brand-1',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
    expect(mockToast.success).toHaveBeenCalled()
  })
})
