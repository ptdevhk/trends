import { describe, expect, it } from 'vitest'
import {
  parseResearchNewsSourcesSeed,
  parseNewsSourcesWorkspace,
  mergeNewsSources,
  emptyNewsSourcesWorkspace,
  type NewsSourcesSeed,
} from './research-news-sources'

function seed(): NewsSourcesSeed {
  // mirror config/research_news_sources.yaml shape (subset)
  return parseResearchNewsSourcesSeed({
    version: 'v1',
    groups: [
      { id: 'cnc-core', label: '工业母机', feeds: ['a', 'b', 'c'] },
      { id: 'components', label: '组件', feeds: ['d', 'e'] },
      { id: 'market', label: '行情', feeds: ['f'] },
    ],
    defaults: { groups: ['cnc-core', 'components', 'market'] },
  })
}

describe('parseResearchNewsSourcesSeed', () => {
  it('builds catalog + default groups in order, dedupes ids', () => {
    const s = seed()
    expect(s.catalogIds).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(s.defaultGroupIds).toEqual(['cnc-core', 'components', 'market'])
  })
  it('rejects duplicate feed id across groups', () => {
    expect(() =>
      parseResearchNewsSourcesSeed({
        version: 'v1',
        groups: [
          { id: 'g1', label: 'x', feeds: ['a', 'b'] },
          { id: 'g2', label: 'y', feeds: ['b', 'c'] },
        ],
        defaults: { groups: ['g1', 'g2'] },
      }),
    ).toThrow(/Duplicate/i)
  })
  it('rejects unknown default group', () => {
    expect(() =>
      parseResearchNewsSourcesSeed({
        version: 'v1',
        groups: [{ id: 'g1', label: 'x', feeds: ['a'] }],
        defaults: { groups: ['nope'] },
      }),
    ).toThrow(/unknown group/i)
  })
})

describe('parseNewsSourcesWorkspace', () => {
  it('missing raw => default master-on, no excludes', () => {
    const w = parseNewsSourcesWorkspace(undefined)
    expect(w.masterEnabled).toBeUndefined()
    expect(w.excludedGroups).toEqual([])
    expect(w.excludedFeeds).toEqual([])
    expect(w.enabledFeeds).toEqual([])
    expect(emptyNewsSourcesWorkspace()).toEqual(w)
  })
  it('parses explicit boolean + lists', () => {
    const w = parseNewsSourcesWorkspace({
      masterEnabled: false,
      excludedGroups: ['market'],
      excludedFeeds: ['b'],
      enabledFeeds: ['f'],
    })
    expect(w.masterEnabled).toBe(false)
    expect(w.excludedGroups).toEqual(['market'])
  })
})

describe('mergeNewsSources', () => {
  it('empty workspace => every catalog feed (default-ON)', () => {
    expect(mergeNewsSources(seed(), emptyNewsSourcesWorkspace())).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })
  it('master off => []', () => {
    expect(mergeNewsSources(seed(), { ...emptyNewsSourcesWorkspace(), masterEnabled: false })).toEqual([])
  })
  it('excluded group drops that group; other groups intact', () => {
    expect(
      mergeNewsSources(seed(), { ...emptyNewsSourcesWorkspace(), excludedGroups: ['components'] }),
    ).toEqual(['a', 'b', 'c', 'f'])
  })
  it('excluded feed drops just that feed (keeps group)', () => {
    expect(
      mergeNewsSources(seed(), { ...emptyNewsSourcesWorkspace(), excludedFeeds: ['b'] }),
    ).toEqual(['a', 'c', 'd', 'e', 'f'])
  })
  it('enabledFeeds escape hatch re-adds a feed inside an excluded group', () => {
    expect(
      mergeNewsSources(seed(), {
        ...emptyNewsSourcesWorkspace(),
        excludedGroups: ['market'],
        enabledFeeds: ['f'],
      }),
    ).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })
  it('excludedFeeds beats enabledFeeds', () => {
    expect(
      mergeNewsSources(seed(), {
        ...emptyNewsSourcesWorkspace(),
        excludedGroups: ['market'],
        enabledFeeds: ['f'],
        excludedFeeds: ['f'],
      }),
    ).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
  it('non-default group is on unless excluded; enabledFeeds can re-add even a never-default group', () => {
    // all are default here; add a never-default group
    const s = parseResearchNewsSourcesSeed({
      version: 'v1',
      groups: [
        { id: 'on', label: 'x', feeds: ['a'] },
        { id: 'optin', label: 'y', feeds: ['z'] },
      ],
      defaults: { groups: ['on'] }, // optin NOT default
    })
    // default-only => 'a' only
    expect(mergeNewsSources(s, emptyNewsSourcesWorkspace())).toEqual(['a'])
    // enabledFeeds pulls z even though its group is not a default
    expect(mergeNewsSources(s, { ...emptyNewsSourcesWorkspace(), enabledFeeds: ['z'] })).toEqual(['a', 'z'])
  })
  it('bad exclude-all falls back to full catalog (never soft-wipe)', () => {
    const s = seed()
    const allFeeds = [...s.catalogIds]
    expect(mergeNewsSources(s, { ...emptyNewsSourcesWorkspace(), excludedGroups: ['cnc-core', 'components', 'market'] }))
      .toEqual(allFeeds)
  })
})
