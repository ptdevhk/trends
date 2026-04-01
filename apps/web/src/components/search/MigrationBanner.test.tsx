import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MigrationBanner } from '@/components/search/MigrationBanner'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') {
        return options
      }

      const defaultValue =
        options && typeof options === 'object' && typeof options.defaultValue === 'string'
          ? options.defaultValue
          : key
      return defaultValue.replace(/\{\{(\w+)\}\}/g, (_, token: string) => {
        const value = options && typeof options === 'object' ? options[token] : undefined
        return value === undefined || value === null ? '' : String(value)
      })
    },
  }),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    slug: 'dev',
  }),
}))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}))

const STORAGE_KEY = 'trends.resume.search-first.migration-banner.dismissed'

describe('MigrationBanner', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('renders the migration copy and search profiles link until dismissed', async () => {
    render(<MigrationBanner />)

    await waitFor(() => {
      expect(screen.getByText('Search Profiles still exist, but the primary resume route is now search-first.')).toBeInTheDocument()
    })

    expect(screen.getByText('Use this page for fast keyword review. Use Search Profiles when you need landing quick starts, scheduled collectors, and JD-driven setup in one place.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Search Profiles' })).toHaveAttribute('href', '/dev/system/profiles')
  })

  it('persists dismissal in local storage', async () => {
    const user = userEvent.setup()

    render(<MigrationBanner />)

    const dismissButton = await screen.findByRole('button', { name: 'Dismiss migration banner' })
    await user.click(dismissButton)

    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
    expect(screen.queryByText('Search Profiles still exist, but the primary resume route is now search-first.')).not.toBeInTheDocument()
  })

  it('stays hidden when already dismissed', () => {
    localStorage.setItem(STORAGE_KEY, '1')

    render(<MigrationBanner />)

    expect(screen.queryByText('Search Profiles still exist, but the primary resume route is now search-first.')).not.toBeInTheDocument()
  })
})
