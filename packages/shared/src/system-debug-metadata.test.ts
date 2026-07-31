import { describe, expect, it } from 'vitest'
import {
  APP_SURFACE_IDENTITY,
  INSPECTABLE_SOURCE_GROUP_DEFINITIONS,
  STATIC_INSPECTABLE_SOURCE_DEFINITIONS,
  SYSTEM_NAV_ITEMS,
  SETTINGS_NAV_ITEMS,
  SYSTEM_SETTINGS_NAV_ITEMS,
  DEBUG_PAGE_SECTION_DEFINITIONS,
  DEBUG_AI_BREAKDOWN_LABELS,
  DEBUG_AI_KEYWORD_PROMPT_VARIANT,
  INGEST_BRAND_SOURCE_LABELS,
  INGEST_BRAND_CONTEXT_LABELS,
  INGEST_BRAND_ROLE_LABELS,
  SYSTEM_CAPABILITY_DESCRIPTORS,
  getLabelDescriptor,
} from './system-debug-metadata'

describe('APP_SURFACE_IDENTITY', () => {
  it('has required fields', () => {
    expect(APP_SURFACE_IDENTITY.appName).toBe('Trends')
    expect(APP_SURFACE_IDENTITY.homeTitle).toBe('Trends')
    expect(APP_SURFACE_IDENTITY.systemTitle).toBe('System Admin')
    expect(APP_SURFACE_IDENTITY.settingsTitle).toBe('Workspace Settings')
  })
})

describe('INSPECTABLE_SOURCE_GROUP_DEFINITIONS', () => {
  it('has prompt, config, and project-notes groups', () => {
    const keys = INSPECTABLE_SOURCE_GROUP_DEFINITIONS.map((g) => g.key)
    expect(keys).toContain('prompt')
    expect(keys).toContain('config')
    expect(keys).toContain('project-notes')
  })

  it('each group has label and description', () => {
    for (const group of INSPECTABLE_SOURCE_GROUP_DEFINITIONS) {
      expect(group.label).toBeTruthy()
      expect(group.description).toBeTruthy()
    }
  })
})

