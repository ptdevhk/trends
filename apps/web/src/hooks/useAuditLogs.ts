import { useCallback, useEffect, useState } from 'react'
import { rawApiClient } from '@/lib/api-helpers'

export type AuditLogEntry = {
  _id: string
  resumeId: string
  identityKey?: string
  workspaceSlug: string
  decisionType: 'score' | 'tag' | 'rank' | 'filter' | 'confirm'
  actionRef: string
  inputSnapshot: {
    jobDescriptionId?: string
    profileKey?: string
    promptVersion?: string
    fieldUsagePolicyVersion?: number
    scrubbedFields?: string[]
    searchKeywords?: string[]
    searchLocation?: string
  }
  modelMeta: {
    model: string
    provider: string
    apiBase?: string
    promptTokens?: number
    completionTokens?: number
    latencyMs?: number
  }
  output: {
    score?: number
    recommendation?: string
    roleFit?: string
    confidence?: number
    tags?: string[]
  }
  protectedAttributeHashes?: {
    ageBracketHash?: string
    genderHash?: string
    locationHash?: string
    sourceHash?: string
  }
  explanation?: {
    summary: string
    keyFactors: Array<{ factor: string; weight?: number; value: string }>
    modelReasoning?: string
  }
  outcome?: 'pending' | 'accepted' | 'overridden' | 'appealed'
  outcomeSetBy?: string
  outcomeSetAt?: number
  anomalyFlags?: {
    statisticalParityViolation?: boolean
    disparateImpactViolation?: boolean
    scoreDriftDetected?: boolean
    psiValue?: number
    flagReason?: string
  }
  actorId?: string
  actorRole?: 'admin' | 'operator' | 'system'
  decidedAt: number
  reviewedAt?: number
  expiresAt: number
}

type AuditLogsResponse = {
  success: boolean
  data?: AuditLogEntry[]
  error?: string
}

type AuditOutcomeResponse = {
  success: boolean
  error?: string
}

type BiasReportData = Record<string, unknown>

type BiasReportResponse = {
  success: boolean
  report?: BiasReportData | null
  error?: string
}

export type AuditLogFilters = {
  decisionType?: string
  outcome?: string
}

export function useAuditLogs(workspaceSlug: string, enabled: boolean = true) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<AuditLogFilters>({})

  const load = useCallback(async () => {
    if (!enabled || !workspaceSlug.trim()) {
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    const { data, error: apiError } = await rawApiClient.POST<AuditLogsResponse>(
      '/api/resumes/audit-logs',
      {
        body: {
          workspaceSlug,
          ...(filters.decisionType ? { decisionType: filters.decisionType } : {}),
          ...(filters.outcome ? { outcome: filters.outcome } : {}),
        },
      },
    )

    if (apiError || !data?.success) {
      setError(data?.error ?? 'Failed to load audit logs')
      setLoading(false)
      return
    }

    setLogs(Array.isArray(data.data) ? data.data : [])
    setLoading(false)
  }, [enabled, workspaceSlug, filters.decisionType, filters.outcome])

  const setOutcome = useCallback(
    async (auditLogId: string, outcome: 'accepted' | 'overridden' | 'appealed', setBy?: string) => {
      const { data, error: apiError } = await rawApiClient.POST<AuditOutcomeResponse>(
        '/api/resumes/audit-outcome',
        { body: { auditLogId, outcome, ...(setBy ? { setBy } : {}) } },
      )

      if (apiError || !data?.success) {
        setError(data?.error ?? 'Failed to set audit outcome')
        return false
      }

      await load()
      return true
    },
    [load],
  )

  useEffect(() => {
    if (!enabled) {
      setLogs([])
      return
    }
    void load()
  }, [enabled, load])

  return {
    logs,
    loading,
    error,
    filters,
    setFilters,
    reload: load,
    setOutcome,
  }
}

export type AnomalyAlert = {
  workspaceSlug: string
  flags: string[]
  psiValue: number | null
  disparityRatio: number | null
  alertedAt: number
}

type AnomalyAlertsResponse = {
  success: boolean
  alerts?: AnomalyAlert | null
  error?: string
}

export function useBiasReport(workspaceSlug: string, enabled: boolean = true) {
  const [report, setReport] = useState<BiasReportData | null>(null)
  const [anomalyAlerts, setAnomalyAlerts] = useState<AnomalyAlert | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!enabled || !workspaceSlug.trim()) {
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)

    const [reportResult, alertsResult] = await Promise.all([
      rawApiClient.GET<BiasReportResponse>(
        '/api/resumes/bias-report',
        { params: { query: { workspaceSlug } } },
      ),
      rawApiClient.GET<AnomalyAlertsResponse>(
        '/api/resumes/anomaly-alerts',
        { params: { query: { workspaceSlug } } },
      ),
    ])

    if (reportResult.error || !reportResult.data?.success) {
      setError(reportResult.data?.error ?? 'Failed to load bias report')
      setLoading(false)
      return
    }

    setReport(reportResult.data.report ?? null)
    setAnomalyAlerts(alertsResult.data?.alerts ?? null)
    setLoading(false)
  }, [enabled, workspaceSlug])

  useEffect(() => {
    if (!enabled) {
      setReport(null)
      return
    }
    void load()
  }, [enabled, load])

  return {
    report,
    anomalyAlerts,
    loading,
    error,
    reload: load,
  }
}
