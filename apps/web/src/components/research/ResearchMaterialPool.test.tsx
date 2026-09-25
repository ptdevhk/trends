import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ResearchMaterialPool } from './ResearchMaterialPool'

const mockT = (_key: string, options?: { defaultValue?: string } & Record<string, unknown>) => {
  let text = options?.defaultValue ?? _key
  if (options) {
    for (const [k, v] of Object.entries(options)) {
      if (k === 'defaultValue') continue
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
    }
  }
  return text
}

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }))

describe('ResearchMaterialPool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('merges watch rss rows ahead of hotlist and allows tagging', async () => {
    const onPromote = vi.fn()
    render(
      <MemoryRouter>
        <ResearchMaterialPool
          teamSlug="hr"
          loading={false}
          error={null}
          matchedCount={1}
          onPromoteToReport={onPromote}
          items={[
            {
              title: '热榜机床订单',
              platform: 'weibo',
              capturedAt: Date.now() - 60_000,
            },
          ]}
          watchItems={[
            {
              title: '铩硕精密扩产',
              platform: 'rss:watch-shuashuo',
              capturedAt: Date.now() - 120_000,
            },
          ]}
        />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('research-section-pulse')).toBeInTheDocument()
    expect(screen.getByTestId('research-section-hotlist-title').textContent).toMatch(/综合热榜|素材池|Hotlist/)
    const items = screen.getAllByTestId('research-pulse-item')
    expect(items[0]).toHaveAttribute('data-source', 'watch')
    expect(items[0]).toHaveTextContent('铩硕精密扩产')
    expect(screen.getByTestId('research-pool-status').textContent).toMatch(/客户扩散|customer spread/)

    fireEvent.click(screen.getAllByTestId('research-pool-tag')[0])
    expect(screen.getAllByTestId('research-pool-tag')[0]).toHaveAttribute('data-tag', '下游')

    fireEvent.click(screen.getByTestId('research-pool-promote'))
    expect(onPromote).toHaveBeenCalled()
  })

  it('shows empty state when no items', async () => {
    render(
      <MemoryRouter>
        <ResearchMaterialPool
          teamSlug="hr"
          loading={false}
          error={null}
          matchedCount={0}
          items={[]}
          watchItems={[]}
        />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('research-pulse-empty')).toBeInTheDocument()
    })
  })
})
