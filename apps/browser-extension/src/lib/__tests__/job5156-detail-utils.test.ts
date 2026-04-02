import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  collectJob5156SectionItemsByHeading,
  isMeaningfulJob5156WorkHistoryEntry,
} from '../job5156-detail-utils'

describe('job5156-detail-utils', () => {
  it('prefers structured work-history containers over generic nested items', () => {
    const dom = new JSDOM(`
      <main>
        <section class="resume-view-layout">
          <h2 class="resume-view-layout__title">工作经历</h2>
          <div class="resume-work__info">
            <div class="resume-work__row-1">
              <span class="time-diff">2019-04~至今（6年11月）</span>
              <div class="flex flex-1">
                <span class="pointer">东莞宝力机械</span>
                <span>销售经理</span>
              </div>
            </div>
          </div>
          <div class="item">(2年11月)</div>
          <li>(11月)</li>
          <div class="resume-education__info">2020~2023广东南方职业学院商务英语本科</div>
        </section>
      </main>
    `)

    const workItems = collectJob5156SectionItemsByHeading(
      dom.window.document.body,
      /工作经历|工作经验|工作履历/u,
      ['.resume-work__info', '.work-item', '.work-block', '[class*="work-item"]', '[class*="work-block"]'],
      [':scope > li', ':scope > .item', ':scope > [class*="item"]'],
    )

    expect(workItems).toHaveLength(1)
    expect(
      workItems[0] && typeof workItems[0] === 'object' && 'className' in workItems[0]
        ? String(workItems[0].className)
        : '',
    ).toContain('resume-work__info')
  })

  it('rejects placeholder-only and education-like work-history candidates', () => {
    expect(isMeaningfulJob5156WorkHistoryEntry({ raw: '(2年11月)' })).toBe(false)
    expect(isMeaningfulJob5156WorkHistoryEntry({ raw: '(11月)' })).toBe(false)
    expect(
      isMeaningfulJob5156WorkHistoryEntry({
        raw: '2020~2023广东南方职业学院商务英语本科',
        startDate: '2020',
        endDate: '2023',
      }),
    ).toBe(false)
  })

  it('keeps structured work-history candidates with company, title, and date evidence', () => {
    expect(
      isMeaningfulJob5156WorkHistoryEntry({
        raw: '2019-04~至今(6年11月) 东莞宝力机械 销售经理',
        companyName: '东莞宝力机械',
        jobTitle: '销售经理',
        startDate: '2019-04',
        endDate: '至今',
      }),
    ).toBe(true)
  })
})
