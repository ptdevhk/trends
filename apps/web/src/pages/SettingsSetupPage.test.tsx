import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workspaceState = vi.hoisted(() => ({ slug: 'dev' }))

let fetchSpy: ReturnType<typeof vi.spyOn>

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key }),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: workspaceState.slug }),
}))

vi.mock('lucide-react', () => ({
  Download: () => <svg data-testid="download-icon" />,
  CheckCircle2: () => <svg data-testid="check-icon" />,
  Puzzle: () => <svg data-testid="puzzle-icon" />,
  Search: () => <svg data-testid="search-icon" />,
  Play: () => <svg data-testid="play-icon" />,
}))

import { SettingsSetupPage } from './SettingsSetupPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsSetupPage />
    </MemoryRouter>,
  )
}

describe('SettingsSetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workspaceState.slug = 'dev'
    fetchSpy = vi.spyOn(globalThis, 'fetch')
    localStorage.clear()
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('renders all 3 setup step titles', () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 404 }))
    renderPage()
    expect(screen.getByText('Install Extension')).toBeInTheDocument()
    expect(screen.getByText('Configure Search')).toBeInTheDocument()
    expect(screen.getByText('First Crawl')).toBeInTheDocument()
  })

  it('shows download link when extension version is available', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ version: '1.2.0' }), { status: 200 }))
    renderPage()
    const link = await screen.findByRole('link', { name: /download.*1\.2\.0/i })
    expect(link).toHaveAttribute('href', '/extension/trends-resume-collector-latest.zip')
  })

  it('shows install hint when extension metadata is unavailable', () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 404 }))
    renderPage()
    expect(screen.getByText(/Download link will appear once the extension is built/)).toBeInTheDocument()
  })

  it('links step 2 to workspace search setup and step 3 to the resumes desk', () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 404 }))
    renderPage()

    expect(screen.getByRole('link', { name: 'Go to Search Setup' })).toHaveAttribute('href', '/dev/settings/keywords')
    expect(screen.getByRole('link', { name: 'Go to Resumes' })).toHaveAttribute('href', '/dev/resumes')
  })

  it('stores completion state per workspace slug', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 404 }))
    const user = userEvent.setup()
    renderPage()

    const doneButtons = screen.getAllByRole('button', { name: 'Mark as done' })
    await user.click(doneButtons[0])

    expect(localStorage.getItem('setup-step:dev:1')).toBe('done')
    expect(localStorage.getItem('setup-step-1')).toBeNull()
  })

  it('does not leak completion state across workspaces', () => {
    localStorage.setItem('setup-step:dev:1', 'done')
    workspaceState.slug = 'hr'
    fetchSpy.mockResolvedValue(new Response('{}', { status: 404 }))

    renderPage()

    expect(screen.queryByTestId('check-icon')).not.toBeInTheDocument()
  })
})
