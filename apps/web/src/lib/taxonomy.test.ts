import { describe, expect, it } from 'vitest'
import {
  createTaxonomyClusterResolver,
  fromClusterFilterToken,
  isClusterFilterToken,
  parseTaxonomyCluster,
  parseTaxonomyClustersPayload,
  toClusterFilterToken,
} from '@/lib/taxonomy'

describe('taxonomy helpers', () => {
  it('normalizes cluster filter tokens to canonical lowercase slugs', () => {
    expect(toClusterFilterToken(' Manufacturing Systems ')).toBe('cluster:manufacturing systems')
    expect(isClusterFilterToken(' Cluster:Manufacturing-Systems ')).toBe(true)
    expect(fromClusterFilterToken(' Cluster:Manufacturing-Systems ')).toBe('manufacturing-systems')
  })

  it('parses taxonomy clusters with lowercase slug lineage and normalized tags', () => {
    expect(parseTaxonomyCluster({
      _id: 'cluster-1',
      workspaceSlug: 'dev',
      name: ' Manufacturing Systems ',
      slug: ' Manufacturing-Systems ',
      parentSlug: ' Core-Domains ',
      tags: [' Machine Tools ', 'machine tools', 'Automation'],
      source: 'human',
      confidence: 0.82,
      status: 'active',
      createdAt: 1,
      updatedAt: 2,
    })).toEqual({
      id: 'cluster-1',
      workspaceSlug: 'dev',
      name: 'Manufacturing Systems',
      slug: 'manufacturing-systems',
      parentSlug: 'core-domains',
      tags: ['Machine Tools', 'Automation'],
      source: 'human',
      confidence: 0.82,
      status: 'active',
      createdAt: 1,
      updatedAt: 2,
    })
  })

  it('returns only valid clusters from taxonomy payload envelopes', () => {
    expect(parseTaxonomyClustersPayload({
      success: true,
      items: [
        {
          id: 'cluster-1',
          workspaceSlug: 'dev',
          name: 'Manufacturing Systems',
          slug: 'manufacturing-systems',
          tags: ['Machine Tools'],
          source: 'human',
          status: 'active',
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: 'cluster-2',
          workspaceSlug: 'dev',
          name: '',
          slug: 'invalid',
          tags: ['Automation'],
          source: 'human',
          status: 'active',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    })).toEqual([
      {
        id: 'cluster-1',
        workspaceSlug: 'dev',
        name: 'Manufacturing Systems',
        slug: 'manufacturing-systems',
        parentSlug: undefined,
        tags: ['Machine Tools'],
        source: 'human',
        confidence: undefined,
        status: 'active',
        createdAt: 1,
        updatedAt: 2,
      },
    ])

    expect(parseTaxonomyClustersPayload({
      success: false,
      items: [],
    })).toBeNull()
  })

  it('resolves child tags to their parent display cluster and dedupes matches case-insensitively', () => {
    const resolver = createTaxonomyClusterResolver([
      {
        name: 'Manufacturing Systems',
        slug: 'manufacturing-systems',
        tags: [],
      },
      {
        name: 'Automation Stack',
        slug: 'automation-stack',
        parentSlug: 'manufacturing-systems',
        tags: ['Machine Tools', 'Automation'],
      },
      {
        name: 'Go To Market',
        slug: 'go-to-market',
        tags: ['Sales'],
      },
    ])

    expect(resolver.clusters).toEqual([
      { slug: 'go-to-market', name: 'Go To Market' },
      { slug: 'manufacturing-systems', name: 'Manufacturing Systems' },
    ])
    expect(resolver.clusterBySlug.get('manufacturing-systems')).toEqual({
      slug: 'manufacturing-systems',
      name: 'Manufacturing Systems',
    })
    expect(resolver.resolveTagClusters([' automation ', 'Machine Tools', 'SALES', 'sales'])).toEqual([
      { slug: 'go-to-market', name: 'Go To Market' },
      { slug: 'manufacturing-systems', name: 'Manufacturing Systems' },
    ])
  })
})
