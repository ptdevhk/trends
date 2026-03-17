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
  })

  it('preserves search params when redirecting /resumes to /dev/resumes', async () => {
    window.history.replaceState({}, '', '/resumes?location=Kuala+Lumpur+MY&keyword=Sales+Engineer+Manager')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/dev/resumes')
      expect(window.location.search).toBe('?location=Kuala+Lumpur+MY&keyword=Sales+Engineer+Manager')
    })

    expect(screen.getByText('Resumes Page')).toBeInTheDocument()
  })

  it('preserves search params when redirecting a workspace index route to resumes', async () => {
    window.history.replaceState({}, '', '/hr?keyword=CNC')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/hr/resumes')
      expect(window.location.search).toBe('?keyword=CNC')
    })

    expect(screen.getByText('Resumes Page')).toBeInTheDocument()
  })

  it('preserves search params when AdminGate redirects a non-admin workspace away from system routes', async () => {
    window.history.replaceState({}, '', '/hr/system?keyword=CNC&location=Kuala+Lumpur+MY')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/hr/resumes')
      expect(window.location.search).toBe('?keyword=CNC&location=Kuala+Lumpur+MY')
    })

    expect(screen.getByText('Resumes Page')).toBeInTheDocument()
  })

  it('preserves search params when an invalid workspace slug falls back to /dev/resumes', async () => {
    window.history.replaceState({}, '', '/unknown/resumes?keyword=STAR&location=Dongguan')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/dev/resumes')
      expect(window.location.search).toBe('?keyword=STAR&location=Dongguan')
    })

    expect(screen.getByText('Resumes Page')).toBeInTheDocument()
  })

  it('preserves search params when redirecting /profiles to /dev/system/profiles', async () => {
    window.history.replaceState({}, '', '/profiles?keyword=Sales+Engineer')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/dev/system/profiles')
      expect(window.location.search).toBe('?keyword=Sales+Engineer')
    })
  })

  it('preserves search params when redirecting legacy /system routes into /dev/system', async () => {
    window.history.replaceState({}, '', '/system/search-analytics?keyword=CNC')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/dev/system/search-analytics')
      expect(window.location.search).toBe('?keyword=CNC')
    })
  })

  it('preserves search params when the wildcard route falls back to /dev/resumes', async () => {
    window.history.replaceState({}, '', '/totally-unknown-route?keyword=STAR')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/dev/resumes')
      expect(window.location.search).toBe('?keyword=STAR')
    })

    expect(screen.getByText('Resumes Page')).toBeInTheDocument()
  })
})
