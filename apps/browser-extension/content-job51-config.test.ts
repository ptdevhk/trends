import { describe, expect, it } from 'vitest'

import {
  resolveJob51AutoSyncDetailWaitMode,
  resolveJob51CollectionLimits,
  resolveJob51DetailFetchDelayMs,
} from './src/lib/job51-collection-config'

describe('job51 content config', () => {
  it('keeps 200+ standard runs capped and uses the conservative delay', () => {
    expect(resolveJob51CollectionLimits(250, 8, '?keyword=CNC')).toEqual({
      limit: 50,
      maxPages: 1,
    })
    expect(resolveJob51CollectionLimits(0, 0, '?keyword=CNC')).toEqual({
      limit: 50,
      maxPages: 1,
    })
    expect(resolveJob51DetailFetchDelayMs('?keyword=CNC')).toBe(5000)
    expect(resolveJob51AutoSyncDetailWaitMode('?keyword=CNC')).toBe('background')
  })

  it('unlocks 200+ unsafe runs and uses the faster unsafe delay', () => {
    expect(
      resolveJob51CollectionLimits(250, 8, '?keyword=CNC&tr_unsafe_limits=1'),
    ).toEqual({
      limit: 250,
      maxPages: 8,
    })
    expect(
      resolveJob51CollectionLimits(0, 0, '?keyword=CNC&tr_unsafe_limits=1'),
    ).toEqual({
      limit: 50,
      maxPages: 1,
    })
    expect(resolveJob51DetailFetchDelayMs('?keyword=CNC&tr_unsafe_limits=1')).toBe(1000)
  })

  it('lets 51job auto sync wait for the first page when explicitly requested', () => {
    expect(
      resolveJob51AutoSyncDetailWaitMode('?keyword=CNC&tr_job51_detail_wait=page1'),
    ).toBe('page1')
  })
})
