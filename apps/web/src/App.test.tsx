import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('sonner', () => ({
  Toaster: () => null,
}))

vi.mock('@/components/Header', () => ({
  Header: () => <div>Header</div>,
}))

vi.mock('@/pages/ResumesPage', () => ({
  ResumesPage: () => <div>Resumes Page</div>,
}))

vi.mock('@/pages/ReviewPacketsPage', () => ({
  ReviewPacketsPage: () => <div>Review Packets Page</div>,
}))

const featureFlagsMock = vi.hoisted(() => ({
  reviewPacketsEnabled: true,
}))

vi.mock('@/lib/feature-flags', () => ({
  isReviewPacketsEnabled: () => featureFlagsMock.reviewPacketsEnabled,
}))

vi.mock('@/pages/DebugPage', () => ({
  DebugPage: ({ basePath }: { basePath: string }) => <div>Debug Page {basePath}</div>,
}))

vi.mock('@/pages/DebugJDs', () => ({
  default: () => <div>Debug JDs</div>,
}))

vi.mock('@/pages/DebugAI', () => ({
  default: () => <div>Debug AI</div>,
}))

vi.mock('@/pages/DebugConfig', () => ({
  default: () => <div>Debug Config</div>,
}))

vi.mock('@/pages/DebugIngest', () => ({
  default: () => <div>Debug Ingest</div>,
}))

vi.mock('@/pages/DebugAiTaggingResults', () => ({
  default: () => <div>Debug AI Tagging</div>,
}))

vi.mock('@/pages/BlacklistPage', () => ({
  BlacklistPage: () => <div>Blacklist Page</div>,
}))

vi.mock('@/pages/SearchProfilesPage', () => ({
  SearchProfilesPage: () => <div>Search Profiles Page</div>,
}))

vi.mock('@/pages/SearchAnalyticsPage', () => ({
  default: () => <div>Search Analytics Page</div>,
}))

vi.mock('@/pages/system-settings/SystemSettingsConfigSourcesPage', () => ({
  SystemSettingsConfigSourcesPage: () => <div>Config Sources</div>,
}))

vi.mock('@/pages/system-settings/SystemSettingsKeywordsPage', () => ({
  SystemSettingsKeywordsPage: () => <div>Keywords Page</div>,
}))

vi.mock('@/pages/system-settings/SystemSettingsLocationsPage', () => ({
  SystemSettingsLocationsPage: () => <div>Locations Page</div>,
}))

vi.mock('@/pages/system-settings/SystemSettingsOperationsPage', () => ({
  SystemSettingsOperationsPage: () => <div>Operations Page</div>,
}))

vi.mock('@/pages/system-settings/SystemSettingsRuntimePage', () => ({
  SystemSettingsRuntimePage: () => <div>Runtime Page</div>,
}))

vi.mock('@/layouts/SettingsLayout', () => ({
  default: () => <div>Settings Layout</div>,
}))

vi.mock('@/layouts/SystemLayout', () => ({
  default: () => <div>System Layout</div>,
}))

vi.mock('@/layouts/SystemSettingsLayout', () => ({
  default: () => <div>System Settings Layout</div>,
}))

describe('App redirects', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    featureFlagsMock.reviewPacketsEnabled = true
  })

  it('preserves search params when redirecting a workspace index route to resumes', async () => {
    window.history.replaceState({}, '', '/hr?q=CNC')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/hr/resumes')
      expect(window.location.search).toBe('?q=CNC')
    })

    expect(screen.getByText('Resumes Page')).toBeInTheDocument()
  })

  it('preserves search params when AdminGate redirects a non-admin workspace away from system routes', async () => {
    window.history.replaceState({}, '', '/hr/system?q=CNC&location=Kuala+Lumpur+MY')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/hr/resumes')
      expect(window.location.search).toBe('?q=CNC&location=Kuala+Lumpur+MY')
    })

    expect(screen.getByText('Resumes Page')).toBeInTheDocument()
  })

  it('allows non-admin workspace users to open export field settings', async () => {
    window.history.replaceState({}, '', '/hr/settings/export-fields')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/hr/settings/export-fields')
    })

    expect(screen.getByText('Settings Layout')).toBeInTheDocument()
  })

  it('redirects review-packets to resumes when feature flag is off', async () => {
    featureFlagsMock.reviewPacketsEnabled = false

    window.history.replaceState({}, '', '/dev/review-packets')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/dev/resumes')
    })

    expect(screen.getByText('Resumes Page')).toBeInTheDocument()
  })

  it('preserves search params when an invalid workspace slug falls back to /dev/resumes', async () => {
    window.history.replaceState({}, '', '/unknown/resumes?q=STAR&location=Dongguan')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/dev/resumes')
      expect(window.location.search).toBe('?q=STAR&location=Dongguan')
    })

    expect(screen.getByText('Resumes Page')).toBeInTheDocument()
  })

  it('preserves search params when the wildcard route falls back to /dev/resumes', async () => {
    window.history.replaceState({}, '', '/totally-unknown-route?q=STAR')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/dev/resumes')
      expect(window.location.search).toBe('?q=STAR')
    })

    expect(screen.getByText('Resumes Page')).toBeInTheDocument()
  })
})
