import { expect, vi } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'

process.env.NODE_ENV = 'test'

expect.extend(matchers)

// Shared react-i18next mock for all tests.
// Individual tests can override with their own vi.mock('react-i18next', ...) if needed.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | Record<string, unknown>) => {
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
    },
    i18n: {
      language: 'en',
      languages: ['en', 'zh-Hans', 'zh-Hant'],
      changeLanguage: () => Promise.resolve(),
    },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
}))
