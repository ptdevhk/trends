import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockUnblockCandidate = vi.hoisted(() => vi.fn())
const mockUpdateBlockReason = vi.hoisted(() => vi.fn())

// Stable hook return value: BlacklistPage has a useEffect with [items] in its
// dependency list that calls setSelectedIdentityKeys with a freshly filtered
// array. The real useCandidateBlocks caches `items` via useState so its
// reference is stable across renders. A naive mock that returns a fresh object
// on every call triggers an infinite re-render loop and the test process
// hangs/crashes silently. Hoist the value so it's referentially stable.
const HOOK_VALUE = vi.hoisted(() => ({
  items: [
    { _id: '1', identityKey: 'user-1', workspaceSlug: 'dev', reason: 'Spam', blockedAt: 3000 },
    { _id: '2', identityKey: 'user-2', workspaceSlug: 'dev', blockedAt: 2000 },
    { _id: '3', identityKey: 'user-3', workspaceSlug: 'dev', reason: 'Duplicate', blockedAt: 1000 },
  ],
  loading: false,
  error: null as string | null,
  unblockCandidate: undefined as ReturnType<typeof vi.fn> | undefined,
  updateBlockReason: undefined as ReturnType<typeof vi.fn> | undefined,
}))
HOOK_VALUE.unblockCandidate = mockUnblockCandidate
HOOK_VALUE.updateBlockReason = mockUpdateBlockReason

vi.mock('@/hooks/useCandidateBlocks', () => ({
  useCandidateBlocks: () => HOOK_VALUE,
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ title }: { title?: string }) => <div>{title || 'Blacklist'}</div>,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
    <span className={`badge-${variant}`}>{children}</span>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, variant, size, ...rest }: {
    children?: React.ReactNode
    onClick?: React.MouseEventHandler<HTMLButtonElement>
    disabled?: boolean
    variant?: string
    size?: string
  } & Record<string, unknown>) => (
    <button
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
      data-size={size}
      {...rest}
    >
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div className="card">{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div className="card-content">{children}</div>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p className="card-desc">{children}</p>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div className="card-header">{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3 className="card-title">{children}</h3>,
}))

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange }: {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <input type="checkbox" checked={checked} onChange={(e) => onCheckedChange?.(e.target.checked)} />
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}))

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
  TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
}))

import { BlacklistPage } from './BlacklistPage'

describe('BlacklistPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUnblockCandidate.mockResolvedValue(true)
    mockUpdateBlockReason.mockResolvedValue(true)
  })

  it('renders the page header', () => {
    render(<BlacklistPage />)
    expect(screen.getAllByText(/Blacklist/i).length).toBeGreaterThan(0)
  })

  it('renders all blocked items in the table', () => {
    render(<BlacklistPage />)
    expect(screen.getByText('user-1')).toBeInTheDocument()
    expect(screen.getByText('user-2')).toBeInTheDocument()
    expect(screen.getByText('user-3')).toBeInTheDocument()
  })

  it('shows reason for items that have one', () => {
    render(<BlacklistPage />)
    expect(screen.getByText('Spam')).toBeInTheDocument()
    expect(screen.getByText('Duplicate')).toBeInTheDocument()
  })

  it('filters items by search keyword', async () => {
    const user = userEvent.setup()
    render(<BlacklistPage />)
    expect(screen.getByText('user-1')).toBeInTheDocument()

    const searchInput = screen.getByPlaceholderText(/search/i)
    await user.type(searchInput, 'user-2')

    expect(screen.getByText('user-2')).toBeInTheDocument()
    expect(screen.queryByText('user-1')).not.toBeInTheDocument()
    expect(screen.queryByText('user-3')).not.toBeInTheDocument()
  })

  it('unblocks a single item via row action', async () => {
    const user = userEvent.setup()
    render(<BlacklistPage />)

    const rowUnblockButtons = screen.getAllByTestId('blacklist-row-unblock')
    expect(rowUnblockButtons.length).toBe(3)
    // Rows are sorted by blockedAt desc → first row is user-1 (blockedAt 3000)
    await user.click(rowUnblockButtons[0])

    expect(mockUnblockCandidate).toHaveBeenCalledWith('user-1')
  })

  it('edits block reason inline by clicking the reason cell and committing on blur', async () => {
    const user = userEvent.setup()
    render(<BlacklistPage />)

    // Reason cells are buttons (not labelled "Edit" — the reason text itself is the trigger).
    // First row is user-1 (Spam, blockedAt 3000).
    const reasonDisplays = screen.getAllByTestId('blacklist-reason-display')
    expect(reasonDisplays.length).toBe(3)
    await user.click(reasonDisplays[0])

    const reasonInput = screen.getByTestId('blacklist-reason-input')
    await user.clear(reasonInput)
    await user.type(reasonInput, 'Updated reason')
    // commitReason fires on blur, not via a Save button
    await user.tab()

    expect(mockUpdateBlockReason).toHaveBeenCalledWith('user-1', 'Updated reason')
  })
})
