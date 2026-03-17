import { useCallback, useMemo } from 'react'
import type {
  ConfigSourceMetadata,
  InspectableSourceDetail as ConfigSourceDetail,
  InspectableSourceGroupSummary as ConfigSourceGroupSummary,
  InspectableSourceSummary as ConfigSourceSummary,
} from '@trends/shared'
import { withWorkspaceHeaders } from '@/lib/workspace-ref'

export type {
  ConfigSourceMetadata,
  ConfigSourceDetail,
  ConfigSourceGroupSummary,
  ConfigSourceSummary,
}

export interface AIStatus {
  enabled: boolean
  model: string
  apiBase?: string
  temperature: number
  maxTokens: number
  timeout: number
  apiKeyMasked: string
  valid: boolean
  validationError?: string
  bonded?: string[]
}

export interface AgentConfig {
  batchSize?: number
  parallelism?: number
  timeout?: number
  temperature?: number
  maxTokens?: number
  [key: string]: unknown
}

export interface AgentItem {
  id: string
  name: string
  model: string
  config: AgentConfig
  isBonded?: boolean
  [key: string]: unknown
}

export interface AgentDefaults {
  passThreshold?: number
  [key: string]: unknown
}

export interface AgentsConfig {
  agents: {
    list: AgentItem[]
    defaults: Record<string, AgentDefaults>
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface CustomKeywordTag {
  id: string
  keyword: string
  english?: string
  category: string
}

export interface CustomKeywordCategory {
  id: string
  name: string
  icon?: string
}

export interface SystemLocationItem {
  id: string
  keyword: string
  level: 'province' | 'city'
  parentKeyword?: string
  visible: boolean
}

export interface CustomKeywordFormState {
  id: string
  keyword: string
  english: string
  category: string
}

export interface BrandKeywordItem {
  id: number
  nameCn: string
  nameEn?: string
  type: string
  origin: string
}

export type AgentNumericField = 'batchSize' | 'parallelism' | 'timeout' | 'temperature'
export type SystemSettingsSubpageId = 'overview' | 'operations' | 'runtime' | 'config-sources' | 'keywords' | 'locations'

export interface SystemSettingsSubpageDefinition {
  id: SystemSettingsSubpageId
  href: string
  titleKey: string
  defaultTitle: string
  descriptionKey: string
  defaultDescription: string
}

export const SYSTEM_SETTINGS_SUBPAGES: SystemSettingsSubpageDefinition[] = [
  {
    id: 'overview',
    href: '.',
    titleKey: 'debugConfig.settingsNavOverview',
    defaultTitle: 'Overview',
    descriptionKey: 'debugConfig.settingsOverviewPageDescription',
    defaultDescription: 'Open each settings area in a dedicated page instead of scrolling through one long screen.',
  },
  {
    id: 'operations',
    href: 'operations',
    titleKey: 'debugConfig.settingsNavOperations',
    defaultTitle: 'Operations',
    descriptionKey: 'debugConfig.operationsPageDescription',
    defaultDescription: 'Live diagnostics and manual collection controls.',
  },
  {
    id: 'runtime',
    href: 'runtime',
    titleKey: 'debugConfig.settingsNavRuntime',
    defaultTitle: 'AI and agents',
    descriptionKey: 'debugConfig.runtimePageDescription',
    defaultDescription: 'Inspect AI connectivity and the screening pipeline.',
  },
  {
    id: 'config-sources',
    href: 'config-sources',
    titleKey: 'debugConfig.settingsNavConfigSources',
    defaultTitle: 'Config sources',
    descriptionKey: 'debugConfig.configSourcesPageDescription',
    defaultDescription: 'Inspect read-only prompt and configuration sources.',
  },
  {
    id: 'keywords',
    href: 'keywords',
    titleKey: 'debugConfig.settingsNavKeywords',
    defaultTitle: 'Keywords',
    descriptionKey: 'debugConfig.keywordsPageDescription',
    defaultDescription: 'Manage editable keywords and review derived brand data.',
  },
  {
    id: 'locations',
    href: 'locations',
    titleKey: 'debugConfig.settingsNavLocations',
    defaultTitle: 'Locations',
    descriptionKey: 'debugConfig.locationsPageDescription',
    defaultDescription: 'Control which system location chips are visible in the UI.',
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  return null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return null
}

function readOptionalNumber(value: unknown): number | undefined {
  const parsed = readNumber(value)
  if (parsed === null) {
    return undefined
  }
  return parsed
}

export function parseOptionalNumberInput(value: string): { valid: boolean; value?: number } {
  const normalized = value.trim()
  if (!normalized) {
    return { valid: true }
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    return { valid: false }
  }

  return { valid: true, value: parsed }
}

function parseAgentItem(value: unknown): AgentItem | null {
  if (!isRecord(value)) {
    return null
  }

  const id = readString(value.id)
  const name = readString(value.name)
  const model = readString(value.model)
  if (!id || !name || !model) {
    return null
  }

  const rawConfig = isRecord(value.config) ? value.config : {}
  const config: AgentConfig = {
    ...rawConfig,
    batchSize: readOptionalNumber(rawConfig.batchSize),
    parallelism: readOptionalNumber(rawConfig.parallelism),
    timeout: readOptionalNumber(rawConfig.timeout),
    temperature: readOptionalNumber(rawConfig.temperature),
    maxTokens: readOptionalNumber(rawConfig.maxTokens),
  }

  return {
    ...value,
    id,
    name,
    model,
    config,
    isBonded: Boolean(value.isBonded),
  }
}

function parseAgentDefaults(value: unknown): Record<string, AgentDefaults> | null {
  if (!isRecord(value)) {
    return null
  }

  const parsed: Record<string, AgentDefaults> = {}
  for (const [key, rawValue] of Object.entries(value)) {
    if (!isRecord(rawValue)) {
      continue
    }

    parsed[key] = {
      ...rawValue,
      passThreshold: readOptionalNumber(rawValue.passThreshold),
    }
  }

  return parsed
}

export function parseAgentsConfigPayload(payload: unknown): AgentsConfig | null {
  if (!isRecord(payload) || payload.success !== true) {
    return null
  }

  const rawConfig = payload.config
  if (!isRecord(rawConfig)) {
    return null
  }

  const rawAgents = rawConfig.agents
  if (!isRecord(rawAgents)) {
    return null
  }

  const rawList = rawAgents.list
  if (!Array.isArray(rawList)) {
    return null
  }

  const list: AgentItem[] = []
  for (const item of rawList) {
    const parsedItem = parseAgentItem(item)
    if (!parsedItem) {
      continue
    }
    list.push(parsedItem)
  }

  const defaults = parseAgentDefaults(rawAgents.defaults)
  if (!defaults) {
    return null
  }

  return {
    ...rawConfig,
    agents: {
      ...rawAgents,
      list,
      defaults,
    },
  }
}

export function parseAIStatusPayload(payload: unknown): AIStatus | null {
  if (!isRecord(payload) || payload.success !== true) {
    return null
  }

  const enabled = typeof payload.enabled === 'boolean' ? payload.enabled : null
  const model = readString(payload.model)
  const temperature = readNumber(payload.temperature)
  const maxTokens = readNumber(payload.maxTokens)
  const timeout = readNumber(payload.timeout)
  const apiKeyMasked = readString(payload.apiKeyMasked)
  const valid = typeof payload.valid === 'boolean' ? payload.valid : null

  if (
    enabled === null ||
    model === null ||
    temperature === null ||
    maxTokens === null ||
    timeout === null ||
    apiKeyMasked === null ||
    valid === null
  ) {
    return null
  }

  const apiBase = readString(payload.apiBase) ?? undefined
  const validationError = readString(payload.validationError) ?? undefined
  const bonded = Array.isArray(payload.bonded) ? payload.bonded.filter((item): item is string => typeof item === 'string') : undefined

  return {
    enabled,
    model,
    apiBase,
    temperature,
    maxTokens,
    timeout,
    apiKeyMasked,
    valid,
    validationError,
    bonded,
  }
}

function parseCustomKeywordTag(value: unknown): CustomKeywordTag | null {
  if (!isRecord(value)) {
    return null
  }

  const id = readString(value.id)
  const keyword = readString(value.keyword)
  const english = readString(value.english) ?? undefined
  const category = readString(value.category)
  if (!id || !keyword || !category) {
    return null
  }

  return {
    id,
    keyword,
    english,
    category,
  }
}

function parseCustomKeywordCategory(value: unknown): CustomKeywordCategory | null {
  if (!isRecord(value)) {
    return null
  }

  const id = readString(value.id)
  const name = readString(value.name)
  if (!id || !name) {
    return null
  }

  return {
    id,
    name,
    icon: readString(value.icon) ?? undefined,
  }
}

function parseSystemLocationItem(value: unknown): SystemLocationItem | null {
  if (!isRecord(value)) {
    return null
  }

  const id = readString(value.id)
  const keyword = readString(value.keyword)
  const level = value.level === 'province' || value.level === 'city' ? value.level : null
  const visible = typeof value.visible === 'boolean' ? value.visible : null
  if (!id || !keyword || !level || visible === null) {
    return null
  }

  return {
    id,
    keyword,
    level,
    visible,
    parentKeyword: readString(value.parentKeyword) ?? undefined,
  }
}

export function parseCustomKeywordsPayload(
  payload: unknown,
): { tags: CustomKeywordTag[]; categories: CustomKeywordCategory[]; systemLocations: SystemLocationItem[] } | null {
  if (!isRecord(payload) || payload.success !== true) {
    return null
  }

  if (!Array.isArray(payload.tags) || !Array.isArray(payload.categories)) {
    return null
  }

  const tags = payload.tags
    .map((item) => parseCustomKeywordTag(item))
    .filter((item): item is CustomKeywordTag => item !== null)

  const categories = payload.categories
    .map((item) => parseCustomKeywordCategory(item))
    .filter((item): item is CustomKeywordCategory => item !== null)

  const systemLocations = Array.isArray(payload.systemLocations)
    ? payload.systemLocations
      .map((item) => parseSystemLocationItem(item))
      .filter((item): item is SystemLocationItem => item !== null)
    : []

  return { tags, categories, systemLocations }
}

function parseBrandKeywordItem(value: unknown): BrandKeywordItem | null {
  if (!isRecord(value)) {
    return null
  }

  const id = readNumber(value.id)
  const nameCn = readString(value.nameCn)
  const type = readString(value.type)
  const origin = readString(value.origin)
  if (id === null || !nameCn || !type || !origin) {
    return null
  }

  return {
    id,
    nameCn,
    type,
    origin,
    nameEn: readString(value.nameEn) ?? undefined,
  }
}

export function parseBrandKeywordsPayload(payload: unknown): BrandKeywordItem[] | null {
  if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.data)) {
    return null
  }

  return payload.data
    .map((item) => parseBrandKeywordItem(item))
    .filter((item): item is BrandKeywordItem => item !== null)
}

function parseConfigSourceMetadata(value: unknown): ConfigSourceMetadata | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const version = readNumber(value.version) ?? undefined
  const updatedAt = readString(value.updatedAt) ?? undefined
  const description = readString(value.description) ?? undefined
  const locale = readString(value.locale) ?? undefined
  const requestedLocale = readString(value.requestedLocale) ?? undefined
  const resolvedSourceLocale = readString(value.resolvedSourceLocale) ?? undefined
  const fallbackToZhHans = typeof value.fallbackToZhHans === 'boolean' ? value.fallbackToZhHans : undefined

