import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  parseAgentsConfigPayload,
  parseAIStatusPayload,
  parseOptionalNumberInput,
  type AgentItem,
  type AgentNumericField,
  type AgentsConfig,
  useSettingsRequestJson,
} from '@/pages/system-settings/lib'

export function SystemSettingsRuntimePage() {
  const { t } = useTranslation()
  const { requestJson } = useSettingsRequestJson()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [aiStatus, setAiStatus] = useState<ReturnType<typeof parseAIStatusPayload>>(null)
  const [agentsConfig, setAgentsConfig] = useState<AgentsConfig | null>(null)
  const [savingAgentId, setSavingAgentId] = useState<string | null>(null)

  const reviewStageCount = useMemo(
    () => agentsConfig?.agents.list.filter((agent) => agent.isBonded).length ?? 0,
    [agentsConfig],
  )

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)

    try {
      const [aiPayload, agentsPayload] = await Promise.all([
        requestJson('/api/config/ai-status'),
        requestJson('/api/config/agents'),
      ])

      const parsedAiStatus = parseAIStatusPayload(aiPayload)
      const parsedAgentsConfig = parseAgentsConfigPayload(agentsPayload)
      if (!parsedAiStatus || !parsedAgentsConfig) {
        throw new Error('Invalid runtime settings response')
      }

      setAiStatus(parsedAiStatus)
      setAgentsConfig(parsedAgentsConfig)
    } catch (error) {
      console.error('Failed to load runtime settings', error)
      setLoadError(t('resumes.error'))
    } finally {
      setLoading(false)
    }
  }, [requestJson, t])

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
          list: current.agents.list.map((agent) =>
            agent.id === agentId
              ? { ...agent, [field]: value }
              : agent),
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
          list: current.agents.list.map((agent) =>
            agent.id === agentId
              ? {
                ...agent,
                config: {
                  ...agent.config,
                  [field]: parsedInput.value,
                },
              }
              : agent),
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

  const handleSaveAgents = useCallback(async (agentId: string) => {
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
  }, [agentsConfig, requestJson, t])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">{t('debugConfig.settingsNavRuntime', { defaultValue: 'AI review runtime' })}</h2>
          <p className="text-sm text-muted-foreground">
            {t('debugConfig.runtimePageDescription', {
              defaultValue: 'Inspect AI connectivity and review-stage runtime tuning.',
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('debugConfig.runtimePageMeta', {
              defaultValue: '{{count}} review stages',
              count: reviewStageCount,
            })}
          </p>
        </div>
        <Button variant="outline" onClick={() => {
          loadData().catch((error) => {
            console.error('Unexpected loadData failure', error)
          })
        }} disabled={loading}>
          {loading ? t('trends.loading') : t('common.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>

      {loadError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

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
                        <Badge variant="outline" className="h-4 px-1 text-[10px] border-emerald-500/50 text-emerald-600">
                          Bonded
                        </Badge>
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
              agentsConfig.agents.list.map((agent: AgentItem) => {
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
                          onChange={(event) => updateAgentTextField(agent.id, 'name', event.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-muted-foreground">{t('debugConfig.agentModel')}</p>
                          {agent.isBonded && (
                            <Badge variant="outline" className="h-3.5 px-1 text-[9px] border-emerald-500/50 text-emerald-600">
                              Bonded
                            </Badge>
                          )}
                        </div>
                        <Input
                          value={agent.model}
                          disabled={agent.isBonded}
                          onChange={(event) => updateAgentTextField(agent.id, 'model', event.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">{t('debugConfig.agentBatchSize')}</p>
                        <Input
                          type="number"
                          value={agent.config.batchSize ?? ''}
                          onChange={(event) => updateAgentNumericField(agent.id, 'batchSize', event.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">{t('debugConfig.agentParallelism')}</p>
                        <Input
                          type="number"
                          value={agent.config.parallelism ?? ''}
                          onChange={(event) => updateAgentNumericField(agent.id, 'parallelism', event.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">{t('debugConfig.agentTimeout')}</p>
                        <Input
                          type="number"
                          value={agent.config.timeout ?? ''}
                          onChange={(event) => updateAgentNumericField(agent.id, 'timeout', event.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">{t('debugConfig.aiTemperature')}</p>
                        <Input
                          type="number"
                          step="0.1"
                          value={agent.config.temperature ?? ''}
                          onChange={(event) => updateAgentNumericField(agent.id, 'temperature', event.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">{t('debugConfig.agentThreshold')}</p>
                        <Input
                          type="number"
                          value={defaults.passThreshold ?? ''}
                          onChange={(event) => updateAgentThreshold(agent.id, event.target.value)}
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
    </div>
  )
}
