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
  const IDS = {
    MY: 'seek-malaysia-talent-search-service-engineer',
    TH: 'seek-thailand-talent-search-service-engineer',
  } as const

  function seekSource(template: ReturnType<typeof getWorkspaceSearchProfileTemplates>[number] | undefined) {
    return template?.profile.sources?.find((source) => source.type === 'seek' && source.enabled)
  }

  it('seeds two location-split Seek talent-search profiles without sales titles', () => {
    for (const workspace of ['hr', 'dev'] as const) {
      const templates = getWorkspaceSearchProfileTemplates(workspace)
      const my = templates.find((t) => t.profile.id === IDS.MY)
      const th = templates.find((t) => t.profile.id === IDS.TH)

      expect(my, `${workspace}/${IDS.MY}`).toBeDefined()
      expect(th, `${workspace}/${IDS.TH}`).toBeDefined()
      expect(my?.profile.location).toBe('Malaysia')
      expect(th?.profile.location).toBe('Thailand')
      expect(my?.profile.filters?.locations).toEqual(['Malaysia'])
      expect(th?.profile.filters?.locations).toEqual(['Thailand'])
      expect(my?.profile.jobDescription).toBe('seek-malaysia-service-engineer')
      expect(th?.profile.jobDescription).toBe('seek-thailand-service-engineer')
      expect(my?.profile.filters?.roleFilterType).toBe('engineer')
      expect(th?.profile.filters?.roleFilterType).toBe('engineer')
      expect(my?.profile.keywords).not.toContain('Sales')
      expect(th?.profile.keywords).not.toContain('Sales')

      const mySeek = seekSource(my)
      const thSeek = seekSource(th)
      expect(mySeek?.mode).toBe('talentsearch')
      expect(thSeek?.mode).toBe('talentsearch')

      const myUrl = new URL(mySeek?.jobUrl ?? '')
      const thUrl = new URL(thSeek?.jobUrl ?? '')
      expect(myUrl.protocol).toBe('https:')
      expect(thUrl.protocol).toBe('https:')
      expect(myUrl.host).toBe('hk.employer.seek.com')
      expect(thUrl.host).toBe('hk.employer.seek.com')
      expect(myUrl.pathname).toBe('/talentsearch')
      expect(thUrl.pathname).toBe('/talentsearch')
      expect(myUrl.searchParams.get('market')).toBe('MY')
      expect(thUrl.searchParams.get('market')).toBe('TH')
      expect(myUrl.host).not.toBe('th.employer.seek.com')
      expect(thUrl.host).not.toBe('th.employer.seek.com')
      expect(myUrl.searchParams.get('searchQuery')).toBe('CNC')
      expect(myUrl.searchParams.get('keywords')).toBe('CNC')
      expect(myUrl.searchParams.get('matchAll')).toBe('false')
      expect(thUrl.searchParams.get('searchQuery')).toBe('CNC')
      expect(thUrl.searchParams.get('keywords')).toBe('CNC')

      for (const url of [myUrl, thUrl]) {
        const roleTitles = (url.searchParams.get('roleTitles') ?? '').split(',').filter(Boolean)
        expect(roleTitles).toEqual(ROLE_STACK)
        expect(roleTitles.some((title) => /sales/i.test(title))).toBe(false)
      }
    }
  })
})

describe('51job CN CMM and 3D scanning sales profiles', () => {
  const COMBINED_ID = '51job-cn-cmm-3d-scanning-sales'
  const SPLIT_IDS = ['51job-cn-cmm-sales', '51job-cn-3d-scanning-sales'] as const

  it('seeds the HR-selected combined Option 1 profile and keeps split lanes off quick-start', () => {
    const hr = getWorkspaceSearchProfileTemplates('hr')
    const dev = getWorkspaceSearchProfileTemplates('dev')
    const combined = hr.find((t) => t.profile.id === COMBINED_ID)
    const cmm = hr.find((t) => t.profile.id === '51job-cn-cmm-sales')
    const scanning = hr.find((t) => t.profile.id === '51job-cn-3d-scanning-sales')

    expect(combined).toBeDefined()
    expect(cmm).toBeDefined()
    expect(scanning).toBeDefined()
    expect(dev.some((t) => t.profile.id === COMBINED_ID)).toBe(true)
    expect(SEARCH_PROFILE_TEMPLATES.some((t) => t.profile.id === COMBINED_ID)).toBe(true)

    for (const template of [combined, cmm, scanning]) {
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

    expect(combined?.profile.keywords).toEqual(['三坐标', '3D扫描', '销售'])
    expect(combined?.profile.jobDescription).toBe('cmm-3d-scanning-sales')
    expect(combined?.profile.filters?.salaryRange?.max).toBe(25000)
    expect(cmm?.profile.filters?.salaryRange?.max).toBe(25000)
    expect(scanning?.profile.filters?.salaryRange?.max).toBe(25000)
    expect(combined?.profile.quickStart?.enabled).toBe(true)
    expect(combined?.profile.quickStart?.rank).toBe(7)
    expect(combined?.profile.quickStart?.label).toBe('China · 51job · 三坐标 3D扫描 销售')
    expect(combined?.profile.quickStart?.description).toBe('三坐标, 3D扫描, 销售 · China')

    expect(cmm?.profile.keywords).toEqual(['三坐标测量机', '销售'])
    expect(scanning?.profile.keywords).toEqual(['3D扫描仪', '销售'])
    expect(cmm?.profile.jobDescription).toBe('cmm-sales')
    expect(scanning?.profile.jobDescription).toBe('3d-scanner-sales')
    expect(cmm?.profile.quickStart?.enabled).toBe(false)
    expect(scanning?.profile.quickStart?.enabled).toBe(false)

    expect(hr.filter((t) => SPLIT_IDS.includes(t.profile.id as (typeof SPLIT_IDS)[number]) && t.profile.quickStart?.enabled)).toEqual([])
    expect(hr.some((t) => t.profile.id === '51job-cn-cnc-sales')).toBe(true)
    expect(combined?.profile.id).not.toBe('51job-cn-cnc-sales')
  })
})

