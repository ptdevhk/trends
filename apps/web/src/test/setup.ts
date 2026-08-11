import { expect, vi } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'
import * as React from 'react'

process.env.NODE_ENV = 'test'

expect.extend(matchers)

// ---------------------------------------------------------------------------
// React version guard.
//
// vitest.config.ts aliases every react/react-dom import to the ROOT copy so
// tests and @testing-library/react share one reconciler. Root react is pinned
// as a root devDependency (^19); if the root hoist ever drifts back to 18 (a
// stale lockfile, a removed root pin), app code and @testing-library/react
// resolve to different React majors inside one jsdom process — divergent
// act()/effect behavior, flaky races, and CI stalls (the July-2026 incident;
// note the update-depth guard code is identical in 18/19, so the failure was
// the mixed-reconciler split, not React 18 itself). The guard turns that
// drift into an immediate, legible failure. If it trips, run `npm install` at
// the repo root and confirm node_modules/react is 19.x.
// ---------------------------------------------------------------------------
if (!React.version.startsWith('19.')) {
  throw new Error(
    `Tests must run on React 19 (root react is pinned as a root devDependency); ` +
      `resolved React ${React.version}. Run \`npm install\` at the repo root and check ` +
      `node_modules/react/package.json — vitest.config.ts aliases react to the root copy.`,
  )
}

// ---------------------------------------------------------------------------
// Shared react-i18next mock for all tests.
//
// IMPORTANT: `t` and `i18n` must be module-scope (stable identity). An inline
// `t` inside useTranslation() creates a new function on every render, which
// makes any useCallback([..., t]) unstable — mount effects then re-run on
// every render and the component enters an infinite update loop that silently
// stalls CI ("Maximum update depth exceeded"). Individual tests can override
// with their own vi.mock('react-i18next', ...), but the override must also
// return a stable `t` (module-scope).
// ---------------------------------------------------------------------------
const mockT = (key: string, opts?: string | Record<string, unknown>) => {
  if (typeof opts === 'string') {
    return opts
  }
  if (opts?.defaultValue && typeof opts.defaultValue === 'string') {
    return opts.defaultValue.replace(
      /\{\{(\w+)\}\}/g,
      (_match: string, varName: string) => String(opts[varName] ?? `{{${varName}}}`),
    )
  }
  return key
}

const mockI18n = {
  language: 'en',
  languages: ['en', 'zh-Hans', 'zh-Hant'],
  changeLanguage: () => Promise.resolve(),
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT, i18n: mockI18n }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
}))
