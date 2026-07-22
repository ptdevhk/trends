import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  ResearchHotlistFeed,
  titleMatchesHighlight,
} from './ResearchHotlistFeed'

describe('ResearchHotlistFeed', () => {
  it('titleMatchesHighlight is case-insensitive and visual-only helper', () => {
    expect(titleMatchesHighlight('FANUC expands', ['fanuc'])).toBe(true)
    expect(titleMatchesHighlight('发那科扩产', ['发那科'])).toBe(true)
    expect(titleMatchesHighlight('娱乐热搜', ['发那科'])).toBe(false)
  })

  it('renders platform chips and marks alias highlight', () => {
    render(
      <MemoryRouter>
        <ResearchHotlistFeed
          teamSlug="hr"
          highlightTerms={['发那科']}
          items={[
            {
              title: '发那科招聘',
              platform: 'weibo',
              capturedAt: Date.now(),
              url: 'https://example.com/a',
            },
            {
              title: '娱乐热搜',
              platform: 'zhihu',
              capturedAt: Date.now() - 60_000,
            },
          ]}
        />
      </MemoryRouter>,
    )

    const items = screen.getAllByTestId('research-hotlist-item')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveAttribute('data-highlighted', 'true')
    expect(items[1]).toHaveAttribute('data-highlighted', 'false')
    expect(screen.getAllByTestId('research-hotlist-platform')[0]).toHaveTextContent('weibo')
  })

  it('shows empty state', () => {
    render(
      <MemoryRouter>
        <ResearchHotlistFeed teamSlug="hr" items={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('research-hotlist-empty')).toBeInTheDocument()
  })
})
