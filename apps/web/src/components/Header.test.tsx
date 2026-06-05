import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { Header } from './Header'

const mockState = vi.hoisted(() => ({
  slug: 'dev',
  name: 'Development',
  isAdmin: true,
}))

function renderMockLink(
  kind: 'link' | 'nav-link',
  to: string,
  state: unknown,
  className: string | ((options: { isActive: boolean }) => string) | undefined,
  children: ReactNode
) {
  const resolvedClassName = typeof className === 'function' ? className({ isActive: false }) : className
  return (
    <a
      href={to}
      data-kind={kind}
      data-reset={state !== null && typeof state === 'object' && 'resetResumeSearch' in state
        && state.resetResumeSearch === true ? 'true' : 'false'}
      className={resolvedClassName}
    >
      {children}
    </a>
  )
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const values: Record<string, string> = {
        'app.title': 'Trends',
        'app.subtitle': 'Trends',
        'nav.resumes': 'Resumes',
        'nav.reviewPackets': 'Review packets',
        'nav.settings': 'Settings',
        'nav.system': 'System from i18n',
      }
      return values[key] ?? key
    },
  }),
}))

vi.mock('react-router-dom', () => ({
  Link: ({
    to,
    state,
    className,
    children,
  }: {
    to: string
    state?: unknown
    className?: string
    children: ReactNode
  }) => renderMockLink('link', to, state, className, children),
  NavLink: ({
    to,
    state,
    className,
    children,
  }: {
    to: string
    state?: unknown
    className?: string | ((options: { isActive: boolean }) => string)
    children: ReactNode
  }) => renderMockLink('nav-link', to, state, className, children),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => mockState,
}))

vi.mock('./LanguageSwitcher', () => ({
  LanguageSwitcher: () => <div>Language Switcher</div>,
}))

vi.mock('./WorkspaceSwitcher', () => ({
  WorkspaceSwitcher: () => <div>Workspace Switcher</div>,
}))

const featureFlagsMock = vi.hoisted(() => ({
  reviewPacketsEnabled: true,
}))

vi.mock('@/lib/feature-flags', () => ({
  isReviewPacketsEnabled: () => featureFlagsMock.reviewPacketsEnabled,
}))

describe('Header', () => {
  beforeEach(() => {
    mockState.slug = 'dev'
    mockState.name = 'Development'
    mockState.isAdmin = true
    featureFlagsMock.reviewPacketsEnabled = true
  })

  it('sends resume home reset state on logo and resumes navigation links', () => {
    render(<Header />)

    const logoLink = screen.getByRole('link', { name: 'TrendsTrends' })
    expect(logoLink).toHaveAttribute('href', '/dev/resumes')
    expect(logoLink).toHaveAttribute('data-reset', 'true')

    const resumeLinks = screen.getAllByRole('link', { name: 'Resumes' })
    expect(resumeLinks).toHaveLength(2)
    resumeLinks.forEach((link) => {
      expect(link).toHaveAttribute('href', '/dev/resumes')
      expect(link).toHaveAttribute('data-reset', 'true')
    })
  })

  it('does not attach resume reset state to review packets, settings, or system links', () => {
    render(<Header />)

    const reviewPacketLinks = screen.getAllByRole('link', { name: 'Review packets' })
    expect(reviewPacketLinks).toHaveLength(2)
    reviewPacketLinks.forEach((link) => {
      expect(link).toHaveAttribute('href', '/dev/review-packets')
      expect(link).toHaveAttribute('data-reset', 'false')
    })

    const settingsLinks = screen.getAllByRole('link', { name: 'Settings' })
    expect(settingsLinks).toHaveLength(2)
    settingsLinks.forEach((link) => {
      expect(link).toHaveAttribute('href', '/dev/settings')
      expect(link).toHaveAttribute('data-reset', 'false')
    })

    const systemLinks = screen.getAllByRole('link', { name: 'System from i18n' })
    expect(systemLinks).toHaveLength(2)
    systemLinks.forEach((link) => {
      expect(link).toHaveAttribute('href', '/dev/system')
      expect(link).toHaveAttribute('data-reset', 'false')
    })
  })

  it('hides review packets nav links when feature flag is off', () => {
    featureFlagsMock.reviewPacketsEnabled = false

    render(<Header />)

    const reviewPacketLinks = screen.queryAllByRole('link', { name: 'Review packets' })
    expect(reviewPacketLinks).toHaveLength(0)

    // Other nav links are still visible
    const resumeLinks = screen.getAllByRole('link', { name: 'Resumes' })
    expect(resumeLinks).toHaveLength(2)

    const settingsLinks = screen.getAllByRole('link', { name: 'Settings' })
    expect(settingsLinks).toHaveLength(2)
  })
})
