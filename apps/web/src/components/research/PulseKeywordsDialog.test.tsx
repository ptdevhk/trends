import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { PulseKeywordsDialog, type PulseKeywordsDialogState } from './PulseKeywordsDialog'

// Module-scope t keeps callback deps stable (see CLAUDE.md test/CI conventions).
vi.mock('react-i18next', () => {
  const mockT = (key: string, opts?: { defaultValue?: string; count?: number }) => {
    const base = opts?.defaultValue ?? key
    return opts?.count === undefined ? base : base.replace('{{count}}', String(opts.count))
  }
  return { useTranslation: () => ({ t: mockT }) }
})

/**
 * Seed mirrors the real payload shape after the 2026-09-19 exclude_conglomerates_keep_cnc
 * decision: the catalog group keeps dropped surfaces, defaultKeywords does not.
 */
const state: PulseKeywordsDialogState = {
  seed: {
    version: 'v1',
    groups: [
      { id: 'cnc-core', label: '数控机床', keywords: ['数控', '加工中心', '创世纪'] },
      {
        id: 'industry-catalog',
        label: '行业全量目录',
        keywords: ['数控', '创世纪', '三菱', 'MITSUBISHI', '大富科技股份有限公司'],
      },
    ],
    defaultKeywords: ['数控', '加工中心', '创世纪'],
    excludedKeywords: ['三菱', 'MITSUBISHI'],
  },
  workspace: { version: 1, enabled: [], excluded: [], custom: [] },
  effective: ['数控', '加工中心', '创世纪'],
}

function renderDialog(onSave = vi.fn()) {
  render(
    <PulseKeywordsDialog open onOpenChange={() => {}} initial={state} onSave={onSave} />,
  )
  return onSave
}

describe('PulseKeywordsDialog optional-catalog re-enable', () => {
  it('offers only surfaces the defaults do not already cover', () => {
    renderDialog()
    const catalog = screen.getByTestId('pulse-keywords-catalog')
    const toggles = within(catalog).getAllByTestId('pulse-keyword-catalog-toggle')
    const keywords = toggles.map((el) => el.getAttribute('data-keyword'))

    // Dropped conglomerate + a catalog-only company are re-enableable …
    expect(keywords).toContain('三菱')
    expect(keywords).toContain('大富科技股份有限公司')
    // … while defaults already present are NOT duplicated into the panel.
    expect(keywords).not.toContain('创世纪')
    expect(keywords).not.toContain('数控')
  })

  it('saving untouched keeps the workspace overlay additive and empty', () => {
    const onSave = renderDialog()
    fireEvent.click(screen.getByTestId('pulse-keywords-save'))
    expect(onSave).toHaveBeenCalledWith({ enabled: [], excluded: [], custom: [] })
  })

  it('ticking a dropped catalog token adds it to enabled (not to excluded)', () => {
    const onSave = renderDialog()
    const catalog = screen.getByTestId('pulse-keywords-catalog')
    const toggle = within(catalog)
      .getAllByTestId('pulse-keyword-catalog-toggle')
      .find((el) => el.getAttribute('data-keyword') === '三菱') as HTMLInputElement
    expect(toggle.checked).toBe(false)

    fireEvent.click(toggle)
    expect(toggle.checked).toBe(true)
    fireEvent.click(screen.getByTestId('pulse-keywords-save'))

    expect(onSave).toHaveBeenCalledTimes(1)
    const body = onSave.mock.calls[0]![0] as { enabled: string[]; excluded: string[] }
    expect(body.enabled).toEqual(['三菱'])
    expect(body.excluded).toEqual([])
  })

  it('unchecking a default still lands in excluded alongside the re-enable list', () => {
    const onSave = renderDialog()
    const defaults = screen.getByTestId('pulse-keywords-defaults')
    const first = within(defaults).getAllByTestId('pulse-keyword-default-toggle')[0] as HTMLInputElement
    fireEvent.click(first)

    const catalog = screen.getByTestId('pulse-keywords-catalog')
    const toggle = within(catalog)
      .getAllByTestId('pulse-keyword-catalog-toggle')
      .find((el) => el.getAttribute('data-keyword') === 'MITSUBISHI') as HTMLInputElement
    fireEvent.click(toggle)
    fireEvent.click(screen.getByTestId('pulse-keywords-save'))

    const body = onSave.mock.calls[0]![0] as { enabled: string[]; excluded: string[] }
    expect(body.enabled).toEqual(['MITSUBISHI'])
    expect(body.excluded).toEqual(['数控'])
  })
})
