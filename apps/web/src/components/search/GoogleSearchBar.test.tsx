import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleSearchBar } from '@/components/search/GoogleSearchBar'
import type { ResumeSearchRecentItem } from '@/components/search/search-types'

vi.mock('@/components/search/JdPastePopover', () => ({
  JdPastePopover: ({ onClose }: { onClose: () => void }) => (
    <div>
      <div>JD Popover</div>
      <button type="button" onClick={onClose}>Close JD Popover</button>
    </div>
  ),
}))

function buildRecentSearch(overrides: Partial<ResumeSearchRecentItem> = {}): ResumeSearchRecentItem {
  return {
    id: 'history-1' as ResumeSearchRecentItem['id'],
    sessionKey: 'session-1',
    title: 'Machine tools',
    location: 'Kuala Lumpur',
    keywords: ['Machine Tools'],
    selectedTags: [],
    selectedCompanies: [],
    filters: {},
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('GoogleSearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('closes the JD popover on escape before clearing the query', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()

    render(
      <GoogleSearchBar
        value="machine tools"
        recentSearches={[buildRecentSearch()]}
        onApplyRecentSearch={vi.fn()}
        onApplyExtractedKeywords={vi.fn()}
        onChange={vi.fn()}
        onClear={onClear}
        onSubmit={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Paste job description' }))
    expect(screen.getByText('JD Popover')).toBeInTheDocument()

    const input = screen.getByPlaceholderText('Search resumes by keywords, brands, roles, or locations')
    await user.click(input)
    await user.keyboard('{Escape}')

    expect(screen.queryByText('JD Popover')).not.toBeInTheDocument()
    expect(onClear).not.toHaveBeenCalled()
  })
})
