import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProfileCard, type SearchProfileSummary } from '@/components/ProfileCard'

vi.mock('date-fns/formatDistanceToNow', () => ({
  formatDistanceToNow: () => '2 hours ago',
}))

const baseProfile: SearchProfileSummary = {
  id: 'p-1',
  name: 'Frontend Devs',
  updatedAt: '2026-05-13T00:00:00Z',
  status: 'active',
  location: 'Shanghai',
  keywords: ['React', 'TypeScript'],
}

describe('ProfileCard', () => {
  it('renders profile name, location, and keywords', () => {
    render(
      <ProfileCard
        profile={baseProfile}
        scheduleLabel="daily"
        running={false}
        onRunNow={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText('Frontend Devs')).toBeInTheDocument()
    expect(screen.getByText(/Shanghai.*React, TypeScript/)).toBeInTheDocument()
  })

  it('shows active status badge', () => {
    render(
      <ProfileCard
        profile={baseProfile}
        scheduleLabel="daily"
        running={false}
        onRunNow={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('shows quick start badge when enabled', () => {
    render(
      <ProfileCard
        profile={{ ...baseProfile, quickStart: { enabled: true } }}
        scheduleLabel="daily"
        running={false}
        onRunNow={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText('quick start')).toBeInTheDocument()
  })

  it('shows schedule label', () => {
    render(
      <ProfileCard
        profile={baseProfile}
        scheduleLabel="daily"
        running={false}
        onRunNow={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText(/daily \(enabled\)/)).toBeInTheDocument()
  })

  it('shows disabled schedule', () => {
    render(
      <ProfileCard
        profile={baseProfile}
        scheduleLabel="disabled"
        running={false}
        onRunNow={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText(/disabled/)).toBeInTheDocument()
  })

  it('calls onRunNow when Run Now is clicked', async () => {
    const onRunNow = vi.fn()
    const user = userEvent.setup()
    render(
      <ProfileCard
        profile={baseProfile}
        scheduleLabel="daily"
        running={false}
        onRunNow={onRunNow}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Run Now/ }))
    expect(onRunNow).toHaveBeenCalledWith('p-1')
  })

  it('calls onEdit when Edit is clicked', async () => {
    const onEdit = vi.fn()
    const user = userEvent.setup()
    render(
      <ProfileCard
        profile={baseProfile}
        scheduleLabel="daily"
        running={false}
        onRunNow={vi.fn()}
        onEdit={onEdit}
        onDelete={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Edit/ }))
    expect(onEdit).toHaveBeenCalledWith('p-1')
  })

  it('calls onDelete when Delete is clicked', async () => {
    const onDelete = vi.fn()
    const user = userEvent.setup()
    render(
      <ProfileCard
        profile={baseProfile}
        scheduleLabel="daily"
        running={false}
        onRunNow={vi.fn()}
        onEdit={vi.fn()}
        onDelete={onDelete}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Delete/ }))
    expect(onDelete).toHaveBeenCalledWith('p-1')
  })

  it('disables Run Now when running', () => {
    render(
      <ProfileCard
        profile={baseProfile}
        scheduleLabel="daily"
        running={true}
        onRunNow={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /Run Now/ })).toBeDisabled()
  })

  it('shows run status when runStatus is provided', () => {
    render(
      <ProfileCard
        profile={baseProfile}
        scheduleLabel="daily"
        runStatus={{
          profileId: 'p-1',
          taskId: 't-1',
          taskStatus: 'completed',
          startedAt: '2026-05-13T00:00:00Z',
          updatedAt: '2026-05-13T01:00:00Z',
          resultCount: 42,
        }}
        running={false}
        onRunNow={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText(/completed/)).toBeInTheDocument()
  })
})
