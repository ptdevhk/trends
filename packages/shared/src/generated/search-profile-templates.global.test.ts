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
