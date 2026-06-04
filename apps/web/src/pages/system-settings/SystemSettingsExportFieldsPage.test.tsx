import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EXPORT_CORE_FIELDS,
  EXPORT_DEBUG_FIELDS,
  EXPORT_DETAIL_FIELDS,
  EXPORT_FIELD_KEYS,
} from '@trends/shared'
import { FIELD_GROUPS, FIELD_LABELS } from './SystemSettingsExportFieldsPage.metadata'

const requestJsonMock = vi.hoisted(() => vi.fn())
const tMock = vi.hoisted(() =>
  vi.fn((key: string, options?: string | { defaultValue?: string }) => {
    if (typeof options === 'string') {
      return options
    }
    return options?.defaultValue ?? key
  }),
)

vi.mock('@/pages/system-settings/lib', () => ({
  useSettingsRequestJson: () => ({ requestJson: requestJsonMock }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tMock }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { SystemSettingsExportFieldsPage } from './SystemSettingsExportFieldsPage'

function fieldCheckbox(field: keyof typeof FIELD_LABELS) {
  return screen.getByRole('checkbox', { name: FIELD_LABELS[field] })
}

describe('SystemSettingsExportFieldsPage export field metadata', () => {
  it('defines one group path for every export field key', () => {
    const groupedFields = FIELD_GROUPS.flatMap((group) => group.fields)

    expect(new Set(groupedFields).size).toBe(groupedFields.length)
    expect([...groupedFields].sort()).toEqual([...EXPORT_FIELD_KEYS].sort())
  })

  it('has a label for every export field', () => {
    expect(Object.keys(FIELD_LABELS).sort()).toEqual([...EXPORT_FIELD_KEYS].sort())
  })

  it('keeps userRating and scoring audit fields toggleable', () => {
    const groupedFields = new Set(FIELD_GROUPS.flatMap((group) => group.fields))

    expect(groupedFields.has('userRating')).toBe(true)
    expect(groupedFields.has('finalAiScore')).toBe(true)
    expect(groupedFields.has('relatedExpAuditFactor')).toBe(true)
    expect(groupedFields.has('relatedExpContribution')).toBe(true)
  })
})

describe('SystemSettingsExportFieldsPage state', () => {
  beforeEach(() => {
    requestJsonMock.mockReset()
  })

  it('shows effective core defaults as selected when no workspace config exists', async () => {
    requestJsonMock.mockResolvedValueOnce({ success: true, config: null })

    render(<SystemSettingsExportFieldsPage />)

    await waitFor(() => {
      expect(fieldCheckbox('resumeId')).toBeChecked()
    })

    for (const field of EXPORT_CORE_FIELDS) {
      expect(fieldCheckbox(field)).toBeChecked()
    }
    for (const field of [...EXPORT_DETAIL_FIELDS, ...EXPORT_DEBUG_FIELDS]) {
      expect(fieldCheckbox(field)).not.toBeChecked()
    }
    expect(screen.getByText('Using default columns. Configure below to customize.')).toBeInTheDocument()
  })

  it('uses saved config selections instead of defaults when config exists', async () => {
    requestJsonMock.mockResolvedValueOnce({
      success: true,
      config: { fields: ['name', 'experience'], includeDebugWhenEnabled: true },
    })

    render(<SystemSettingsExportFieldsPage />)

    await waitFor(() => {
      expect(fieldCheckbox('name')).toBeChecked()
    })

    expect(fieldCheckbox('resumeId')).not.toBeChecked()
    expect(fieldCheckbox('experience')).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Include debug columns when debug mode is enabled' })).toBeChecked()
  })

  it('resets visible state back to effective defaults', async () => {
    const user = userEvent.setup()
    requestJsonMock
      .mockResolvedValueOnce({
        success: true,
        config: { fields: ['name', 'experience'], includeDebugWhenEnabled: true },
      })
      .mockResolvedValueOnce({ success: true, config: null })

    render(<SystemSettingsExportFieldsPage />)

    await waitFor(() => {
      expect(fieldCheckbox('experience')).toBeChecked()
    })

    await user.click(screen.getByRole('button', { name: 'Reset to defaults' }))

    expect(requestJsonMock).toHaveBeenLastCalledWith('/api/config/export-fields', {
      method: 'PUT',
      body: JSON.stringify({ fields: [] }),
    })
    for (const field of EXPORT_CORE_FIELDS) {
      expect(fieldCheckbox(field)).toBeChecked()
    }
    expect(fieldCheckbox('experience')).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Include debug columns when debug mode is enabled' })).not.toBeChecked()
  })
})
