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
            workflowSeeds: [
              {
                id: 'seek-my-cnc-sales',
                label: 'Malaysia · SEEK · CNC Sales',
                market: 'MY',
                location: 'Kuala Lumpur MY',
                keywords: ['CNC', 'Sales'],
                collectionSource: {
                  type: 'seek',
                },
                visible: true,
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

      throw new Error(`Unexpected GET path: ${path}`)
    })
  })

  it('keeps workspace custom tags in grouped keywords while limiting hotKeywords to system seed tags', async () => {
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
    expect(result.current.workflowSeeds).toHaveLength(1)
  })
})