  if (
    version === undefined &&
    updatedAt === undefined &&
    description === undefined &&
    locale === undefined &&
    requestedLocale === undefined &&
    resolvedSourceLocale === undefined &&
    fallbackToZhHans === undefined
  ) {
    return undefined
  }

  return {
    version,
    updatedAt,
    description,
    locale,
    requestedLocale,
    resolvedSourceLocale,
    fallbackToZhHans,
  }
}

function parseConfigSourceSummary(value: unknown): ConfigSourceSummary | null {
  if (!isRecord(value)) {
    return null
  }

  const key = readString(value.key)
  const label = readString(value.label)
  const relativePath = readString(value.relativePath)
  const type = value.type === 'markdown' || value.type === 'json5' || value.type === 'text' ? value.type : null
  const group = value.group === 'prompt' || value.group === 'config' || value.group === 'project-notes' ? value.group : null
  const audience = value.audience === 'developer' || value.audience === 'admin' || value.audience === 'app' ? value.audience : null
  const readOnly = value.readOnly === true ? true : null
  if (!key || !label || !relativePath || !type || !group || !audience || readOnly === null) {
    return null
  }

  return {
    key,
    label,
    relativePath,
    type,
    group,
    audience,
    readOnly,
    metadata: parseConfigSourceMetadata(value.metadata),
    parseError: readString(value.parseError) ?? undefined,
  }
}

