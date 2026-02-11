import { describe, expect, it } from 'vitest'
import { buildJobDescriptionOptions } from './job-description-options'

describe('buildJobDescriptionOptions', () => {
  it('keeps placeholder first and includes custom+system options from correct sources', () => {
    const options = buildJobDescriptionOptions({
      placeholderLabel: 'Select job description',
      convexJobDescriptions: [
        { _id: 'sys-1', title: '车床销售工程师', type: 'system', enabled: true },
        { _id: 'cus-1', title: '车床销售工程师', type: 'custom', enabled: true },
        { _id: 'cus-2', title: '夹具工程师', type: 'custom', enabled: false },
      ],
      systemJobDescriptions: [
        { name: 'lathe-sales', title: '车床销售工程师' },
        { name: 'fixture-engineer', title: '夹具工程师' },
      ],
    })

    expect(options).toEqual([
      { value: '', label: 'Select job description' },
      { value: 'cus-1', label: '✨ 车床销售工程师 (Custom)' },
      { value: 'lathe-sales', label: '车床销售工程师 (System)' },
      { value: 'fixture-engineer', label: '夹具工程师 (System)' },
    ])
  })

  it('falls back to system name when title is missing', () => {
    const options = buildJobDescriptionOptions({
      placeholderLabel: 'Pick one',
      convexJobDescriptions: [],
      systemJobDescriptions: [{ name: 'cpp-software-engineer' }],
    })

    expect(options).toEqual([
      { value: '', label: 'Pick one' },
      { value: 'cpp-software-engineer', label: 'cpp-software-engineer (System)' },
    ])
  })
})
