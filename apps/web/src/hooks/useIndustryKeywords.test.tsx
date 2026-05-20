import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIndustryKeywords } from '@/hooks/useIndustryKeywords'

const { getMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    GET: (...args: unknown[]) => getMock(...args),
  },
}))

describe('useIndustryKeywords', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    getMock.mockImplementation((path: string) => {
      if (path === '/api/industry/keywords') {
        return Promise.resolve({
          data: {
            success: true,
            data: [],
          },
        })
      }

      if (path === '/api/config/custom-keywords') {
        return Promise.resolve({
          data: {
            success: true,
            tags: [
              {
                id: 'seed-equipment-cnc',
                keyword: 'CNC',
                category: 'equipment',
                visible: true,
                source: 'system',
              },
              {
                id: 'seed-role-sales',
                keyword: '销售',
                category: 'role',
                visible: true,
                source: 'system',
              },
              {
                id: 'workspace-dev-brand-haas',
                keyword: 'HAAS',
                category: 'workspace-dev-brand',
                source: 'workspace',
              },
              {
                id: 'workspace-dev-brand-star',
                keyword: 'STAR机床',
                category: 'workspace-dev-brand',
                source: 'workspace',
              },
            ],
          },
        })
      }

      if (path === '/api/industry/brands') {
        return Promise.resolve({
          data: {
            success: true,
            data: [],
          },
        })
      }

      if (path === '/api/search-profiles') {
        return Promise.resolve({
          data: {
            success: true,
            profiles: [
              {
                id: 'job5156-cn-cnc-sales',
                name: 'China Job5156 CNC Sales',
                status: 'active',
                location: 'China',
                keywords: ['CNC', '销售'],
                sources: [
                  {
                    type: 'job5156',
                    enabled: true,
                    priority: 1,
                  },
                ],
                quickStart: {
                  enabled: true,
                  rank: 1,
                  label: 'China · Job5156 · CNC 销售',
                },
                filters: {
                  minAge: 25,
                  maxAge: 40,
                  minExperience: 2,
                },
              },
            ],
          },
        })
      }

      throw new Error(`Unexpected GET path: ${path}`)
    })
  })

  it('keeps workspace custom tags in grouped keywords while sourcing landing quick starts from search profiles', async () => {
    const { result } = renderHook(() => useIndustryKeywords())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.hotKeywords.map((item) => item.keyword)).toEqual([
      'CNC',
      '销售',
    ])
    expect(result.current.grouped.custom.map((item) => item.keyword)).toEqual([
      'CNC',
      '销售',
      'HAAS',
      'STAR机床',
    ])
    expect(result.current.quickStartProfiles).toEqual([
      expect.objectContaining({
        id: 'job5156-cn-cnc-sales',
        label: 'China · Job5156 · CNC 销售',
        location: 'China',
        minAge: 25,
        maxAge: 40,
        source: {
          type: 'job5156',
        },
      }),
    ])
  })

  it('does not infer role-year constraints from experience-only profile filters', async () => {
    const { result } = renderHook(() => useIndustryKeywords())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.quickStartProfiles).toEqual([
      expect.objectContaining({
        id: 'job5156-cn-cnc-sales',
        keywords: ['CNC', '销售'],
        minRoleYears: undefined,
        roleFilterType: undefined,
      }),
    ])
  })
})