function parseConfigSourceDetail(value: unknown): ConfigSourceDetail | null {
  if (!isRecord(value)) {
    return null
  }

  const summary = parseConfigSourceSummary(value)
  if (!summary) {
    return null
  }

  const rawSource = readString(value.rawSource)
  if (rawSource === null) {
    return null
  }

  return {
    ...summary,
    rawSource,
    parsedPreview: value.parsedPreview,
  }
}

export function parseConfigSourceGroupsPayload(payload: unknown): ConfigSourceGroupSummary[] | null {
  if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.groups)) {
    return null
  }

  return payload.groups
    .map((group) => {
      if (!isRecord(group)) {
        return null
      }

      const key = group.key === 'prompt' || group.key === 'config' || group.key === 'project-notes' ? group.key : null
      const label = readString(group.label)
      const description = readString(group.description)
      const audience = group.audience === 'developer' || group.audience === 'admin' || group.audience === 'app' ? group.audience : null
      if (!key || !label || !description || !audience || !Array.isArray(group.sources)) {
        return null
      }

      const sources = group.sources
        .map((item) => parseConfigSourceSummary(item))
        .filter((item): item is ConfigSourceSummary => item !== null)

      return {
        key,
        label,
        description,
        audience,
        sources,
      }
    })
    .filter((group): group is ConfigSourceGroupSummary => group !== null)
}

