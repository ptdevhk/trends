import { describe, expect, it } from 'vitest'
import {
  getWorkspaceSearchProfileTemplates,
  SEARCH_PROFILE_TEMPLATES,
} from './search-profile-templates'

describe('getWorkspaceSearchProfileTemplates global defaults', () => {
  it('returns exact templates for hr and dev', () => {
    const hr = getWorkspaceSearchProfileTemplates('hr')
    const dev = getWorkspaceSearchProfileTemplates('dev')
    expect(hr.length).toBeGreaterThan(0)
    expect(dev.length).toBeGreaterThan(0)
    expect(hr.every((t) => t.workspaceSlug === 'hr')).toBe(true)
    expect(dev.every((t) => t.workspaceSlug === 'dev')).toBe(true)
  })

  it('inherits global (hr) defaults for personal workspaces', () => {
    const personal = getWorkspaceSearchProfileTemplates('demotest')
    const hr = getWorkspaceSearchProfileTemplates('hr')
    expect(personal.length).toBe(hr.length)
    expect(personal.map((t) => t.profile.id).sort()).toEqual(
      hr.map((t) => t.profile.id).sort(),
    )
    // Fan-out registry still only lists system seats in raw templates
    expect(SEARCH_PROFILE_TEMPLATES.some((t) => t.workspaceSlug === 'demotest')).toBe(false)
  })

  it('keeps seeded quick-start collection defaults at top50', () => {
    const dev = getWorkspaceSearchProfileTemplates('dev')
    const quickStarts = dev.filter((template) => template.profile.quickStart?.enabled)

    expect(quickStarts.length).toBeGreaterThan(0)

    for (const template of quickStarts) {
      expect(template.profile.schedule?.maxCandidates).toBe(50)

      const enabledSources = (template.profile.sources ?? []).filter((source) => source.enabled)
      expect(enabledSources.length).toBeGreaterThan(0)

      for (const source of enabledSources) {
        expect(source.collectLimit).toBe(50)
      }
    }
  })
})


describe('MY/TH CNC Service Engineer talent-search profiles', () => {
  const ROLE_STACK = [
    'Services Engineer',
    'Service Technician',
    'Service Manager',
    'Service Coordinator',
    'Service Supervisor',
  ]

  it('seeds two location-split Seek talent-search profiles without sales titles', () => {
    const hr = getWorkspaceSearchProfileTemplates('hr')
    const my = hr.find((t) => t.profile.id === 'seek-malaysia-talent-search-service-engineer')
    const th = hr.find((t) => t.profile.id === 'seek-thailand-talent-search-service-engineer')

    expect(my).toBeDefined()
    expect(th).toBeDefined()
    expect(my?.profile.location).toBe('Malaysia')
    expect(th?.profile.location).toBe('Thailand')
    expect(my?.profile.jobDescription).toBe('seek-malaysia-service-engineer')
    expect(th?.profile.jobDescription).toBe('seek-thailand-service-engineer')
    expect(my?.profile.filters?.roleFilterType).toBe('engineer')
    expect(th?.profile.filters?.roleFilterType).toBe('engineer')
    expect(my?.profile.keywords).not.toContain('Sales')
    expect(th?.profile.keywords).not.toContain('Sales')

    const myUrl = my?.profile.sources?.[0]?.jobUrl ?? ''
    const thUrl = th?.profile.sources?.[0]?.jobUrl ?? ''
    expect(my?.profile.sources?.[0]?.mode).toBe('talentsearch')
    expect(th?.profile.sources?.[0]?.mode).toBe('talentsearch')
    expect(myUrl.startsWith('https://hk.employer.seek.com/talentsearch?')).toBe(true)
    expect(thUrl.startsWith('https://hk.employer.seek.com/talentsearch?')).toBe(true)
    expect(myUrl).toContain('market=MY')
    expect(thUrl).toContain('market=TH')
    expect(myUrl).not.toContain('th.employer.seek.com')
    expect(thUrl).not.toContain('th.employer.seek.com')
    expect(myUrl).toContain('searchQuery=CNC')
    expect(myUrl).toContain('keywords=CNC')
    expect(myUrl).toContain('matchAll=false')

    const decodedMy = decodeURIComponent(myUrl).replace(/\+/g, ' ')
    const decodedTh = decodeURIComponent(thUrl).replace(/\+/g, ' ')
    for (const title of ROLE_STACK) {
      expect(decodedMy).toContain(title)
      expect(decodedTh).toContain(title)
    }
    expect(decodedMy).not.toContain('Sales Engineer')
    expect(decodedTh).not.toContain('Sales Engineer')
  })
})

describe('51job CN CMM and 3D scanning sales profiles', () => {
  const IDS = ['51job-cn-cmm-sales', '51job-cn-3d-scanning-sales'] as const

  it('seeds both 51job sales profiles for hr and dev without Seek URLs or CNC copy', () => {
    const hr = getWorkspaceSearchProfileTemplates('hr')
    const dev = getWorkspaceSearchProfileTemplates('dev')
    const cmm = hr.find((t) => t.profile.id === '51job-cn-cmm-sales')
    const scanning = hr.find((t) => t.profile.id === '51job-cn-3d-scanning-sales')

    expect(cmm).toBeDefined()
    expect(scanning).toBeDefined()
    expect(dev.some((t) => t.profile.id === '51job-cn-cmm-sales')).toBe(true)
    expect(dev.some((t) => t.profile.id === '51job-cn-3d-scanning-sales')).toBe(true)
    expect(SEARCH_PROFILE_TEMPLATES.some((t) => t.profile.id === '51job-cn-cmm-sales')).toBe(true)
    expect(SEARCH_PROFILE_TEMPLATES.some((t) => t.profile.id === '51job-cn-3d-scanning-sales')).toBe(true)

    for (const template of [cmm, scanning]) {
      expect(template?.profile.location).toBe('China')
      expect(template?.profile.filters?.roleFilterType).toBe('sales')
      expect(template?.profile.keywords).toContain('销售')
      expect(template?.profile.keywords).not.toContain('CNC')
      expect(template?.profile.quickStart?.label).not.toContain('CNC')
      expect(template?.profile.quickStart?.description).not.toContain('CNC')
      expect(template?.profile.schedule?.maxCandidates).toBe(50)

      const enabled51job = template?.profile.sources?.find((source) => source.type === '51job' && source.enabled)
      expect(enabled51job?.collectLimit).toBe(50)
      expect(enabled51job?.jobUrl).toBeUndefined()

      const jobUrls = (template?.profile.sources ?? [])
        .map((source) => source.jobUrl ?? '')
        .join(' ')
      expect(jobUrls).not.toContain('seek.com')
    }

    expect(cmm?.profile.keywords).toContain('三坐标')
    expect(scanning?.profile.keywords).toContain('3D扫描仪')
    expect(cmm?.profile.quickStart?.rank).toBe(7)
    expect(scanning?.profile.quickStart?.rank).toBe(8)
    expect(cmm?.profile.quickStart?.label).toBe('China · 51job · CMM 销售')
    expect(scanning?.profile.quickStart?.label).toBe('China · 51job · 3D扫描销售')

    expect(hr.some((t) => t.profile.id === '51job-cn-cnc-sales')).toBe(true)
    expect(cmm?.profile.id).not.toBe('51job-cn-cnc-sales')
    expect(scanning?.profile.id).not.toBe('51job-cn-cnc-sales')
  })
})

