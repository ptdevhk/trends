import { describe, expect, it } from 'vitest'
import { getScoreClassName } from '@/lib/score-classes'

describe('getScoreClassName', () => {
  it('returns emerald for score >= 90', () => {
    expect(getScoreClassName(100)).toContain('emerald')
    expect(getScoreClassName(90)).toContain('emerald')
  })

  it('returns sky for score 70-89', () => {
    expect(getScoreClassName(89)).toContain('sky')
    expect(getScoreClassName(70)).toContain('sky')
  })

  it('returns amber for score 50-69', () => {
    expect(getScoreClassName(69)).toContain('amber')
    expect(getScoreClassName(50)).toContain('amber')
  })

  it('returns zinc for score < 50', () => {
    expect(getScoreClassName(49)).toContain('zinc')
    expect(getScoreClassName(0)).toContain('zinc')
  })
})
