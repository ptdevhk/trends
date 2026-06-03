import { describe, expect, it } from 'vitest'
import { EXPORT_FIELD_KEYS } from '@trends/shared'
import { FIELD_GROUPS, FIELD_LABELS } from './SystemSettingsExportFieldsPage.metadata'

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
