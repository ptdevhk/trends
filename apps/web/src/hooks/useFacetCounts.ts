import { useMemo } from 'react'
import type { FacetCounts, FacetValueCount, ResumeSearchResultItem } from '@/components/search/search-types'
import {
  createTaxonomyClusterResolver,
  type TaxonomyClusterInput,
} from '@/lib/taxonomy'

const MIN_SCORE_OPTIONS = [60, 70, 80, 90] as const

function incrementCount(map: Map<string, number>, value: string | undefined) {
  const normalized = value?.trim()
  if (!normalized) {
    return
  }

  map.set(normalized, (map.get(normalized) ?? 0) + 1)
}

function incrementMany(map: Map<string, number>, values: string[] | undefined) {
  if (!values) {
    return
  }

  const seen = new Set<string>()
  values.forEach((value) => {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) {
      return
    }

    seen.add(normalized)
    incrementCount(map, normalized)
  })
}

function toSortedCounts(
  map: Map<string, number>,
  labelsByValue?: Map<string, string>,
): FacetValueCount[] {
  return Array.from(map.entries())
    .map(([value, count]) => ({
      value,
      count,
      label: labelsByValue?.get(value),
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count
      }

      return (left.label ?? left.value).localeCompare(right.label ?? right.value)
    })
}

export function useFacetCounts(
  results: ResumeSearchResultItem[],
  taxonomyClusters?: TaxonomyClusterInput[],
): FacetCounts {
  return useMemo(() => {
    const limitedResults = results.slice(0, 2000)
    const taxonomyResolver = createTaxonomyClusterResolver(taxonomyClusters)
    const clusterCounts = new Map<string, number>()
    const clusterLabels = new Map(
      taxonomyResolver.clusters.map((cluster) => [cluster.slug, cluster.name]),
    )
    const tagCounts = new Map<string, number>()
    const companyCounts = new Map<string, number>()
    const experienceCounts = new Map<string, number>()
    const educationCounts = new Map<string, number>()
    const statusCounts = new Map<string, number>()

    limitedResults.forEach((item) => {
      taxonomyResolver.resolveTagClusters(item.resume.ingestData?.industryTags).forEach((cluster) => {
        incrementCount(clusterCounts, cluster.slug)
      })
      incrementMany(tagCounts, item.resume.ingestData?.industryTags)
      incrementMany(companyCounts, item.resume.ingestData?.companyHits)
      incrementCount(experienceCounts, item.resume.ingestData?.experienceLevel)
      incrementCount(educationCounts, item.resume.education)
      incrementCount(statusCounts, item.status)
    })

    const minScoreOptions = MIN_SCORE_OPTIONS.map((threshold) => ({
      value: String(threshold),
      count: limitedResults.filter((item) => (item.score ?? 0) >= threshold).length,
    }))

    return {
      clusters: toSortedCounts(clusterCounts, clusterLabels),
      tags: toSortedCounts(tagCounts),
      companies: toSortedCounts(companyCounts),
      experienceLevels: toSortedCounts(experienceCounts),
      education: toSortedCounts(educationCounts),
      statuses: toSortedCounts(statusCounts),
      minScoreOptions,
    }
  }, [results, taxonomyClusters])
}
