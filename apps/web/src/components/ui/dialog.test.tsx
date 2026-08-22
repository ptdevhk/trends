import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { mockT } = vi.hoisted(() => ({
  mockT: vi.fn((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT, i18n: { language: 'en' } }),
}))

import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog'

describe('Dialog close button i18n', () => {
  it('localizes the close button through t("common.close")', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Description</DialogDescription>
        </DialogContent>
      </Dialog>
    )
    expect(mockT).toHaveBeenCalledWith(
      'common.close',
      expect.objectContaining({ defaultValue: 'Close' })
    )
  })
})
