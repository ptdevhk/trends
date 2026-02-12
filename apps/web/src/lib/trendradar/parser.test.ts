import { describe, expect, it } from 'vitest'
import { expandKeyword, calculateResumeScore, parseFrequencyConfig } from './parser'

// FIX: Ensure => is on the same line as the keyword
const TEST_CONFIG = parseFrequencyConfig(`
[WORD_GROUPS]
华为
HarmonyOS
鸿蒙 => 华为

苹果
iPhone => 苹果
`);

describe('parser expansion and scoring', () => {
    it('correctly parses TEST_CONFIG', () => {
        expect(TEST_CONFIG.groups.length).toBe(2)
        // Group 1: 华为, HarmonyOS, 鸿蒙
        expect(TEST_CONFIG.groups[0].normal.length).toBe(3)
        expect(TEST_CONFIG.groups[1].normal.length).toBe(2)
    })

    it('expands keywords correctly', () => {
        const result = expandKeyword('华为', TEST_CONFIG)
        const terms = result.split(' ')
        expect(terms).toContain('华为')
        expect(terms).toContain('HarmonyOS')
        expect(terms).toContain('鸿蒙')
        expect(terms.length).toBe(3)
    })

    it('scores correctly with specific matches', () => {
        const { score: score1 } = calculateResumeScore('华为', TEST_CONFIG)
        const { score: score2 } = calculateResumeScore('华为 HarmonyOS', TEST_CONFIG)
        const { score: score3 } = calculateResumeScore('华为 HarmonyOS 鸿蒙', TEST_CONFIG)

        expect(score1).toBe(1)
        expect(score2).toBe(2)
        expect(score3).toBe(3)
    })

    it('scores 0 for empty text', () => {
        const { score, matches } = calculateResumeScore('', TEST_CONFIG)
        expect(score).toBe(0)
        expect(matches).toEqual([])
    })

    it('respects required keywords', () => {
        const reqConfig = parseFrequencyConfig(`
[WORD_GROUPS]
+华为
HarmonyOS
`);
        const { score: score1 } = calculateResumeScore('HarmonyOS', reqConfig)
        const { score: score2 } = calculateResumeScore('华为', reqConfig)

        // Required keywords have weight 5
        expect(score2).toBe(5)
        // Normal keywords have weight 1
        expect(score1).toBe(1)
    })
})
