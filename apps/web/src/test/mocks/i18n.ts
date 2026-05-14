/**
 * Shared react-i18next mock for tests.
 *
 * Usage:
 *   import { mockI18n } from '@/test/mocks/i18n'
 *   vi.mock('react-i18next', () => mockI18n())
 *
 * Or with a custom t implementation:
 *   vi.mock('react-i18next', () => mockI18n({ t: vi.fn().mockImplementation((k) => k) }))
 */

import type { Mock } from 'vitest'

interface MockOptions {
  /** Custom t function. Default: key-return with template interpolation. */
  t?: Mock
}

/**
 * Standard react-i18next mock covering:
 * - useTranslation() → { t, i18n }
 * - Trans component (renders children directly)
 * - t() returns key by default, supports defaultValue string/object,
 *   supports {{var}} template interpolation
 */
export function mockI18n(options?: MockOptions) {
  const defaultT = (key: string, opts?: string | Record<string, unknown>) => {
    if (typeof opts === 'string') {
      return opts
    }
    if (opts?.defaultValue && typeof opts.defaultValue === 'string') {
      return opts.defaultValue.replace(
        /\{\{(\w+)\}\}/g,
        (_match: string, varName: string) => String(opts[varName] ?? `{{${varName}}}`)
      )
    }
    return key
  }

  return {
    useTranslation: () => ({
      t: options?.t ?? defaultT,
      i18n: {
        language: 'en',
        languages: ['en', 'zh-Hans', 'zh-Hant'],
        changeLanguage: () => Promise.resolve(),
      },
    }),
    Trans: ({ children }: { children: React.ReactNode }) => children,
  }
}
