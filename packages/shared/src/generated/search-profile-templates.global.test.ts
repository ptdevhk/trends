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
