import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ProfileCard, type SearchProfileSummary, type SearchProfileRunStatus } from '@/components/ProfileCard'

vi.mock('date-fns/formatDistanceToNow', () => ({
  formatDistanceToNow: () => '2 hours ago',
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') return options
      const translations: Record<string, string> = {
        'searchProfiles.card.resultCount': '{{count}} CVs',
        'searchProfiles.card.never': 'never',
      }
      const template = translations[key] ?? (typeof options?.defaultValue === 'string' ? options.defaultValue : key)
      return template.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => String(options?.[token] ?? ''))
    },
  }),
}))

const baseProfile: SearchProfileSummary = {
  id: 'p-1',
  name: 'Frontend Devs',
  updatedAt: '2026-05-13T00:00:00Z',
  status: 'active',
  location: 'Shanghai',
  keywords: ['React', 'TypeScript'],
}

const baseRunStatus: SearchProfileRunStatus = {
  profileId: 'p-1',
  taskId: 't-1',
  taskStatus: 'completed',
  startedAt: '2026-05-13T00:00:00Z',
  updatedAt: '2026-05-13T01:00:00Z',
  resultCount: 42,
}

function renderProfile(overrides: Partial<React.ComponentProps<typeof ProfileCard>> = {}) {
  const onRunNow = vi.fn()
  const onEdit = vi.fn()
  const onDelete = vi.fn()
  render(
    <ProfileCard
      profile={baseProfile}
      scheduleLabel="daily"
      running={false}
      onRunNow={onRunNow}
      onEdit={onEdit}
      onDelete={onDelete}
      {...overrides}
    />,
  )
  return { onRunNow, onEdit, onDelete }
}

describe('ProfileCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders profile name, location, and keywords', () => {
    renderProfile()
    expect(screen.getByText('Frontend Devs')).toBeInTheDocument()
    expect(screen.getByText(/Shanghai.*React, TypeScript/)).toBeInTheDocument()
  })

  it('shows active status badge', () => {
    renderProfile()
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('shows paused status badge', () => {
    renderProfile({ profile: { ...baseProfile, status: 'paused' } })
    expect(screen.getByText('paused')).toBeInTheDocument()
  })

  it('shows archived status badge', () => {
    renderProfile({ profile: { ...baseProfile, status: 'archived' } })
    expect(screen.getByText('archived')).toBeInTheDocument()
  })

  it('shows quick start badge when enabled', () => {
    renderProfile({ profile: { ...baseProfile, quickStart: { enabled: true } } })
    expect(screen.getByText('quick start')).toBeInTheDocument()
  })

  it('shows schedule label', () => {
    renderProfile()
    expect(screen.getByText(/daily \(enabled\)/)).toBeInTheDocument()
  })

  it('shows disabled schedule', () => {
    renderProfile({ scheduleLabel: 'disabled' })
    expect(screen.getByText(/disabled/)).toBeInTheDocument()
  })

  it('shows -- fallback when keywords are empty', () => {
    renderProfile({ profile: { ...baseProfile, keywords: [] } })
    expect(screen.getByText(/--/)).toBeInTheDocument()
  })

  it('calls onRunNow when Run Now is clicked', async () => {
    const { onRunNow } = renderProfile()
    await userEvent.setup().click(screen.getByRole('button', { name: /Run Now/ }))
    expect(onRunNow).toHaveBeenCalledWith('p-1')
  })

  it('calls onEdit when Edit is clicked', async () => {
    const { onEdit } = renderProfile()
    await userEvent.setup().click(screen.getByRole('button', { name: /Edit/ }))
    expect(onEdit).toHaveBeenCalledWith('p-1')
  })

  it('calls onDelete when Delete is clicked', async () => {
    const { onDelete } = renderProfile()
    await userEvent.setup().click(screen.getByRole('button', { name: /Delete/ }))
    expect(onDelete).toHaveBeenCalledWith('p-1')
  })

  it('disables Run Now when running', () => {
    renderProfile({ running: true })
    expect(screen.getByRole('button', { name: /Run Now/ })).toBeDisabled()
  })

  it('shows run status when runStatus is provided', () => {
    renderProfile({ runStatus: baseRunStatus })
    expect(screen.getByText(/completed/)).toBeInTheDocument()
  })

  it('shows run status error message', () => {
    renderProfile({ runStatus: { ...baseRunStatus, taskStatus: 'failed', error: 'timeout' } })
    expect(screen.getByText(/failed/)).toBeInTheDocument()
    expect(screen.getByText(/timeout/)).toBeInTheDocument()
  })

  it('uses submitted when resultCount is absent', () => {
    renderProfile({ runStatus: { profileId: 'p-1', taskId: 't-1', taskStatus: 'completed', startedAt: '2026-05-13T00:00:00Z', updatedAt: '2026-05-13T01:00:00Z', submitted: 15 } })
    expect(screen.getByText(/15 CVs/)).toBeInTheDocument()
  })
})
