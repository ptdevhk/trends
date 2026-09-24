import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NewsSourcesDialog } from './NewsSourcesDialog'

function state() {
  return {
    seed: {
      version: 'v1',
      groups: [
        { id: 'cnc-core', label: '工业母机', feeds: ['a', 'b'] },
        { id: 'brands', label: '品牌', feeds: ['c', 'd'] },
      ],
      catalogIds: ['a', 'b', 'c', 'd'],
      defaultGroupIds: ['cnc-core', 'brands'],
    },
    workspace: { version: 1 as const, excludedGroups: [], excludedFeeds: [], enabledFeeds: [] },
    effective: ['a', 'b', 'c', 'd'],
  }
}

function renderOpen(props = {}) {
  const onSave = vi.fn()
  const utils = render(
    <NewsSourcesDialog
      open
      onOpenChange={vi.fn()}
      initial={state() as never}
      saving={false}
      onSave={onSave}
      {...props}
    />,
  )
  return { onSave, ...utils }
}

describe('NewsSourcesDialog', () => {
  it('renders master + per-feed toggles default-on', () => {
    renderOpen()
    expect(screen.getByTestId('research-news-sources-master')).toBeChecked()
    expect(screen.getByTestId('research-news-sources-feed-toggle-a')).toBeChecked()
    expect(screen.getByTestId('research-news-sources-feed-toggle-d')).toBeChecked()
    expect(screen.getByTestId('research-news-sources-active-count')).toHaveTextContent('4')
  })

  it('master off disables all feeds and save sends masterEnabled false', () => {
    const { onSave } = renderOpen()
    fireEvent.click(screen.getByTestId('research-news-sources-master'))
    expect(screen.getByTestId('research-news-sources-feed-toggle-a')).not.toBeChecked()
    fireEvent.click(screen.getByTestId('research-news-sources-save'))
    expect(onSave).toHaveBeenCalledWith({
      masterEnabled: false,
      excludedGroups: [],
      excludedFeeds: [],
      enabledFeeds: [],
    })
  })

  it('turning a feed off inside an on group adds excludedFeeds', () => {
    const { onSave } = renderOpen()
    fireEvent.click(screen.getByTestId('research-news-sources-feed-toggle-b'))
    fireEvent.click(screen.getByTestId('research-news-sources-save'))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ excludedFeeds: ['b'], enabledFeeds: [] }),
    )
  })

  it('turning a feed on inside an off group uses the enabledFeeds escape hatch', () => {
    const { onSave } = renderOpen()
    // turn group 'brands' off
    fireEvent.click(screen.getByTestId('research-news-sources-group-toggle-brands'))
    // re-enable feed c inside the now-off group
    fireEvent.click(screen.getByTestId('research-news-sources-feed-toggle-c'))
    fireEvent.click(screen.getByTestId('research-news-sources-save'))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ excludedGroups: ['brands'], enabledFeeds: ['c'] }),
    )
  })
})
