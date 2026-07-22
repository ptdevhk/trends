import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { SettingsSidebar } from './SettingsSidebar'
import { SystemSidebar } from './SystemSidebar'

const mockState = vi.hoisted(() => ({
  pathname: '/dev/settings/blocks',
  slug: 'dev',
  appVersion: '1.2.3',
  isSystemSurface: false,
}))

function renderMockLink(
  to: string,
  state: unknown,
  className: string | undefined,
  children: ReactNode,
  onClick?: (() => void) | undefined
) {
  return (
    <a
      href={to}
      data-reset={state !== null && typeof state === 'object' && 'resetResumeSearch' in state
        && state.resetResumeSearch === true ? 'true' : 'false'}
      className={className}
      onClick={onClick}
    >
      {children}
    </a>
  )
}

vi.mock('react-router-dom', () => ({
  Link: ({
    to,
    state,
    className,
    children,
    onClick,
  }: {
    to: string
    state?: unknown
    className?: string
    children: ReactNode
    onClick?: () => void
  }) => renderMockLink(to, state, className, children, onClick),
  useLocation: () => ({
    pathname: mockState.pathname,
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    slug: mockState.slug,
    isSystemSurface: mockState.isSystemSurface,
  }),
}))

vi.mock('@/hooks/useSystemMetadata', () => ({
  useSystemMetadata: () => ({
    identity: {
      appVersion: mockState.appVersion,
    },
  }),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: ReactNode
    onClick?: () => void
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

function expectResetLinks(container: HTMLElement, href: string, count: number) {
  const links = Array.from(container.querySelectorAll(`a[href="${href}"]`))
  expect(links).toHaveLength(count)
  links.forEach((link) => {
    expect(link).toHaveAttribute('data-reset', 'true')
  })
}

function expectPlainLink(container: HTMLElement, href: string) {
  const link = container.querySelector(`a[href="${href}"]`)
  expect(link).not.toBeNull()
  expect(link).toHaveAttribute('data-reset', 'false')
}

describe('Sidebar reset navigation', () => {
  beforeEach(() => {
    mockState.pathname = '/dev/settings/blocks'
    mockState.slug = 'dev'
    mockState.appVersion = '1.2.3'
    mockState.isSystemSurface = false
  })

  it('attaches resume reset state to settings sidebar home links only', () => {
    const { container } = render(<SettingsSidebar />)

    expectResetLinks(container, '/dev/resumes', 2)
    expectPlainLink(container, '/dev/settings/policies')
  })

  it('attaches resume reset state to system sidebar home links only', () => {
    mockState.pathname = '/admin/system/settings'
    mockState.slug = 'dev'
    mockState.isSystemSurface = true

    const { container } = render(<SystemSidebar />)

    expectResetLinks(container, '/dev/resumes', 2)
    expectPlainLink(container, '/admin/system/settings')
    expectPlainLink(container, '/admin/system/jds')
  })
})
