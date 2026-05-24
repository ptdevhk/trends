import { isRecord } from "@trends/shared";

export type TaxonomyClusterSource = 'human' | 'ai' | 'merged'
export type TaxonomyClusterStatus = 'active' | 'draft' | 'archived'

export type TaxonomyCluster = {
  id: string
  workspaceSlug: string
  name: string
  slug: string
  parentSlug?: string
  tags: string[]
  source: TaxonomyClusterSource
  confidence?: number
  status: TaxonomyClusterStatus
  createdAt: number
  updatedAt: number
}

export type TaxonomyClusterInput = {
  name: string
  slug: string
  parentSlug?: string
  tags: string[]
}

export type TaxonomyFacetCluster = {
  slug: string
  name: string
}

export type TaxonomyClusterResolver = {
  clusters: TaxonomyFacetCluster[]
  clusterBySlug: Map<string, TaxonomyFacetCluster>
  resolveTagClusters: (tags: string[] | undefined) => TaxonomyFacetCluster[]
}

export type TaxonomyClusterFormState = {
  name: string
  slug: string
  parentSlug: string
  tags: string
  source: TaxonomyClusterSource
  confidence: string
  status: TaxonomyClusterStatus
}

export const CLUSTER_FILTER_PREFIX = 'cluster:'

export function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : undefined
}

export function normalizeStringList(values: string[] | undefined): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    return []
  }

  const seen = new Set<string>()
  const normalized: string[] = []

  values.forEach((value) => {
    const token = value.trim()
    const key = token.toLowerCase()
    if (!token || seen.has(key)) {
      return
    }

    seen.add(key)
    normalized.push(token)
  })

  return normalized
}

export function slugifyTaxonomyValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function toClusterFilterToken(slug: string): string {
  return `${CLUSTER_FILTER_PREFIX}${slug.trim().toLowerCase()}`
}

export function isClusterFilterToken(value: string): boolean {
  return value.trim().toLowerCase().startsWith(CLUSTER_FILTER_PREFIX)
}

export function fromClusterFilterToken(value: string): string {
  return value.trim().slice(CLUSTER_FILTER_PREFIX.length).trim().toLowerCase()
}

export function createEmptyTaxonomyClusterForm(): TaxonomyClusterFormState {
  return {
    name: '',
    slug: '',
    parentSlug: '',
    tags: '',
    source: 'human',
    confidence: '',
    status: 'active',
  }
}

export function taxonomyClusterToForm(cluster: TaxonomyCluster): TaxonomyClusterFormState {
  return {
    name: cluster.name,
    slug: cluster.slug,
    parentSlug: cluster.parentSlug ?? '',
    tags: cluster.tags.join(', '),
    source: cluster.source,
    confidence: typeof cluster.confidence === 'number' ? String(cluster.confidence) : '',
    status: cluster.status,
  }
}


export function parseTaxonomyCluster(value: unknown): TaxonomyCluster | null {
  if (!isRecord(value)) {
    return null
  }

  const id = typeof value._id === 'string'
    ? value._id
    : typeof value.id === 'string'
      ? value.id
      : null
  const workspaceSlug = typeof value.workspaceSlug === 'string' ? value.workspaceSlug : null
  const name = typeof value.name === 'string' ? value.name.trim() : null
  const slug = typeof value.slug === 'string' ? value.slug.trim() : null
  const source = value.source === 'human' || value.source === 'ai' || value.source === 'merged'
    ? value.source
    : null
  const status = value.status === 'active' || value.status === 'draft' || value.status === 'archived'
    ? value.status
    : null
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : null
  const updatedAt = typeof value.updatedAt === 'number' ? value.updatedAt : null

  if (!id || !workspaceSlug || !name || !slug || !source || !status || createdAt === null || updatedAt === null) {
    return null
  }

  return {
    id,
    workspaceSlug,
    name,
    slug: slug.toLowerCase(),
    parentSlug: typeof value.parentSlug === 'string' && value.parentSlug.trim().length > 0 ? value.parentSlug.trim().toLowerCase() : undefined,
    tags: Array.isArray(value.tags) ? normalizeStringList(value.tags.filter((item): item is string => typeof item === 'string')) : [],
    source,
    confidence: typeof value.confidence === 'number' ? value.confidence : undefined,
    status,
    createdAt,
    updatedAt,
  }
}

