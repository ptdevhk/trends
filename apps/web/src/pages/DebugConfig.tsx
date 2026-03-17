import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ConfigSourceMetadata,
  InspectableSourceDetail as ConfigSourceDetail,
  InspectableSourceGroupSummary as ConfigSourceGroupSummary,
  InspectableSourceSummary as ConfigSourceSummary,
} from '@trends/shared'
import { Activity, ArrowRight, Bot, Database, ShieldAlert, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { TaskMonitor } from '@/components/TaskMonitor'
import { SchedulerStatus } from '@/components/SchedulerStatus'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { withWorkspaceHeaders } from '@/lib/workspace-ref'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'

interface AIStatus {
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

interface AgentConfig {
  batchSize?: number
  parallelism?: number
  timeout?: number
  temperature?: number
  maxTokens?: number
  [key: string]: unknown
}

interface AgentItem {
  id: string
  name: string
  model: string
  config: AgentConfig
  isBonded?: boolean
  [key: string]: unknown
}

interface AgentDefaults {
  passThreshold?: number
  [key: string]: unknown
}

interface AgentsConfig {
  agents: {
    list: AgentItem[]
    defaults: Record<string, AgentDefaults>
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface CustomKeywordTag {
  id: string
  keyword: string
  english?: string
  category: string
}

interface CustomKeywordCategory {
  id: string
  name: string
  icon?: string
}

interface SystemLocationItem {
  id: string
  keyword: string
  level: 'province' | 'city'
  parentKeyword?: string
  visible: boolean
}

interface CustomKeywordFormState {
  id: string
  keyword: string
  english: string
  category: string
}

interface BrandKeywordItem {
  id: number
  nameCn: string
  nameEn?: string
  type: string
  origin: string
}

type AgentNumericField = 'batchSize' | 'parallelism' | 'timeout' | 'temperature'
type SettingsSectionId = 'operations' | 'runtime' | 'rules-data' | 'danger-zone'

interface SettingsOverviewMetric {
  label: string
  value: string
  detail: string
}

interface SettingsJumpItem {
  id: SettingsSectionId
  title: string
  description: string
  meta: string
  icon: LucideIcon
}

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

function parseOptionalNumberInput(value: string): { valid: boolean; value?: number } {
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

function parseAgentsConfigPayload(payload: unknown): AgentsConfig | null {
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

function parseAIStatusPayload(payload: unknown): AIStatus | null {
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
  const bonded = Array.isArray(payload.bonded) ? payload.bonded.filter((s): s is string => typeof s === 'string') : undefined

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

  const icon = readString(value.icon) ?? undefined

  return {
    id,
    name,
    icon,
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

  const parentKeyword = readString(value.parentKeyword) ?? undefined
  return {
    id,
    keyword,
    level,
    parentKeyword,
    visible,
  }
}

function parseCustomKeywordsPayload(
  payload: unknown
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
    version === undefined
    && updatedAt === undefined
    && description === undefined
    && locale === undefined
    && requestedLocale === undefined
    && resolvedSourceLocale === undefined
    && fallbackToZhHans === undefined
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

function parseConfigSourceGroupsPayload(payload: unknown): ConfigSourceGroupSummary[] | null {
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

function parseConfigSourceDetailPayload(payload: unknown): ConfigSourceDetail | null {
  if (!isRecord(payload) || payload.success !== true) {
    return null
  }

  return parseConfigSourceDetail(payload.source)
}

function createEmptyCustomKeywordForm(): CustomKeywordFormState {
  return {
    id: '',
    keyword: '',
    english: '',
    category: '',
  }
}

function customKeywordToForm(tag: CustomKeywordTag): CustomKeywordFormState {
  return {
    id: tag.id,
    keyword: tag.keyword,
    english: tag.english ?? '',
    category: tag.category,
  }
}

function SettingsOverviewCard({ label, value, detail }: SettingsOverviewMetric) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/80 p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </div>
  )
}

function SettingsSection({
  id,
  title,
  description,
  badge,
  children,
}: {
  id: SettingsSectionId
  title: string
  description: string
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
        {badge}
      </div>
      {children}
    </section>
  )
}

function SystemSummary() {
  const summary = useQuery(api.resume_tasks.getSummary)
  const { t } = useTranslation()

  if (!summary) return null

  return (
    <Card className="bg-muted/30 border-dashed">
      <CardHeader className="py-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              {t('debugConfig.systemDiagnostics')}
              <Badge variant="outline" className="font-mono text-[10px] bg-emerald-500/5 text-emerald-600 border-emerald-500/20">{t('debugConfig.live')}</Badge>
            </CardTitle>
            <CardDescription>
              {t('debugConfig.systemDiagnosticsDescription')}
            </CardDescription>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('debugConfig.activeWorkers')}</p>
            <p className="text-2xl font-bold text-primary">{summary.activeWorkers}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="space-y-1 border-l-2 border-primary/20 pl-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{t('debugConfig.total')}</p>
            <p className="text-xl font-bold">{summary.total}</p>
          </div>
          <div className="space-y-1 border-l-2 border-blue-500/20 pl-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{t('debugConfig.processing')}</p>
            <p className="text-xl font-bold text-blue-600">{summary.processing}</p>
          </div>
          <div className="space-y-1 border-l-2 border-amber-500/20 pl-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{t('debugConfig.pending')}</p>
            <p className="text-xl font-bold text-amber-600">{summary.pending}</p>
          </div>
          <div className="space-y-1 border-l-2 border-emerald-500/20 pl-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{t('debugConfig.done')}</p>
            <p className="text-xl font-bold text-emerald-600">{summary.completed}</p>
          </div>
          <div className="space-y-1 border-l-2 border-destructive/20 pl-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{t('debugConfig.failed')}</p>
            <p className="text-xl font-bold text-destructive">{summary.failed + summary.cancelled}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function DebugConfig() {
  const { t } = useTranslation()

  const apiBaseUrl = useMemo(() => {
    const rawBaseUrl = import.meta.env.VITE_API_URL || '/api'
    return rawBaseUrl.replace(/\/api\/?$/, '')
  }, [])

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null)
  const [agentsConfig, setAgentsConfig] = useState<AgentsConfig | null>(null)
  const [customKeywordTags, setCustomKeywordTags] = useState<CustomKeywordTag[]>([])
  const [customKeywordCategories, setCustomKeywordCategories] = useState<CustomKeywordCategory[]>([])
  const [systemLocationItems, setSystemLocationItems] = useState<SystemLocationItem[]>([])
  const [brandKeywords, setBrandKeywords] = useState<BrandKeywordItem[]>([])
  const [configSourceGroups, setConfigSourceGroups] = useState<ConfigSourceGroupSummary[]>([])
  const [selectedConfigSourceKey, setSelectedConfigSourceKey] = useState<string | null>(null)
  const [selectedConfigSourceDetail, setSelectedConfigSourceDetail] = useState<ConfigSourceDetail | null>(null)

  const [savingAgentId, setSavingAgentId] = useState<string | null>(null)
  const [savingCustomKeyword, setSavingCustomKeyword] = useState(false)
  const [savingSystemLocationId, setSavingSystemLocationId] = useState<string | null>(null)
  const [deletingCustomKeyword, setDeletingCustomKeyword] = useState(false)
  const [deleteCustomKeywordTargetId, setDeleteCustomKeywordTargetId] = useState<string | null>(null)
  const [resetDatabaseDialogOpen, setResetDatabaseDialogOpen] = useState(false)
  const [resettingDatabase, setResettingDatabase] = useState(false)

  const [customKeywordDialogOpen, setCustomKeywordDialogOpen] = useState(false)
  const [editingCustomKeywordId, setEditingCustomKeywordId] = useState<string | null>(null)
  const [customKeywordForm, setCustomKeywordForm] = useState<CustomKeywordFormState>(createEmptyCustomKeywordForm)
  const [systemLocationQuery, setSystemLocationQuery] = useState('')

  // Agent Collection State
  const [collectionKeyword, setCollectionKeyword] = useState('')
  const [collectionLocation, setCollectionLocation] = useState('广东')
  const [collectionLimit, setCollectionLimit] = useState('200')
  const [collectionMaxPages, setCollectionMaxPages] = useState('10')
  const dispatchCollection = useMutation(api.resume_tasks.dispatch)
  const resetDatabase = useMutation(api.resume_tasks.resetDatabase)

  const handleResetDatabase = useCallback(async () => {
    setResettingDatabase(true)
    try {
      await resetDatabase()
      setResetDatabaseDialogOpen(false)
      toast.success('Database has been reset')
    } catch (error) {
      console.error('Failed to reset database', error)
      toast.error('Failed to reset database')
    } finally {
      setResettingDatabase(false)
    }
  }, [resetDatabase])

  const requestJson = useCallback(
    async (path: string, init?: RequestInit): Promise<unknown> => {
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

      const payload: unknown = await response.json()
      return payload
    },
    [apiBaseUrl],
  )

  const loadAIStatus = useCallback(async () => {
    const payload = await requestJson('/api/config/ai-status')
    const parsed = parseAIStatusPayload(payload)
    if (!parsed) {
      throw new Error('Invalid AI status response')
    }
    setAiStatus(parsed)
  }, [requestJson])

  const loadAgentsConfig = useCallback(async () => {
    const payload = await requestJson('/api/config/agents')
    const parsed = parseAgentsConfigPayload(payload)
    if (!parsed) {
      throw new Error('Invalid agents config response')
    }
    setAgentsConfig(parsed)
  }, [requestJson])

  const loadCustomKeywords = useCallback(async () => {
    const payload = await requestJson('/api/config/custom-keywords')
    const parsed = parseCustomKeywordsPayload(payload)
    if (!parsed) {
      throw new Error('Invalid custom keywords response')
    }
    setCustomKeywordTags(parsed.tags)
    setCustomKeywordCategories(parsed.categories)
    setSystemLocationItems(parsed.systemLocations)
  }, [requestJson])

  const loadBrandKeywords = useCallback(async () => {
    const payload = await requestJson('/api/industry/brands')
    if (isRecord(payload) && payload.success === true && Array.isArray(payload.data)) {
      setBrandKeywords(payload.data as BrandKeywordItem[])
    }
  }, [requestJson])

  const loadConfigSourceDetail = useCallback(async (key: string) => {
    const payload = await requestJson(`/api/config/sources/${encodeURIComponent(key)}`)
    const parsed = parseConfigSourceDetailPayload(payload)
    if (!parsed) {
      throw new Error('Invalid config source detail response')
    }
    return parsed
  }, [requestJson])

  const loadConfigSourceGroups = useCallback(async () => {
    const payload = await requestJson('/api/config/source-groups')
    const parsed = parseConfigSourceGroupsPayload(payload)
    if (!parsed) {
      throw new Error('Invalid config source groups response')
    }

    setConfigSourceGroups(parsed)
    return parsed
  }, [requestJson])

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)

    try {
      await Promise.all([loadAIStatus(), loadAgentsConfig(), loadCustomKeywords(), loadBrandKeywords(), loadConfigSourceGroups()])
    } catch (error) {
      console.error('Failed to load configuration data', error)
      setLoadError(t('resumes.error'))
    } finally {
      setLoading(false)
    }
  }, [loadAIStatus, loadAgentsConfig, loadCustomKeywords, loadBrandKeywords, loadConfigSourceGroups, t])

  const handleRefreshData = useCallback(() => {
    loadData().catch((error) => {
      console.error('Unexpected loadData failure', error)
    })
  }, [loadData])

  useEffect(() => {
    handleRefreshData()
  }, [handleRefreshData])

  const configSources = useMemo(
    () => configSourceGroups.flatMap((group) => group.sources),
    [configSourceGroups],
  )

  useEffect(() => {
    const nextSelectedKey = configSources.some((source) => source.key === selectedConfigSourceKey)
      ? selectedConfigSourceKey
      : (configSources[0]?.key ?? null)

    if (nextSelectedKey !== selectedConfigSourceKey) {
      setSelectedConfigSourceKey(nextSelectedKey)
      return
    }

    if (!nextSelectedKey) {
      setSelectedConfigSourceDetail(null)
      return
    }

    let cancelled = false

    loadConfigSourceDetail(nextSelectedKey)
      .then((detail) => {
        if (!cancelled) {
          setSelectedConfigSourceDetail(detail)
        }
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        console.error('Failed to load config source detail', error)
        setSelectedConfigSourceDetail(null)
        toast.error(t('debugConfig.configSourcesLoadError'))
      })

    return () => {
      cancelled = true
    }
  }, [configSources, selectedConfigSourceKey, loadConfigSourceDetail, t])

  const visibleSystemLocationCount = useMemo(
    () => systemLocationItems.filter((item) => item.visible).length,
    [systemLocationItems]
  )
  const bondedAgentCount = useMemo(
    () => agentsConfig?.agents.list.filter((agent) => agent.isBonded).length ?? 0,
    [agentsConfig],
  )

  const filteredSystemLocationItems = useMemo(() => {
    const query = systemLocationQuery.trim().toLowerCase()
    return [...systemLocationItems]
      .filter((item) => {
        if (!query) {
          return true
        }
        const keyword = item.keyword.toLowerCase()
        const parent = item.parentKeyword?.toLowerCase() ?? ''
        const level = item.level.toLowerCase()
        return keyword.includes(query) || parent.includes(query) || level.includes(query)
      })
      .sort((left, right) => {
        if (left.visible !== right.visible) {
          return left.visible ? -1 : 1
        }
        if (left.level !== right.level) {
          return left.level === 'province' ? -1 : 1
        }
        return left.keyword.localeCompare(right.keyword, 'zh-Hans-CN')
      })
  }, [systemLocationItems, systemLocationQuery])

  const selectedConfigSourcePreview = useMemo(() => {
    if (!selectedConfigSourceDetail) {
      return ''
    }

    if (typeof selectedConfigSourceDetail.parsedPreview === 'string') {
      return selectedConfigSourceDetail.parsedPreview
    }

    return JSON.stringify(selectedConfigSourceDetail.parsedPreview, null, 2) ?? ''
  }, [selectedConfigSourceDetail])

  const handleSelectConfigSource = useCallback((key: string) => {
    setSelectedConfigSourceKey(key)
  }, [])

  const handleJumpToSection = useCallback((sectionId: SettingsSectionId) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const updateAgentTextField = useCallback((agentId: string, field: 'name' | 'model', value: string) => {
    setAgentsConfig((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        agents: {
          ...current.agents,
          list: current.agents.list.map((agent) => {
            if (agent.id !== agentId) {
              return agent
            }

            return {
              ...agent,
              [field]: value,
            }
          }),
        },
      }
    })
  }, [])

  const updateAgentNumericField = useCallback((agentId: string, field: AgentNumericField, rawValue: string) => {
    const parsedInput = parseOptionalNumberInput(rawValue)
    if (!parsedInput.valid) {
      return
    }

    setAgentsConfig((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        agents: {
          ...current.agents,
          list: current.agents.list.map((agent) => {
            if (agent.id !== agentId) {
              return agent
            }

            return {
              ...agent,
              config: {
                ...agent.config,
                [field]: parsedInput.value,
              },
            }
          }),
        },
      }
    })
  }, [])

  const updateAgentThreshold = useCallback((agentId: string, rawValue: string) => {
    const parsedInput = parseOptionalNumberInput(rawValue)
    if (!parsedInput.valid) {
      return
    }

    setAgentsConfig((current) => {
      if (!current) {
        return current
      }

      const currentDefaults = current.agents.defaults[agentId] ?? {}

      return {
        ...current,
        agents: {
          ...current.agents,
          defaults: {
            ...current.agents.defaults,
            [agentId]: {
              ...currentDefaults,
              passThreshold: parsedInput.value,
            },
          },
        },
      }
    })
  }, [])

  const handleSaveAgents = useCallback(
    async (agentId: string) => {
      if (!agentsConfig) {
        return
      }

      setSavingAgentId(agentId)

      try {
        const payload = await requestJson('/api/config/agents', {
          method: 'PUT',
          body: JSON.stringify(agentsConfig),
        })
        const parsed = parseAgentsConfigPayload(payload)
        if (!parsed) {
          throw new Error('Invalid agents save response')
        }

        setAgentsConfig(parsed)
        toast.success(t('debugConfig.saved'))
      } catch (error) {
        console.error('Failed to save agent config', error)
        toast.error(t('debugConfig.saveError'))
      } finally {
        setSavingAgentId(null)
      }
    },
    [agentsConfig, requestJson, t],
  )

  const openAddCustomKeywordDialog = useCallback(() => {
    setEditingCustomKeywordId(null)
    setCustomKeywordForm(createEmptyCustomKeywordForm())
    setCustomKeywordDialogOpen(true)
  }, [])

  const openEditCustomKeywordDialog = useCallback((tag: CustomKeywordTag) => {
    setEditingCustomKeywordId(tag.id)
    setCustomKeywordForm(customKeywordToForm(tag))
    setCustomKeywordDialogOpen(true)
  }, [])

  const buildCustomKeywordFromForm = useCallback((): CustomKeywordTag => {
    const id = customKeywordForm.id.trim()
    const keyword = customKeywordForm.keyword.trim()
    const english = customKeywordForm.english.trim()
    const category = customKeywordForm.category.trim()

    if (!id || !keyword || !category) {
      throw new Error('Missing required fields')
    }

    return {
      id,
      keyword,
      english: english || undefined,
      category,
    }
  }, [customKeywordForm])

  const handleSaveCustomKeyword = useCallback(async () => {
    setSavingCustomKeyword(true)

    try {
      const tag = buildCustomKeywordFromForm()

      if (editingCustomKeywordId) {
        await requestJson(`/api/config/custom-keywords/${encodeURIComponent(editingCustomKeywordId)}`, {
          method: 'PUT',
          body: JSON.stringify({
            keyword: tag.keyword,
            english: tag.english,
            category: tag.category,
          }),
        })
      } else {
        await requestJson('/api/config/custom-keywords', {
          method: 'POST',
          body: JSON.stringify(tag),
        })
      }

      await loadCustomKeywords()
      setCustomKeywordDialogOpen(false)
      toast.success(t('debugConfig.saved'))
    } catch (error) {
      console.error('Failed to save custom keyword', error)
      toast.error(t('debugConfig.saveError'))
    } finally {
      setSavingCustomKeyword(false)
    }
  }, [buildCustomKeywordFromForm, editingCustomKeywordId, loadCustomKeywords, requestJson, t])

  const handleDeleteCustomKeyword = useCallback(async () => {
    if (!deleteCustomKeywordTargetId) {
      return
    }

    setDeletingCustomKeyword(true)
    try {
      await requestJson(`/api/config/custom-keywords/${encodeURIComponent(deleteCustomKeywordTargetId)}`, {
        method: 'DELETE',
      })
      await loadCustomKeywords()
      setDeleteCustomKeywordTargetId(null)
      toast.success(t('debugConfig.saved'))
    } catch (error) {
      console.error('Failed to delete custom keyword', error)
      toast.error(t('debugConfig.saveError'))
    } finally {
      setDeletingCustomKeyword(false)
    }
  }, [deleteCustomKeywordTargetId, loadCustomKeywords, requestJson, t])

  const handleToggleSystemLocationVisibility = useCallback(async (item: SystemLocationItem) => {
    setSavingSystemLocationId(item.id)
    try {
      await requestJson(`/api/config/custom-keywords/system-locations/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ visible: !item.visible }),
      })
      setSystemLocationItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, visible: !item.visible }
            : entry
        )
      )
      toast.success(t('debugConfig.saved'))
    } catch (error) {
      console.error('Failed to toggle system location visibility', error)
      toast.error(t('debugConfig.saveError'))
    } finally {
      setSavingSystemLocationId(null)
    }
  }, [requestJson, t])

  const handleStartCollection = useCallback(async () => {
    if (!collectionKeyword.trim()) {
      toast.error('Please enter a keyword')
      return
    }

    try {
      const limit = parseInt(collectionLimit, 10) || 200
      const maxPages = parseInt(collectionMaxPages, 10) || 10

      await dispatchCollection({
        keyword: collectionKeyword.trim(),
        location: collectionLocation.trim(),
        limit,
        maxPages,
      })
      toast.success('Collection task dispatched')
      setCollectionKeyword('')
      // Keep location, limit, maxPages as they are for convenience
    } catch (error) {
      console.error('Failed to dispatch collection', error)
      toast.error('Failed to start collection')
    }
  }, [collectionKeyword, collectionLocation, collectionLimit, collectionMaxPages, dispatchCollection])

  const sectionJumpItems: SettingsJumpItem[] = [
    {
      id: 'operations',
      title: t('debugConfig.sectionOperationsTitle', { defaultValue: 'Operations' }),
      description: t('debugConfig.sectionOperationsDescription', {
        defaultValue: 'Live system health, scheduler status, and manual resume collection controls.',
      }),
      meta: t('debugConfig.sectionOperationsMeta', { defaultValue: '3 operational panels' }),
      icon: Activity,
    },
    {
      id: 'runtime',
      title: t('debugConfig.sectionRuntimeTitle', { defaultValue: 'AI and agents' }),
      description: t('debugConfig.sectionRuntimeDescription', {
        defaultValue: 'Model health and the configured screening pipeline.',
      }),
      meta: t('debugConfig.sectionRuntimeMeta', {
        defaultValue: '{{count}} configured agents',
        count: agentsConfig?.agents.list.length ?? 0,
      }),
      icon: Bot,
    },
    {
      id: 'rules-data',
      title: t('debugConfig.sectionRulesDataTitle', { defaultValue: 'Rules and data' }),
      description: t('debugConfig.sectionRulesDataDescription', {
        defaultValue: 'Inspectable sources, keyword rules, and location display controls.',
      }),
      meta: t('debugConfig.sectionRulesDataMeta', {
        defaultValue: '{{count}} inspectable sources',
        count: configSources.length,
      }),
      icon: Database,
    },
    {
      id: 'danger-zone',
      title: t('debugConfig.sectionDangerTitle', { defaultValue: 'Danger zone' }),
      description: t('debugConfig.sectionDangerDescription', {
        defaultValue: 'Destructive system-wide actions that require confirmation.',
      }),
      meta: t('debugConfig.sectionDangerMeta', { defaultValue: '1 irreversible action' }),
      icon: ShieldAlert,
    },
  ]

  const overviewMetrics: SettingsOverviewMetric[] = [
    {
      label: t('debugConfig.overviewAiLabel', { defaultValue: 'AI service' }),
      value: !aiStatus
        ? (loading ? t('trends.loading') : '-')
        : (aiStatus.enabled ? t('debugConfig.aiEnabled') : t('debugConfig.aiDisabled')),
      detail: aiStatus
        ? `${aiStatus.model} • ${aiStatus.valid ? t('debugConfig.aiValid') : t('debugConfig.aiInvalid')}`
        : t('debugConfig.overviewAiDetail', { defaultValue: 'Model availability and validation status.' }),
    },
    {
      label: t('debugConfig.overviewAgentsLabel', { defaultValue: 'Agent stages' }),
      value: String(agentsConfig?.agents.list.length ?? 0),
      detail: t('debugConfig.overviewAgentsDetail', {
        defaultValue: '{{count}} bonded to environment settings',
        count: bondedAgentCount,
      }),
    },
    {
      label: t('debugConfig.overviewKeywordsLabel', { defaultValue: 'Custom keywords' }),
      value: String(customKeywordTags.length),
      detail: t('debugConfig.overviewKeywordsDetail', {
        defaultValue: '{{count}} categories available for editing',
        count: customKeywordCategories.length,
      }),
    },
    {
      label: t('debugConfig.overviewLocationsLabel', { defaultValue: 'Visible locations' }),
      value: `${visibleSystemLocationCount}/${systemLocationItems.length}`,
      detail: t('debugConfig.overviewLocationsDetail', {
        defaultValue: 'Province and city chips shown in the UI.',
      }),
    },
    {
      label: t('debugConfig.overviewSourcesLabel', { defaultValue: 'Inspectable sources' }),
      value: String(configSources.length),
      detail: t('debugConfig.overviewSourcesDetail', {
        defaultValue: '{{count}} brand entries loaded from read-only data',
        count: brandKeywords.length,
      }),
    },
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title={t('debugConfig.title')}
        description={t('debugConfig.subtitle')}
        actions={(
          <Button
            variant="outline"
            onClick={handleRefreshData}
            disabled={loading}
          >
            {loading
              ? t('trends.loading')
              : t('common.refresh', { defaultValue: 'Refresh' })}
          </Button>
        )}
      />

      {loadError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      <Card className="overflow-hidden border-border/60 bg-gradient-to-br from-background via-background to-muted/30">
        <CardContent className="space-y-6 p-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)]">
            <div className="space-y-3">
              <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
                {t('debugConfig.settingsOverviewEyebrow', { defaultValue: 'System settings overview' })}
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  {t('debugConfig.settingsOverviewTitle', {
                    defaultValue: 'Organized around operations, runtime health, and editable rules.',
                  })}
                </h2>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  {t('debugConfig.settingsOverviewDescription', {
                    defaultValue: 'Use the grouped sections below to move quickly between live diagnostics, AI pipeline controls, and read-only source inspection.',
                  })}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{t('debugConfig.quickNavigationTitle', { defaultValue: 'Jump to section' })}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('debugConfig.quickNavigationDescription', {
                      defaultValue: 'Keep the page manageable by jumping straight to the area you need.',
                    })}
                  </p>
                </div>
                <Badge variant="secondary">{sectionJumpItems.length}</Badge>
              </div>
              <div className="space-y-2">
                {sectionJumpItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleJumpToSection(item.id)}
                    className={cn(
                      'group flex w-full items-start gap-3 rounded-xl border border-border/60 bg-background px-4 py-3 text-left transition-colors',
                      'hover:border-primary/40 hover:bg-primary/5'
                    )}
                  >
                    <div className="rounded-lg bg-primary/10 p-2 text-primary">
                      <item.icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">{item.title}</p>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </div>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{item.meta}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {overviewMetrics.map((item) => (
              <SettingsOverviewCard
                key={item.label}
                label={item.label}
                value={item.value}
                detail={item.detail}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <SettingsSection
        id="operations"
        title={t('debugConfig.operationsSectionTitle', { defaultValue: 'Operations' })}
        description={t('debugConfig.operationsSectionDescription', {
          defaultValue: 'Live diagnostics and manual job controls for collection and processing.',
        })}
        badge={<Badge variant="outline">{t('debugConfig.live', { defaultValue: 'Live' })}</Badge>}
      >
        <div className="grid gap-6 md:grid-cols-2">
          <SystemSummary />
          <SchedulerStatus apiBaseUrl={apiBaseUrl} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('debugConfig.resumeDataCollection')}</CardTitle>
            <CardDescription>
              {t('debugConfig.resumeDataCollectionDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="col-keyword" className="text-sm font-medium">{t('debugConfig.keyword')}</label>
                <Input
                  id="col-keyword"
                  placeholder={t('debugConfig.keywordPlaceholder')}
                  value={collectionKeyword}
                  onChange={(e) => setCollectionKeyword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="col-location" className="text-sm font-medium">{t('debugConfig.location')}</label>
                <Input
                  id="col-location"
                  placeholder={t('debugConfig.locationPlaceholder')}
                  value={collectionLocation}
                  onChange={(e) => setCollectionLocation(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="col-limit" className="text-sm font-medium">{t('debugConfig.limitResumes')}</label>
                <Input
                  id="col-limit"
                  type="number"
                  placeholder="200"
                  value={collectionLimit}
                  onChange={(e) => setCollectionLimit(e.target.value)}
                  onFocus={(e) => e.target.select()}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="col-max-pages" className="text-sm font-medium">{t('debugConfig.maxPages')}</label>
                <Input
                  id="col-max-pages"
                  type="number"
                  placeholder="10"
                  value={collectionMaxPages}
                  onChange={(e) => setCollectionMaxPages(e.target.value)}
                  onFocus={(e) => e.target.select()}
                />
              </div>
            </div>
            <Button onClick={handleStartCollection} className="w-full sm:w-auto">
              {t('debugConfig.startCollection')}
            </Button>

            <div className="mt-6">
              <TaskMonitor />
            </div>
          </CardContent>
        </Card>
      </SettingsSection>

      <SettingsSection
        id="runtime"
        title={t('debugConfig.runtimeSectionTitle', { defaultValue: 'AI and agents' })}
        description={t('debugConfig.runtimeSectionDescription', {
          defaultValue: 'Inspect AI connectivity and adjust the multi-stage screening pipeline.',
        })}
        badge={(
          <Badge variant="secondary">
            {t('debugConfig.runtimeSectionBadge', {
              defaultValue: '{{count}} agents',
              count: agentsConfig?.agents.list.length ?? 0,
            })}
          </Badge>
        )}
      >
        <div className="grid gap-6 2xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>{t('debugConfig.aiStatus')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!aiStatus ? (
                <p className="text-sm text-muted-foreground">{loading ? t('trends.loading') : '-'}</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={aiStatus.enabled ? 'default' : 'secondary'}>
                      {aiStatus.enabled ? t('debugConfig.aiEnabled') : t('debugConfig.aiDisabled')}
                    </Badge>
                    {aiStatus.bonded?.includes('AI_ANALYSIS_ENABLED') && (
                      <Badge variant="outline" className="border-emerald-500/50 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400">
                        Bound to environment
                      </Badge>
                    )}
                    <Badge variant={aiStatus.valid ? 'default' : 'destructive'}>
                      {aiStatus.valid ? t('debugConfig.aiValid') : t('debugConfig.aiInvalid')}
                    </Badge>
                  </div>

                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-muted-foreground">{t('debugConfig.aiModel')}</p>
                        {aiStatus.bonded?.includes('AI_MODEL') && (
                          <Badge variant="outline" className="h-4 px-1 text-[10px] border-emerald-500/50 text-emerald-600">Bonded</Badge>
                        )}
                      </div>
                      <p className="font-medium">{aiStatus.model}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('debugConfig.aiApiBase')}</p>
                      <p className="font-medium">{aiStatus.apiBase ?? '-'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('debugConfig.aiTemperature')}</p>
                      <p className="font-medium">{aiStatus.temperature}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('debugConfig.aiMaxTokens')}</p>
                      <p className="font-medium">{aiStatus.maxTokens}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('debugConfig.aiTimeout')}</p>
                      <p className="font-medium">{aiStatus.timeout}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">API Key</p>
                      <p className="font-medium">{aiStatus.apiKeyMasked}</p>
                    </div>
                  </div>

                  {aiStatus.validationError && (
                    <p className="rounded border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
                      {aiStatus.validationError}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('debugConfig.agents')}</CardTitle>
              <CardDescription>{t('debugConfig.agentsDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!agentsConfig ? (
                <p className="text-sm text-muted-foreground">{loading ? t('trends.loading') : '-'}</p>
              ) : agentsConfig.agents.list.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('debug.none')}</p>
              ) : (
                agentsConfig.agents.list.map((agent) => {
                  const defaults = agentsConfig.agents.defaults[agent.id] ?? {}
                  const isSaving = savingAgentId === agent.id

                  return (
                    <div key={agent.id} className="space-y-3 rounded-md border p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="space-y-1">
                          <h3 className="text-sm font-semibold">{agent.id}</h3>
                          <p className="text-xs text-muted-foreground">{agent.name}</p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => {
                            handleSaveAgents(agent.id).catch((error) => {
                              console.error('Unexpected handleSaveAgents failure', error)
                            })
                          }}
                          disabled={isSaving}
                        >
                          {isSaving ? `${t('debugConfig.save')}...` : t('debugConfig.save')}
                        </Button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Name</p>
                          <Input
                            value={agent.name}
                            onChange={(event) => {
                              updateAgentTextField(agent.id, 'name', event.target.value)
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="text-xs text-muted-foreground">{t('debugConfig.agentModel')}</p>
                            {agent.isBonded && (
                              <Badge variant="outline" className="h-3.5 px-1 text-[9px] border-emerald-500/50 text-emerald-600">Bonded</Badge>
                            )}
                          </div>
                          <Input
                            value={agent.model}
                            disabled={agent.isBonded}
                            onChange={(event) => {
                              updateAgentTextField(agent.id, 'model', event.target.value)
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">{t('debugConfig.agentBatchSize')}</p>
                          <Input
                            type="number"
                            value={agent.config.batchSize ?? ''}
                            onChange={(event) => {
                              updateAgentNumericField(agent.id, 'batchSize', event.target.value)
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">{t('debugConfig.agentParallelism')}</p>
                          <Input
                            type="number"
                            value={agent.config.parallelism ?? ''}
                            onChange={(event) => {
                              updateAgentNumericField(agent.id, 'parallelism', event.target.value)
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">{t('debugConfig.agentTimeout')}</p>
                          <Input
                            type="number"
                            value={agent.config.timeout ?? ''}
                            onChange={(event) => {
                              updateAgentNumericField(agent.id, 'timeout', event.target.value)
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">{t('debugConfig.aiTemperature')}</p>
                          <Input
                            type="number"
                            step="0.1"
                            value={agent.config.temperature ?? ''}
                            onChange={(event) => {
                              updateAgentNumericField(agent.id, 'temperature', event.target.value)
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">{t('debugConfig.agentThreshold')}</p>
                          <Input
                            type="number"
                            value={defaults.passThreshold ?? ''}
                            onChange={(event) => {
                              updateAgentThreshold(agent.id, event.target.value)
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>
      </SettingsSection>

      <SettingsSection
        id="rules-data"
        title={t('debugConfig.rulesDataSectionTitle', { defaultValue: 'Rules and data' })}
        description={t('debugConfig.rulesDataSectionDescription', {
          defaultValue: 'Editable keyword surfaces and read-only source inspection in one place.',
        })}
        badge={(
          <Badge variant="secondary">
            {t('debugConfig.rulesDataSectionBadge', {
              defaultValue: '{{count}} sources',
              count: configSources.length,
            })}
          </Badge>
        )}
      >
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>{t('debugConfig.configSources')}</CardTitle>
                <CardDescription>{t('debugConfig.configSourcesDescription')}</CardDescription>
              </div>
              <Badge variant="secondary">{configSources.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <div className="space-y-4">
                {configSourceGroups.length === 0 ? (
                  <div className="rounded-md border p-6 text-center text-muted-foreground">
                    {loading ? t('trends.loading') : t('debug.none')}
                  </div>
                ) : (
                  configSourceGroups.map((group) => (
                    <div key={group.key} className="rounded-md border">
                      <div className="border-b bg-muted/20 px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="space-y-1">
                            <h3 className="text-sm font-semibold">{group.label}</h3>
                            <p className="text-xs text-muted-foreground">{group.description}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="font-normal">{group.audience}</Badge>
                            <Badge variant="secondary">{group.sources.length}</Badge>
                          </div>
                        </div>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('debugConfig.configSourceLabel')}</TableHead>
                            <TableHead>{t('debugConfig.configSourceType')}</TableHead>
                            <TableHead>{t('debugConfig.configSourcePath')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.sources.map((source) => (
                            <TableRow
                              key={source.key}
                              className={selectedConfigSourceKey === source.key ? 'bg-muted/50' : undefined}
                            >
                              <TableCell>
                                <button
                                  type="button"
                                  className="space-y-1 text-left"
                                  onClick={() => {
                                    handleSelectConfigSource(source.key)
                                  }}
                                >
                                  <div className="font-medium">{source.label}</div>
                                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                    <Badge variant="outline" className="font-normal">{t('debugConfig.readOnly')}</Badge>
                                    {source.metadata?.locale && (
                                      <Badge variant="secondary" className="font-normal">{source.metadata.locale}</Badge>
                                    )}
                                    {source.metadata?.version !== undefined && (
                                      <span>{t('debugConfig.configSourceVersion', { version: source.metadata.version })}</span>
                                    )}
                                  </div>
                                  {source.parseError && (
                                    <p className="text-xs text-destructive">{source.parseError}</p>
                                  )}
                                </button>
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary">{source.type}</Badge>
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">{source.relativePath}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-4">
                {!selectedConfigSourceDetail ? (
                  <div className="rounded-md border p-6 text-sm text-muted-foreground">
                    {loading ? t('trends.loading') : t('debug.none')}
                  </div>
                ) : (
                  <>
                    <div className="rounded-md border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <h3 className="text-sm font-semibold">{selectedConfigSourceDetail.label}</h3>
                          <p className="font-mono text-xs text-muted-foreground">{selectedConfigSourceDetail.relativePath}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">{t('debugConfig.readOnly')}</Badge>
                          <Badge variant="secondary">{selectedConfigSourceDetail.type}</Badge>
                          <Badge variant="outline">{selectedConfigSourceDetail.group}</Badge>
                          <Badge variant="outline">{selectedConfigSourceDetail.audience}</Badge>
                          {selectedConfigSourceDetail.metadata?.locale && (
                            <Badge variant="secondary">{selectedConfigSourceDetail.metadata.locale}</Badge>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <p className="text-muted-foreground">{t('debugConfig.configSourcePath')}</p>
                          <p className="font-mono text-xs">{selectedConfigSourceDetail.relativePath}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t('debugConfig.configSourceType')}</p>
                          <p className="font-medium">{selectedConfigSourceDetail.type}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Group</p>
                          <p className="font-medium">{selectedConfigSourceDetail.group}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Audience</p>
                          <p className="font-medium">{selectedConfigSourceDetail.audience}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t('debugConfig.configSourceVersionLabel')}</p>
                          <p className="font-medium">{selectedConfigSourceDetail.metadata?.version ?? '-'}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t('debugConfig.configSourceUpdatedAt')}</p>
                          <p className="font-medium">{selectedConfigSourceDetail.metadata?.updatedAt ?? '-'}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t('debugConfig.configSourceRequestedLocale')}</p>
                          <p className="font-medium">{selectedConfigSourceDetail.metadata?.requestedLocale ?? '-'}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t('debugConfig.configSourceResolvedLocale')}</p>
                          <p className="font-medium">{selectedConfigSourceDetail.metadata?.resolvedSourceLocale ?? '-'}</p>
                        </div>
                      </div>

                      {selectedConfigSourceDetail.metadata?.description && (
                        <div className="mt-4 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                          {selectedConfigSourceDetail.metadata.description}
                        </div>
                      )}

                      {selectedConfigSourceDetail.metadata?.fallbackToZhHans !== undefined && (
                        <div className="mt-3">
                          <Badge variant={selectedConfigSourceDetail.metadata.fallbackToZhHans ? 'secondary' : 'outline'}>
                            {selectedConfigSourceDetail.metadata.fallbackToZhHans
                              ? t('debugConfig.configSourceFallbackEnabled')
                              : t('debugConfig.configSourceFallbackDisabled')}
                          </Badge>
                        </div>
                      )}

                      {selectedConfigSourceDetail.parseError && (
                        <p className="mt-4 rounded border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
                          {selectedConfigSourceDetail.parseError}
                        </p>
                      )}
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-sm font-medium">{t('debugConfig.configSourceRaw')}</p>
                        <pre className="max-h-[480px] overflow-auto rounded-md border bg-muted/30 p-4 text-xs leading-5">
                          <code>{selectedConfigSourceDetail.rawSource}</code>
                        </pre>
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm font-medium">{t('debugConfig.configSourceParsedPreview')}</p>
                        <pre className="max-h-[480px] overflow-auto rounded-md border bg-muted/30 p-4 text-xs leading-5">
                          <code>{selectedConfigSourcePreview}</code>
                        </pre>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>{t('debugConfig.customKeywords')}</CardTitle>
                  <CardDescription>{t('debugConfig.customKeywordsDescription')}</CardDescription>
                </div>
                <Button size="sm" onClick={openAddCustomKeywordDialog}>
                  {t('debugConfig.addCustomKeyword')}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('debugConfig.customKeywordId')}</TableHead>
                      <TableHead>{t('debugConfig.customKeywordKeyword')}</TableHead>
                      <TableHead>{t('debugConfig.customKeywordEnglish')}</TableHead>
                      <TableHead>{t('debugConfig.customKeywordCategory')}</TableHead>
                      <TableHead className="text-right">{t('resumes.actions.view')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customKeywordTags.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                          {loading ? t('trends.loading') : t('debug.none')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      customKeywordTags.map((tag) => (
                        <TableRow key={tag.id}>
                          <TableCell className="font-mono text-xs">{tag.id}</TableCell>
                          <TableCell>{tag.keyword}</TableCell>
                          <TableCell>{tag.english || '-'}</TableCell>
                          <TableCell>{tag.category}</TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  openEditCustomKeywordDialog(tag)
                                }}
                              >
                                {t('debugConfig.editCustomKeyword')}
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => {
                                  setDeleteCustomKeywordTargetId(tag.id)
                                }}
                              >
                                {t('debugConfig.deleteCustomKeyword')}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="h-full">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>{t('debugConfig.brandKeywords', '品牌關鍵詞')}</CardTitle>
                  <CardDescription>{t('debugConfig.brandKeywordsDescription', '從 skills.md 自動生成的設備品牌（唯讀）')}</CardDescription>
                </div>
                <Badge variant="secondary">{brandKeywords.length}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('debugConfig.brandKeywordNameCn', '中文名')}</TableHead>
                      <TableHead>{t('debugConfig.brandKeywordNameEn', 'English')}</TableHead>
                      <TableHead>{t('debugConfig.brandKeywordType', '类型')}</TableHead>
                      <TableHead>{t('debugConfig.brandKeywordOrigin', '来源')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {brandKeywords.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                          {loading ? t('trends.loading') : t('debug.none')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      brandKeywords.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.nameCn}</TableCell>
                          <TableCell className="text-muted-foreground">{item.nameEn || '-'}</TableCell>
                          <TableCell className="text-xs">{item.type}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{item.origin}</Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>{t('debugConfig.systemLocationConfigTitle', { defaultValue: '系统地区配置' })}</CardTitle>
                <CardDescription>
                  {t('debugConfig.systemLocationConfigDescription', {
                    defaultValue: '来源于 Job5156 地区数据，可配置展开标签显示或隐藏',
                  })}
                </CardDescription>
              </div>
              <Badge variant="secondary">{visibleSystemLocationCount}/{systemLocationItems.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={systemLocationQuery}
              onChange={(event) => setSystemLocationQuery(event.target.value)}
              placeholder={t('debugConfig.systemLocationSearchPlaceholder', {
                defaultValue: '搜索地区（名称/上级/层级）',
              })}
            />
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('debugConfig.systemLocationKeyword', { defaultValue: '地区' })}</TableHead>
                    <TableHead>{t('debugConfig.systemLocationLevel', { defaultValue: '层级' })}</TableHead>
                    <TableHead>{t('debugConfig.systemLocationParent', { defaultValue: '上级' })}</TableHead>
                    <TableHead>{t('debugConfig.systemLocationVisible', { defaultValue: '状态' })}</TableHead>
                    <TableHead className="text-right">{t('resumes.actions.view')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSystemLocationItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                        {loading ? t('trends.loading') : t('debug.none')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredSystemLocationItems.map((item) => {
                      const isSaving = savingSystemLocationId === item.id
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.keyword}</TableCell>
                          <TableCell>{item.level === 'province' ? '省级' : '城市'}</TableCell>
                          <TableCell>{item.parentKeyword || '-'}</TableCell>
                          <TableCell>
                            <Badge variant={item.visible ? 'default' : 'secondary'}>
                              {item.visible ? 'show' : 'hidden'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end">
                              <Button
                                variant={item.visible ? 'outline' : 'default'}
                                size="sm"
                                disabled={isSaving}
                                onClick={() => {
                                  handleToggleSystemLocationVisibility(item).catch((error) => {
                                    console.error('Unexpected handleToggleSystemLocationVisibility failure', error)
                                  })
                                }}
                              >
                                {isSaving
                                  ? `${t('debugConfig.save')}...`
                                  : (item.visible ? 'hidden' : 'show')}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </SettingsSection>

      <Dialog open={customKeywordDialogOpen} onOpenChange={setCustomKeywordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCustomKeywordId ? t('debugConfig.editCustomKeyword') : t('debugConfig.addCustomKeyword')}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.customKeywordId')}</p>
              <Input
                value={customKeywordForm.id}
                onChange={(event) => {
                  setCustomKeywordForm((current) => ({ ...current, id: event.target.value }))
                }}
                disabled={Boolean(editingCustomKeywordId)}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.customKeywordKeyword')}</p>
              <Input
                value={customKeywordForm.keyword}
                onChange={(event) => {
                  setCustomKeywordForm((current) => ({ ...current, keyword: event.target.value }))
                }}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.customKeywordEnglish')}</p>
              <Input
                value={customKeywordForm.english}
                onChange={(event) => {
                  setCustomKeywordForm((current) => ({ ...current, english: event.target.value }))
                }}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.customKeywordCategory')}</p>
              <Input
                value={customKeywordForm.category}
                list="custom-keyword-category-options"
                onChange={(event) => {
                  setCustomKeywordForm((current) => ({ ...current, category: event.target.value }))
                }}
              />
              <datalist id="custom-keyword-category-options">
                {customKeywordCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </datalist>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCustomKeywordDialogOpen(false)
              }}
              disabled={savingCustomKeyword}
            >
              {t('jdManagement.cancel')}
            </Button>
            <Button
              onClick={() => {
                handleSaveCustomKeyword().catch((error) => {
                  console.error('Unexpected handleSaveCustomKeyword failure', error)
                })
              }}
              disabled={savingCustomKeyword}
            >
              {savingCustomKeyword ? `${t('debugConfig.save')}...` : t('debugConfig.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteCustomKeywordTargetId !== null}
        onOpenChange={(open) => {
          if (!open && !deletingCustomKeyword) {
            setDeleteCustomKeywordTargetId(null)
          }
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event) => {
            if (deletingCustomKeyword) {
              event.preventDefault()
            }
          }}
          onPointerDownOutside={(event) => {
            if (deletingCustomKeyword) {
              event.preventDefault()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('debugConfig.deleteCustomKeyword')}</DialogTitle>
            <DialogDescription>{t('debugConfig.confirmDelete')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteCustomKeywordTargetId(null)}
              disabled={deletingCustomKeyword}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                handleDeleteCustomKeyword().catch((error) => {
                  console.error('Unexpected handleDeleteCustomKeyword failure', error)
                })
              }}
              disabled={deletingCustomKeyword}
            >
              {t('debugConfig.deleteCustomKeyword')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SettingsSection
        id="danger-zone"
        title={t('debugConfig.dangerZone')}
        description={t('debugConfig.dangerZoneDescription')}
        badge={<Badge variant="destructive">{t('debugConfig.resetDatabase')}</Badge>}
      >
        <Card className="border-destructive/50">
          <CardContent className="p-6">
            <div className="flex flex-col gap-4 rounded-lg border border-destructive/20 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="font-medium text-destructive">{t('debugConfig.resetDatabase')}</p>
                <p className="text-sm text-destructive/80">
                  {t('debugConfig.resetDatabaseDescription')}
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={() => {
                  setResetDatabaseDialogOpen(true)
                }}
                disabled={resettingDatabase}
              >
                {t('debugConfig.resetDatabase')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </SettingsSection>

      <Dialog
        open={resetDatabaseDialogOpen}
        onOpenChange={(open) => {
          if (!resettingDatabase) {
            setResetDatabaseDialogOpen(open)
          }
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event) => {
            if (resettingDatabase) {
              event.preventDefault()
            }
          }}
          onPointerDownOutside={(event) => {
            if (resettingDatabase) {
              event.preventDefault()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('debugConfig.resetDatabase')}</DialogTitle>
            <DialogDescription>{t('debugConfig.resetDatabaseConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetDatabaseDialogOpen(false)}
              disabled={resettingDatabase}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                handleResetDatabase().catch((error) => {
                  console.error('Unexpected handleResetDatabase failure', error)
                })
              }}
              disabled={resettingDatabase}
            >
              {t('debugConfig.resetDatabase')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
