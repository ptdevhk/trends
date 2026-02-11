import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { TaskMonitor } from '@/components/TaskMonitor'
import { SchedulerStatus } from '@/components/SchedulerStatus'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

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

interface FilterPreset {
  id: string
  name: string
  category: string
  filters: {
    minExperience?: number
    maxExperience?: number | null
    education?: string[]
    salaryRange?: {
      min?: number
      max?: number
    }
  }
}

interface PresetCategory {
  id: string
  name: string
  icon?: string
}

interface PresetFormState {
  id: string
  name: string
  category: string
  minExperience: string
  maxExperience: string
  education: string
  salaryMin: string
  salaryMax: string
}

type ToastState = {
  type: 'success' | 'error'
  message: string
}

type AgentNumericField = 'batchSize' | 'parallelism' | 'timeout' | 'temperature'

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

function parseFilterPreset(value: unknown): FilterPreset | null {
  if (!isRecord(value)) {
    return null
  }

  const id = readString(value.id)
  const name = readString(value.name)
  const category = readString(value.category)
  if (!id || !name || !category) {
    return null
  }

  const rawFilters = isRecord(value.filters) ? value.filters : {}
  const rawSalary = isRecord(rawFilters.salaryRange) ? rawFilters.salaryRange : null

  const filters: FilterPreset['filters'] = {
    minExperience: readOptionalNumber(rawFilters.minExperience),
    maxExperience:
      rawFilters.maxExperience === null
        ? null
        : readOptionalNumber(rawFilters.maxExperience),
  }

  if (Array.isArray(rawFilters.education)) {
    const education = rawFilters.education.filter((item): item is string => typeof item === 'string')
    if (education.length > 0) {
      filters.education = education
    }
  }

  if (rawSalary) {
    const salaryMin = readOptionalNumber(rawSalary.min)
    const salaryMax = readOptionalNumber(rawSalary.max)
    if (salaryMin !== undefined || salaryMax !== undefined) {
      filters.salaryRange = {
        ...(salaryMin !== undefined ? { min: salaryMin } : {}),
        ...(salaryMax !== undefined ? { max: salaryMax } : {}),
      }
    }
  }

  return {
    id,
    name,
    category,
    filters,
  }
}

function parsePresetCategory(value: unknown): PresetCategory | null {
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

function parseFilterPresetsPayload(payload: unknown): { presets: FilterPreset[]; categories: PresetCategory[] } | null {
  if (!isRecord(payload) || payload.success !== true) {
    return null
  }

  if (!Array.isArray(payload.presets) || !Array.isArray(payload.categories)) {
    return null
  }

  const presets = payload.presets
    .map((item) => parseFilterPreset(item))
    .filter((item): item is FilterPreset => item !== null)

  const categories = payload.categories
    .map((item) => parsePresetCategory(item))
    .filter((item): item is PresetCategory => item !== null)

  return { presets, categories }
}

function createEmptyPresetForm(): PresetFormState {
  return {
    id: '',
    name: '',
    category: '',
    minExperience: '',
    maxExperience: '',
    education: '',
    salaryMin: '',
    salaryMax: '',
  }
}

function presetToForm(preset: FilterPreset): PresetFormState {
  return {
    id: preset.id,
    name: preset.name,
    category: preset.category,
    minExperience: preset.filters.minExperience !== undefined ? String(preset.filters.minExperience) : '',
    maxExperience:
      preset.filters.maxExperience === null
        ? ''
        : preset.filters.maxExperience !== undefined
          ? String(preset.filters.maxExperience)
          : '',
    education: preset.filters.education?.join(', ') ?? '',
    salaryMin: preset.filters.salaryRange?.min !== undefined ? String(preset.filters.salaryRange.min) : '',
    salaryMax: preset.filters.salaryRange?.max !== undefined ? String(preset.filters.salaryRange.max) : '',
  }
}

function formatSalaryRange(preset: FilterPreset): string {
  const min = preset.filters.salaryRange?.min
  const max = preset.filters.salaryRange?.max
  if (min === undefined && max === undefined) {
    return '-'
  }
  return `${min ?? '-'} - ${max ?? '-'}`
}

function formatEducation(preset: FilterPreset): string {
  const education = preset.filters.education
  if (!education || education.length === 0) {
    return '-'
  }
  return education.join(', ')
}

function formatMaxExperience(value: number | null | undefined): string {
  if (value === null) {
    return '∞'
  }
  if (value === undefined) {
    return '-'
  }
  return String(value)
}

function parseFormNumberField(value: string, fieldLabel: string): number | undefined {
  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldLabel}: invalid number`)
  }

  return parsed
}

function parseFormNullableNumberField(value: string, fieldLabel: string): number | null {
  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldLabel}: invalid number`)
  }

  return parsed
}