describe('STATIC_INSPECTABLE_SOURCE_DEFINITIONS', () => {
  it('has at least one config source', () => {
    const configSources = STATIC_INSPECTABLE_SOURCE_DEFINITIONS.filter((s) => s.group === 'config')
    expect(configSources.length).toBeGreaterThan(0)
  })

  it('has at least one project-notes source', () => {
    const projectNotes = STATIC_INSPECTABLE_SOURCE_DEFINITIONS.filter((s) => s.group === 'project-notes')
    expect(projectNotes.length).toBeGreaterThan(0)
  })

  it('each source has required fields', () => {
    for (const source of STATIC_INSPECTABLE_SOURCE_DEFINITIONS) {
      expect(source.key).toBeTruthy()
      expect(source.label).toBeTruthy()
      expect(source.relativePath).toBeTruthy()
      expect(['markdown', 'json5', 'text']).toContain(source.type)
    }
  })

  it('keys are unique', () => {
    const keys = STATIC_INSPECTABLE_SOURCE_DEFINITIONS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('SYSTEM_NAV_ITEMS', () => {
  it('is non-empty', () => {
    expect(SYSTEM_NAV_ITEMS.length).toBeGreaterThan(0)
  })

  it('each item has id, titleKey, defaultTitle, hrefSuffix', () => {
    for (const item of SYSTEM_NAV_ITEMS) {
      expect(item.id).toBeTruthy()
      expect(item.titleKey).toBeTruthy()
      expect(item.defaultTitle).toBeTruthy()
      expect(item.hrefSuffix).toBeTruthy()
    }
  })

  it('has a home entry pointing to /resumes', () => {
    const home = SYSTEM_NAV_ITEMS.find((item) => item.id === 'home')
    expect(home).toBeDefined()
    expect(home!.hrefSuffix).toBe('/resumes')
  })

  it('does not expose the legacy setup wizard in system navigation', () => {
    const ids = SYSTEM_NAV_ITEMS.map((item) => item.id)
    expect(ids).not.toContain('setup')
  })
})

describe('SETTINGS_NAV_ITEMS', () => {
  it('includes home, setup, search setup, profiles, policies, and export fields entries', () => {
    const ids = SETTINGS_NAV_ITEMS.map((item) => item.id)
    expect(ids).toContain('home')
    expect(ids).toContain('setup')
    expect(ids).toContain('keywords')
    expect(ids).toContain('profiles')
    expect(ids).toContain('policies')
    expect(ids).toContain('export-fields')
  })

  it('routes setup and search setup through the workspace settings surface', () => {
    const setup = SETTINGS_NAV_ITEMS.find((item) => item.id === 'setup')
    const searchSetup = SETTINGS_NAV_ITEMS.find((item) => item.id === 'keywords')

    expect(setup?.hrefSuffix).toBe('/settings/setup')
    expect(searchSetup?.hrefSuffix).toBe('/settings/keywords')
  })

  it('routes policies to the unified settings surface and still matches legacy blocks', () => {
    const policies = SETTINGS_NAV_ITEMS.find((item) => item.id === 'policies')
    expect(policies?.hrefSuffix).toBe('/settings/policies')
    expect(policies?.matchesSuffixes).toContain('/settings/blocks')
  })

  it('marks export fields as regular workspace settings', () => {
    const exportFields = SETTINGS_NAV_ITEMS.find((item) => item.id === 'export-fields')
    expect(exportFields?.hrefSuffix).toBe('/settings/export-fields')
    expect(exportFields?.requiresAdmin).toBeUndefined()
  })
})

describe('SYSTEM_SETTINGS_NAV_ITEMS', () => {
  it('includes overview and runtime entries', () => {
    const ids = SYSTEM_SETTINGS_NAV_ITEMS.map((item) => item.id)
    expect(ids).toContain('overview')
    expect(ids).toContain('runtime')
    expect(ids).toContain('industry-verification')
    expect(ids).toContain('industry-data')
  })

  it('marks industry evidence stewardship as an admin system setting', () => {
    const item = SYSTEM_SETTINGS_NAV_ITEMS.find((entry) => entry.id === 'industry-verification')
    expect(item).toMatchObject({
      hrefSuffix: '/system/settings/industry-verification',
      requiresAdmin: true,
    })
  })

  it('marks industry data central management as an admin system setting', () => {
    const item = SYSTEM_SETTINGS_NAV_ITEMS.find((entry) => entry.id === 'industry-data')
    expect(item).toMatchObject({
      hrefSuffix: '/system/settings/industry-data',
      requiresAdmin: true,
    })
  })

  it('does not expose relocated keyword or location editors in system settings navigation', () => {
    const ids = SYSTEM_SETTINGS_NAV_ITEMS.map((item) => item.id)
    expect(ids).not.toContain('keywords')
    expect(ids).not.toContain('locations')
  })
})

describe('DEBUG_PAGE_SECTION_DEFINITIONS', () => {
  it('starts with "all" section', () => {
    expect(DEBUG_PAGE_SECTION_DEFINITIONS[0].id).toBe('all')
  })

  it('includes all expected section ids', () => {
    const ids = DEBUG_PAGE_SECTION_DEFINITIONS.map((s) => s.id)
    expect(ids).toContain('inputs')
    expect(ids).toContain('findings')
    expect(ids).toContain('process')
    expect(ids).toContain('raw')
    expect(ids).toContain('ai')
  })
})

describe('DEBUG_AI_BREAKDOWN_LABELS', () => {
  it('includes experience and skills labels', () => {
    const keys = DEBUG_AI_BREAKDOWN_LABELS.map((l) => l.key)
    expect(keys).toContain('experience')
    expect(keys).toContain('skills')
  })

  it('each label has key, aliases, labelKey, defaultLabel', () => {
    for (const label of DEBUG_AI_BREAKDOWN_LABELS) {
      expect(label.key).toBeTruthy()
      expect(Array.isArray(label.aliases)).toBe(true)
      expect(label.labelKey).toBeTruthy()
      expect(label.defaultLabel).toBeTruthy()
    }
  })
})

describe('DEBUG_AI_KEYWORD_PROMPT_VARIANT', () => {
  it('has title and body', () => {
    expect(DEBUG_AI_KEYWORD_PROMPT_VARIANT.title).toBeTruthy()
    expect(DEBUG_AI_KEYWORD_PROMPT_VARIANT.body).toBeTruthy()
  })
})

describe('INGEST_BRAND_SOURCE_LABELS', () => {
  it('has workHistory, selfIntro, jobIntention', () => {
    const values = INGEST_BRAND_SOURCE_LABELS.map((l) => l.value)
    expect(values).toContain('workHistory')
    expect(values).toContain('selfIntro')
    expect(values).toContain('jobIntention')
  })
})

describe('INGEST_BRAND_CONTEXT_LABELS', () => {
  it('has employer, equipment, sales, technical, general', () => {
    const values = INGEST_BRAND_CONTEXT_LABELS.map((l) => l.value)
    expect(values).toContain('employer')
    expect(values).toContain('equipment')
    expect(values).toContain('sales')
    expect(values).toContain('technical')
    expect(values).toContain('general')
  })
})

describe('INGEST_BRAND_ROLE_LABELS', () => {
  it('has employer, equipment, both', () => {
    const values = INGEST_BRAND_ROLE_LABELS.map((l) => l.value)
    expect(values).toContain('employer')
    expect(values).toContain('equipment')
    expect(values).toContain('both')
  })
})

describe('SYSTEM_CAPABILITY_DESCRIPTORS', () => {
  it('is non-empty', () => {
    expect(SYSTEM_CAPABILITY_DESCRIPTORS.length).toBeGreaterThan(0)
  })

  it('each descriptor has valid category', () => {
    const validCategories = ['inspect', 'debug', 'settings', 'navigation', 'cli']
    for (const desc of SYSTEM_CAPABILITY_DESCRIPTORS) {
      expect(validCategories).toContain(desc.category)
    }
  })

  it('each descriptor has id and title', () => {
    for (const desc of SYSTEM_CAPABILITY_DESCRIPTORS) {
      expect(desc.id).toBeTruthy()
      expect(desc.title).toBeTruthy()
      expect(desc.description).toBeTruthy()
    }
  })

  it('ids are unique', () => {
    const ids = SYSTEM_CAPABILITY_DESCRIPTORS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('getLabelDescriptor', () => {
  it('finds a matching label by value', () => {
    const result = getLabelDescriptor('workHistory', INGEST_BRAND_SOURCE_LABELS)
    expect(result).not.toBeNull()
    expect(result!.value).toBe('workHistory')
  })

  it('returns null for non-matching value', () => {
    const result = getLabelDescriptor('nonexistent', INGEST_BRAND_SOURCE_LABELS)
    expect(result).toBeNull()
  })

  it('returns null for empty labels array', () => {
    const result = getLabelDescriptor('anything', [])
    expect(result).toBeNull()
  })
})
