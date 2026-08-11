import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

let fetchSpy: ReturnType<typeof vi.spyOn>

const mockT = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'dev' }),
}))

vi.mock('lucide-react', () => ({
  Download: () => <svg data-testid="download-icon" />,
  CheckCircle2: () => <svg data-testid="check-icon" />,
  ArrowRight: () => <svg data-testid="arrow-icon" />,
  Puzzle: () => <svg data-testid="puzzle-icon" />,
  Search: () => <svg data-testid="search-icon" />,
  Play: () => <svg data-testid="play-icon" />,
}))

import { SystemSetupPage } from './SystemSetupPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <SystemSetupPage />
    </MemoryRouter>
  )
}

describe('SystemSetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ version: '1.2.0' }), { status: 200 })
    )
    renderPage()
    const link = await screen.findByRole('link', { name: /download.*1\.2\.0/i })
    expect(link).toHaveAttribute('href', '/extension/trends-resume-collector-latest.zip')
  })

  it('shows install hint when extension not available', () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 404 }))
    renderPage()
    expect(screen.getByText(/Download link will appear once the extension is built/)).toBeInTheDocument()
  })

  it('links to keywords page for step 2', () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 404 }))
    renderPage()
    const link = screen.getByRole('link', { name: 'Go to Keywords' })
    expect(link).toHaveAttribute('href', '/dev/system/settings/keywords')
  })

  it('links to operations page for step 3', () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 404 }))
    renderPage()
    const link = screen.getByRole('link', { name: 'Go to Operations' })
    expect(link).toHaveAttribute('href', '/dev/system/settings/operations')
  })

  it('allows marking step 1 as done', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 404 }))
    const user = userEvent.setup()
    renderPage()
    const doneButtons = screen.getAllByRole('button', { name: 'Mark as done' })
    await user.click(doneButtons[0])
    expect(localStorage.getItem('setup-step-1')).toBe('done')
  })

  it('restores completion state from localStorage', () => {
    localStorage.setItem('setup-step-1', 'done')
    fetchSpy.mockResolvedValue(new Response('{}', { status: 404 }))
    renderPage()
    expect(screen.getByTestId('check-icon')).toBeInTheDocument()
  })
})
