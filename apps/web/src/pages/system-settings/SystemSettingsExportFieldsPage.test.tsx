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

function addFieldButton(field: keyof typeof FIELD_LABELS) {
  return screen.getByRole('button', { name: `Add ${FIELD_LABELS[field]}` })
}

function removeFieldButton(field: keyof typeof FIELD_LABELS) {
  return screen.getByRole('button', { name: `Remove ${FIELD_LABELS[field]}` })
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

  it('places jobIntention in Detail - Profile after selfIntro and off by default', () => {
    const detailProfile = FIELD_GROUPS.find((group) => group.label === 'Detail - Profile')
    expect(detailProfile).toBeDefined()
    expect(detailProfile!.fields).toEqual(['experience', 'workHistory', 'selfIntro', 'jobIntention'])
    expect(EXPORT_CORE_FIELDS).not.toContain('jobIntention')
    expect(EXPORT_CORE_FIELDS).toContain('userComment')
  })

  it('orders userComment third in core defaults', () => {
    expect(EXPORT_CORE_FIELDS[0]).toBe('resumeId')
    expect(EXPORT_CORE_FIELDS[1]).toBe('name')
    expect(EXPORT_CORE_FIELDS[2]).toBe('userComment')
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

    // Core fields are checked (selected)
    for (const field of EXPORT_CORE_FIELDS) {
      expect(fieldCheckbox(field)).toBeChecked()
    }
    // Non-core fields are unchecked and show an add button
    for (const field of [...EXPORT_DETAIL_FIELDS, ...EXPORT_DEBUG_FIELDS]) {
      expect(fieldCheckbox(field)).not.toBeChecked()
      expect(addFieldButton(field)).toBeInTheDocument()
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

    expect(fieldCheckbox('experience')).toBeChecked()
    // resumeId is not in the saved config
    expect(fieldCheckbox('resumeId')).not.toBeChecked()
    expect(addFieldButton('resumeId')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Include debug columns when debug mode is enabled' })).toBeChecked()
  })

  it('adds a field from available into export order', async () => {
    const user = userEvent.setup()
    requestJsonMock.mockResolvedValueOnce({ success: true, config: null })

    render(<SystemSettingsExportFieldsPage />)

    await waitFor(() => {
      expect(fieldCheckbox('resumeId')).toBeChecked()
    })

    // jobIntention is off by default -> unchecked with an add button
    expect(fieldCheckbox('jobIntention')).not.toBeChecked()
    expect(addFieldButton('jobIntention')).toBeInTheDocument()

    await user.click(addFieldButton('jobIntention'))

    // After adding, the field is checked and the add button is gone
    expect(fieldCheckbox('jobIntention')).toBeChecked()
    expect(removeFieldButton('jobIntention')).toBeInTheDocument()
  })

  it('toggles a selected field off via its checkbox', async () => {
    const user = userEvent.setup()
    requestJsonMock.mockResolvedValueOnce({ success: true, config: null })

    render(<SystemSettingsExportFieldsPage />)

    await waitFor(() => {
      expect(fieldCheckbox('userComment')).toBeChecked()
    })

    // userComment is selected by default -> uncheck it via its checkbox
    await user.click(fieldCheckbox('userComment'))

    expect(fieldCheckbox('userComment')).not.toBeChecked()
    expect(addFieldButton('userComment')).toBeInTheDocument()
  })

  it('removes a field from export order back to available', async () => {
    const user = userEvent.setup()
    requestJsonMock.mockResolvedValueOnce({ success: true, config: null })

    render(<SystemSettingsExportFieldsPage />)

    await waitFor(() => {
      expect(fieldCheckbox('userComment')).toBeChecked()
    })

    // userComment is selected by default -> has a remove button
    await user.click(removeFieldButton('userComment'))

    // Now userComment is unchecked and available again with an add button
    expect(fieldCheckbox('userComment')).not.toBeChecked()
    expect(addFieldButton('userComment')).toBeInTheDocument()
  })

  it('can deselect an individual field from a fully-selected group', async () => {
    const user = userEvent.setup()
    requestJsonMock.mockResolvedValueOnce({ success: true, config: null })

    render(<SystemSettingsExportFieldsPage />)

    await waitFor(() => {
      expect(fieldCheckbox('name')).toBeChecked()
    })

    // Core - Identity is fully selected (5/5) by default; name is in that group.
    // The individual field checkbox must still be toggleable to deselect it.
    await user.click(fieldCheckbox('name'))

    expect(fieldCheckbox('name')).not.toBeChecked()
    expect(addFieldButton('name')).toBeInTheDocument()
    // The other Core - Identity fields remain selected
    expect(fieldCheckbox('resumeId')).toBeChecked()
  })

  it('collapses and expands a group without losing selection state', async () => {
    const user = userEvent.setup()
    requestJsonMock.mockResolvedValueOnce({ success: true, config: null })

    render(<SystemSettingsExportFieldsPage />)

    await waitFor(() => {
      expect(fieldCheckbox('resumeId')).toBeChecked()
    })

    // Collapse the Core - Identity group
    await user.click(screen.getByRole('button', { name: 'Collapse Core - Identity' }))

    // Field checkboxes are hidden when collapsed
    expect(screen.queryByRole('checkbox', { name: FIELD_LABELS.resumeId })).not.toBeInTheDocument()

    // Expand it back
    await user.click(screen.getByRole('button', { name: 'Expand Core - Identity' }))

    // Selection state is preserved across collapse/expand
    expect(fieldCheckbox('resumeId')).toBeChecked()
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
    expect(addFieldButton('experience')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Include debug columns when debug mode is enabled' })).not.toBeChecked()
  })

  it('reset order re-sorts current selection to canonical order without calling the API', async () => {
    const user = userEvent.setup()
    // Saved config has non-canonical order: experience (detail) before core
    // fields, and userComment pushed to the end instead of its default core
    // position 3 (after resumeId, name).
    requestJsonMock.mockResolvedValueOnce({
      success: true,
      config: {
        fields: ['experience', 'resumeId', 'name', 'userComment'],
        includeDebugWhenEnabled: true,
      },
    })

    render(<SystemSettingsExportFieldsPage />)

    await waitFor(() => {
      expect(fieldCheckbox('experience')).toBeChecked()
    })

    await user.click(screen.getByRole('button', { name: 'Reset order' }))

    // No PUT call - reset order is a local edit only
    expect(requestJsonMock).toHaveBeenLastCalledWith('/api/config/export-fields')

    // Selection set is preserved
    expect(fieldCheckbox('resumeId')).toBeChecked()
    expect(fieldCheckbox('name')).toBeChecked()
    expect(fieldCheckbox('userComment')).toBeChecked()
    expect(fieldCheckbox('experience')).toBeChecked()
    // includeDebug flag is preserved
    expect(screen.getByRole('checkbox', { name: 'Include debug columns when debug mode is enabled' })).toBeChecked()

    // Canonical order is EXPORT_CORE_FIELDS then EXPORT_DETAIL_FIELDS:
    //   resumeId(1), name(2), userComment(3), ..., experience(detail)
    const positionOf = (field: keyof typeof FIELD_LABELS) =>
      removeFieldButton(field).closest('div')?.querySelector('.tabular-nums')?.textContent
    expect(positionOf('resumeId')).toBe('1')
    expect(positionOf('name')).toBe('2')
    expect(positionOf('userComment')).toBe('3')
    // experience is a detail field -> comes after all selected core fields
    expect(Number(positionOf('experience'))).toBeGreaterThan(3)
  })
})