export function parseConfigSourceDetailPayload(payload: unknown): ConfigSourceDetail | null {
  if (!isRecord(payload) || payload.success !== true) {
    return null
  }

  return parseConfigSourceDetail(payload.source)
}

export function createEmptyCustomKeywordForm(): CustomKeywordFormState {
  return {
    id: '',
    keyword: '',
    english: '',
    category: '',
  }
}

export function customKeywordToForm(tag: CustomKeywordTag): CustomKeywordFormState {
  return {
    id: tag.id,
    keyword: tag.keyword,
    english: tag.english ?? '',
    category: tag.category,
  }
}

export function useSettingsRequestJson(): {
  apiBaseUrl: string
  requestJson: (path: string, init?: RequestInit) => Promise<unknown>
} {
  const apiBaseUrl = useMemo(() => {
    const rawBaseUrl = import.meta.env.VITE_API_URL || '/api'
    return rawBaseUrl.replace(/\/api\/?$/, '')
  }, [])

  const requestJson = useCallback(async (path: string, init?: RequestInit): Promise<unknown> => {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: withWorkspaceHeaders({
        ...(init?.headers ?? {}),
        'Content-Type': 'application/json',
      }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return response.json() as Promise<unknown>
  }, [apiBaseUrl])

  return { apiBaseUrl, requestJson }
}