function SystemSummary() {
  const summary = useQuery(api.resume_tasks.getSummary)

  if (!summary) return null

  return (
    <Card className="bg-muted/30 border-dashed">
      <CardHeader className="py-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              System Diagnostics
              <Badge variant="outline" className="font-mono text-[10px] bg-emerald-500/5 text-emerald-600 border-emerald-500/20">Live</Badge>
            </CardTitle>
            <CardDescription>
              Backend task heartbeat and worker synchronization.
            </CardDescription>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Active Workers</p>
            <p className="text-2xl font-bold text-primary">{summary.activeWorkers}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="space-y-1 border-l-2 border-primary/20 pl-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Total</p>
            <p className="text-xl font-bold">{summary.total}</p>
          </div>
          <div className="space-y-1 border-l-2 border-blue-500/20 pl-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Processing</p>
            <p className="text-xl font-bold text-blue-600">{summary.processing}</p>
          </div>
          <div className="space-y-1 border-l-2 border-amber-500/20 pl-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Pending</p>
            <p className="text-xl font-bold text-amber-600">{summary.pending}</p>
          </div>
          <div className="space-y-1 border-l-2 border-emerald-500/20 pl-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Done</p>
            <p className="text-xl font-bold text-emerald-600">{summary.completed}</p>
          </div>
          <div className="space-y-1 border-l-2 border-destructive/20 pl-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Failed</p>
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
    const rawBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
    return rawBaseUrl.replace(/\/api\/?$/, '')
  }, [])

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null)
  const [agentsConfig, setAgentsConfig] = useState<AgentsConfig | null>(null)
  const [filterPresets, setFilterPresets] = useState<FilterPreset[]>([])
  const [presetCategories, setPresetCategories] = useState<PresetCategory[]>([])

  const [savingAgentId, setSavingAgentId] = useState<string | null>(null)
  const [savingPreset, setSavingPreset] = useState(false)

  const [presetDialogOpen, setPresetDialogOpen] = useState(false)
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
  const [presetForm, setPresetForm] = useState<PresetFormState>(createEmptyPresetForm)

  const [toast, setToast] = useState<ToastState | null>(null)

  // Agent Collection State
  const [collectionKeyword, setCollectionKeyword] = useState('')
  const [collectionLocation, setCollectionLocation] = useState('广东')
  const [collectionLimit, setCollectionLimit] = useState('200')
  const [collectionMaxPages, setCollectionMaxPages] = useState('10')
  const dispatchCollection = useMutation(api.resume_tasks.dispatch)
  const resetDatabase = useMutation(api.resume_tasks.resetDatabase)

  useEffect(() => {
    if (!toast) {
      return undefined
    }

    const timer = window.setTimeout(() => {
      setToast(null)
    }, 2500)

    return () => {
      window.clearTimeout(timer)
    }
  }, [toast])

  const showToast = useCallback((nextToast: ToastState) => {
    setToast(nextToast)
  }, [])

  const handleResetDatabase = useCallback(async () => {
    try {
      await resetDatabase()
      showToast({ type: 'success', message: 'Database has been reset' })
    } catch (error) {
      console.error('Failed to reset database', error)
      showToast({ type: 'error', message: 'Failed to reset database' })
    }
  }, [resetDatabase, showToast])

  const requestJson = useCallback(
    async (path: string, init?: RequestInit): Promise<unknown> => {
      const response = await fetch(`${apiBaseUrl}${path}`, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          'Content-Type': 'application/json',
        },
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

  const loadFilterPresets = useCallback(async () => {
    const payload = await requestJson('/api/config/filter-presets')
    const parsed = parseFilterPresetsPayload(payload)
    if (!parsed) {
      throw new Error('Invalid filter presets response')
    }
    setFilterPresets(parsed.presets)
    setPresetCategories(parsed.categories)
  }, [requestJson])

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)

    try {
      await Promise.all([loadAIStatus(), loadAgentsConfig(), loadFilterPresets()])
    } catch (error) {
      console.error('Failed to load configuration data', error)
      setLoadError(t('resumes.error'))
    } finally {
      setLoading(false)
    }
  }, [loadAIStatus, loadAgentsConfig, loadFilterPresets, t])

  useEffect(() => {
    loadData().catch((error) => {
      console.error('Unexpected loadData failure', error)
    })
  }, [loadData])

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
        showToast({ type: 'success', message: t('debugConfig.saved') })
      } catch (error) {
        console.error('Failed to save agent config', error)
        showToast({ type: 'error', message: t('debugConfig.saveError') })
      } finally {
        setSavingAgentId(null)
      }
    },
    [agentsConfig, requestJson, showToast, t],
  )

  const openAddPresetDialog = useCallback(() => {
    setEditingPresetId(null)
    setPresetForm(createEmptyPresetForm())
    setPresetDialogOpen(true)
  }, [])

  const openEditPresetDialog = useCallback((preset: FilterPreset) => {
    setEditingPresetId(preset.id)
    setPresetForm(presetToForm(preset))
    setPresetDialogOpen(true)
  }, [])

  const buildPresetFromForm = useCallback((): FilterPreset => {
    const id = presetForm.id.trim()
    const name = presetForm.name.trim()
    const category = presetForm.category.trim()

    if (!id || !name || !category) {
      throw new Error('Missing required fields')
    }

    const minExperience = parseFormNumberField(presetForm.minExperience, t('debugConfig.presetMinExp'))
    const maxExperience = parseFormNullableNumberField(presetForm.maxExperience, t('debugConfig.presetMaxExp'))

    const salaryMin = parseFormNumberField(presetForm.salaryMin, t('debugConfig.presetSalary'))
    const salaryMax = parseFormNumberField(presetForm.salaryMax, t('debugConfig.presetSalary'))

    const education = presetForm.education
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)

    const filters: FilterPreset['filters'] = {
      maxExperience,
    }

    if (minExperience !== undefined) {
      filters.minExperience = minExperience
    }

    if (education.length > 0) {
      filters.education = education
    }

    if (salaryMin !== undefined || salaryMax !== undefined) {
      filters.salaryRange = {
        ...(salaryMin !== undefined ? { min: salaryMin } : {}),
        ...(salaryMax !== undefined ? { max: salaryMax } : {}),
      }
    }

    return {
      id,
      name,
      category,
      filters,
    }
  }, [presetForm, t])

  const handleSavePreset = useCallback(async () => {
    setSavingPreset(true)

    try {
      const preset = buildPresetFromForm()

      if (editingPresetId) {
        await requestJson(`/api/config/filter-presets/${encodeURIComponent(editingPresetId)}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: preset.name,
            category: preset.category,
            filters: preset.filters,
          }),
        })
      } else {
        await requestJson('/api/config/filter-presets', {
          method: 'POST',
          body: JSON.stringify(preset),
        })
      }

      await loadFilterPresets()
      setPresetDialogOpen(false)
      showToast({ type: 'success', message: t('debugConfig.saved') })
    } catch (error) {
      console.error('Failed to save filter preset', error)
      showToast({ type: 'error', message: t('debugConfig.saveError') })
    } finally {
      setSavingPreset(false)
    }
  }, [buildPresetFromForm, editingPresetId, loadFilterPresets, requestJson, showToast, t])

  const handleDeletePreset = useCallback(
    async (presetId: string) => {
      const confirmed = window.confirm(t('debugConfig.confirmDelete'))
      if (!confirmed) {
        return
      }

      try {
        await requestJson(`/api/config/filter-presets/${encodeURIComponent(presetId)}`, {
          method: 'DELETE',
        })
        await loadFilterPresets()
        showToast({ type: 'success', message: t('debugConfig.saved') })
      } catch (error) {
        console.error('Failed to delete filter preset', error)
        showToast({ type: 'error', message: t('debugConfig.saveError') })
      }
    },
    [loadFilterPresets, requestJson, showToast, t],
  )

  const handleStartCollection = useCallback(async () => {
    if (!collectionKeyword.trim()) {
      showToast({ type: 'error', message: 'Please enter a keyword' })
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
      showToast({ type: 'success', message: 'Collection task dispatched' })
      setCollectionKeyword('')
      // Keep location, limit, maxPages as they are for convenience
    } catch (error) {
      console.error('Failed to dispatch collection', error)
      showToast({ type: 'error', message: 'Failed to start collection' })
    }
  }, [collectionKeyword, collectionLocation, dispatchCollection, showToast])

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('debugConfig.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('debugConfig.subtitle')}</p>
      </div>

      {loadError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {/* Real-time System Summary */}
      <div className="grid gap-6 md:grid-cols-2">
        <SystemSummary />
        <SchedulerStatus apiBaseUrl={apiBaseUrl} />
      </div>

      {/* Resume Data Collection */}
      <Card>
        <CardHeader>
          <CardTitle>Resume Data Collection</CardTitle>
          <CardDescription>
            Trigger heavy-lifting agent tasks to scrape resumes from external platforms.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="col-keyword" className="text-sm font-medium">Keyword</label>
              <Input
                id="col-keyword"
                placeholder="e.g. 销售, 工程师"
                value={collectionKeyword}
                onChange={(e) => setCollectionKeyword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="col-location" className="text-sm font-medium">Location</label>
              <Input
                id="col-location"
                placeholder="e.g. 广东"
                value={collectionLocation}
                onChange={(e) => setCollectionLocation(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="col-limit" className="text-sm font-medium">Limit (Total Resumes)</label>
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
              <label htmlFor="col-max-pages" className="text-sm font-medium">Max Pages</label>
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
            Start Agent Collection
          </Button>

          <div className="mt-6">
            <TaskMonitor />
          </div>
        </CardContent>
      </Card>

      <Card>
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
                    <h3 className="text-sm font-semibold">{agent.id}</h3>
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

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>{t('debugConfig.presets')}</CardTitle>
              <CardDescription>{t('debugConfig.presetsDescription')}</CardDescription>
            </div>
            <Button size="sm" onClick={openAddPresetDialog}>
              {t('debugConfig.addPreset')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('debugConfig.presetId')}</TableHead>
                  <TableHead>{t('debugConfig.presetName')}</TableHead>
                  <TableHead>{t('debugConfig.presetCategory')}</TableHead>
                  <TableHead>{t('debugConfig.presetMinExp')}</TableHead>
                  <TableHead>{t('debugConfig.presetMaxExp')}</TableHead>
                  <TableHead>{t('debugConfig.presetEducation')}</TableHead>
                  <TableHead>{t('debugConfig.presetSalary')}</TableHead>
                  <TableHead className="text-right">{t('resumes.actions.view')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filterPresets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                      {loading ? t('trends.loading') : t('debug.none')}
                    </TableCell>
                  </TableRow>
                ) : (
                  filterPresets.map((preset) => (
                    <TableRow key={preset.id}>
                      <TableCell className="font-mono text-xs">{preset.id}</TableCell>
                      <TableCell>{preset.name}</TableCell>
                      <TableCell>{preset.category}</TableCell>
                      <TableCell>{preset.filters.minExperience ?? '-'}</TableCell>
                      <TableCell>{formatMaxExperience(preset.filters.maxExperience)}</TableCell>
                      <TableCell>{formatEducation(preset)}</TableCell>
                      <TableCell>{formatSalaryRange(preset)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              openEditPresetDialog(preset)
                            }}
                          >
                            {t('debugConfig.editPreset')}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              handleDeletePreset(preset.id).catch((error) => {
                                console.error('Unexpected handleDeletePreset failure', error)
                              })
                            }}
                          >
                            {t('debugConfig.deletePreset')}
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

      <Dialog open={presetDialogOpen} onOpenChange={setPresetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPresetId ? t('debugConfig.editPreset') : t('debugConfig.addPreset')}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.presetId')}</p>
              <Input
                value={presetForm.id}
                onChange={(event) => {
                  setPresetForm((current) => ({ ...current, id: event.target.value }))
                }}
                disabled={Boolean(editingPresetId)}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.presetName')}</p>
              <Input
                value={presetForm.name}
                onChange={(event) => {
                  setPresetForm((current) => ({ ...current, name: event.target.value }))
                }}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.presetCategory')}</p>
              <Input
                value={presetForm.category}
                list="preset-category-options"
                onChange={(event) => {
                  setPresetForm((current) => ({ ...current, category: event.target.value }))
                }}
              />
              <datalist id="preset-category-options">
                {presetCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </datalist>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('debugConfig.presetMinExp')}</p>
                <Input
                  type="number"
                  value={presetForm.minExperience}
                  onChange={(event) => {
                    setPresetForm((current) => ({ ...current, minExperience: event.target.value }))
                  }}
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('debugConfig.presetMaxExp')}</p>
                <Input
                  type="number"
                  value={presetForm.maxExperience}
                  onChange={(event) => {
                    setPresetForm((current) => ({ ...current, maxExperience: event.target.value }))
                  }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.presetEducation')}</p>
              <Input
                value={presetForm.education}
                onChange={(event) => {
                  setPresetForm((current) => ({ ...current, education: event.target.value }))
                }}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('debugConfig.presetSalary')} (min)</p>
                <Input
                  type="number"
                  value={presetForm.salaryMin}
                  onChange={(event) => {
                    setPresetForm((current) => ({ ...current, salaryMin: event.target.value }))
                  }}
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('debugConfig.presetSalary')} (max)</p>
                <Input
                  type="number"
                  value={presetForm.salaryMax}
                  onChange={(event) => {
                    setPresetForm((current) => ({ ...current, salaryMax: event.target.value }))
                  }}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPresetDialogOpen(false)
              }}
              disabled={savingPreset}
            >
              {t('jdManagement.cancel')}
            </Button>
            <Button
              onClick={() => {
                handleSavePreset().catch((error) => {
                  console.error('Unexpected handleSavePreset failure', error)
                })
              }}
              disabled={savingPreset}
            >
              {savingPreset ? `${t('debugConfig.save')}...` : t('debugConfig.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Irreversible actions that affect the entire system.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 border border-destructive/20 rounded-lg bg-destructive/5">
            <div className="space-y-1">
              <p className="font-medium text-destructive">Reset Database</p>
              <p className="text-sm text-destructive/80">
                Delete all collected resumes and tasks. This cannot be undone.
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={() => {
                if (window.confirm("Are you sure you want to delete ALL data? This cannot be undone.")) {
                  handleResetDatabase()
                }
              }}
            >
              Reset Database
            </Button>
          </div>
        </CardContent>
      </Card>

      {toast && (
        <div
          className={`fixed bottom-4 right-4 rounded-md px-3 py-2 text-sm text-white shadow-lg ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-destructive'
            }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}