export function parseTaxonomyClustersPayload(payload: unknown): TaxonomyCluster[] | null {
  if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.items)) {
    return null
  }

  return payload.items
    .map((item) => parseTaxonomyCluster(item))
    .filter((item): item is TaxonomyCluster => item !== null)
}

function createFacetCluster(input: TaxonomyClusterInput): TaxonomyFacetCluster {
  return {
    slug: input.slug.trim().toLowerCase(),
    name: input.name.trim(),
  }
}

export function createTaxonomyClusterResolver(
  clusters: TaxonomyClusterInput[] | undefined,
): TaxonomyClusterResolver {
  const normalizedClusters = (clusters ?? [])
    .map((cluster) => ({
      name: cluster.name.trim(),
      slug: cluster.slug.trim().toLowerCase(),
      parentSlug: normalizeOptionalString(cluster.parentSlug)?.toLowerCase(),
      tags: normalizeStringList(cluster.tags),
    }))
    .filter((cluster) => cluster.name.length > 0 && cluster.slug.length > 0)
  const sourceBySlug = new Map(normalizedClusters.map((cluster) => [cluster.slug, cluster]))
  const displayBySlug = new Map<string, TaxonomyFacetCluster>()
  const tagToCluster = new Map<string, TaxonomyFacetCluster>()

  const resolveDisplayCluster = (
    cluster: TaxonomyClusterInput & { slug: string; parentSlug?: string },
    lineage = new Set<string>(),
  ): TaxonomyFacetCluster => {
    const cached = displayBySlug.get(cluster.slug)
    if (cached) {
      return cached
    }

    if (cluster.parentSlug && !lineage.has(cluster.parentSlug)) {
      const parent = sourceBySlug.get(cluster.parentSlug)
      if (parent) {
        const nextLineage = new Set(lineage)
        nextLineage.add(cluster.slug)
        const resolvedParent = resolveDisplayCluster(parent, nextLineage)
        displayBySlug.set(cluster.slug, resolvedParent)
        return resolvedParent
      }
    }

    const next = createFacetCluster(cluster)
    displayBySlug.set(cluster.slug, next)
    return next
  }

  normalizedClusters.forEach((cluster) => {
    const displayCluster = resolveDisplayCluster(cluster)
    cluster.tags.forEach((tag) => {
      const normalizedTag = tag.trim().toLowerCase()
      if (!normalizedTag || tagToCluster.has(normalizedTag)) {
        return
      }

      tagToCluster.set(normalizedTag, displayCluster)
    })
  })

  const clusterBySlug = new Map(
    Array.from(new Set(normalizedClusters.map((cluster) => resolveDisplayCluster(cluster).slug)))
      .map((slug) => {
        const cluster = displayBySlug.get(slug)
        return cluster ? [slug, cluster] : null
      })
      .filter((entry): entry is [string, TaxonomyFacetCluster] => entry !== null)
      .sort((left, right) => left[1].name.localeCompare(right[1].name))
  )

  return {
    clusters: Array.from(clusterBySlug.values()),
    clusterBySlug,
    resolveTagClusters: (tags) => {
      if (!tags || tags.length === 0) {
        return []
      }

      const seen = new Set<string>()
      const matched: TaxonomyFacetCluster[] = []

      tags.forEach((tag) => {
        const normalizedTag = tag.trim().toLowerCase()
        if (!normalizedTag) {
          return
        }

        const cluster = tagToCluster.get(normalizedTag)
        if (!cluster || seen.has(cluster.slug)) {
          return
        }

        seen.add(cluster.slug)
        matched.push(cluster)
      })

      return matched.sort((left, right) => left.name.localeCompare(right.name))
    },
  }
}
