import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import type { Id } from '../../../../packages/convex/convex/_generated/dataModel'
import type { ResumeFilters } from '@/types/resume'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { toIndustryDbV2Stats, type IndustryDbV2Stats } from '@/lib/resume-scoring'

export type ExternalSessionState = {
  location?: string
  keywords?: string[]
  jobDescriptionId?: string
  filters?: Partial<ResumeFilters>
}

export type SearchHistoryItem = {
  id: Id<'search_history'>
  sessionKey: string
  title: string
  location: string
  keywords: string[]
  jobDescriptionId?: string
  filters: Partial<ResumeFilters>
  selectedTags: string[]
  selectedCompanies: string[]
  selectedExperienceLevel?: string
  collectionTaskId?: string
  analysisTaskId?: string
  notes?: string
  industryDbV2Stats?: IndustryDbV2Stats
  createdAt: number
  lastOpenedAt?: number
}

type SaveSearchHistoryInput = {
  title?: string
  notes?: string
  location?: string
  keywords?: string[]
  jobDescriptionId?: string
  filters?: Partial<ResumeFilters>
  selectedTags?: string[]
  selectedCompanies?: string[]
  selectedExperienceLevel?: string
  collectionTaskId?: string
  analysisTaskId?: string
  resumeIds?: string[]
}

const AUTO_RESTORE_SCREENING_SESSION = false
const DEFAULT_SESSION_LOCATION = ''

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function normalizeStringList(values: string[] | undefined): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    return []
  }

  const seen = new Set<string>()
  const normalized: string[] = []

  values.forEach((value) => {
    const token = value.trim()
    if (!token || seen.has(token)) {
      return
    }
    seen.add(token)
    normalized.push(token)
  })

  return normalized
}

export function useSession(loadSearchHistory = false) {
  const { slug } = useWorkspace()
  const storageKey = `trends.resume.sessionKey.${slug}`
  const [sessionKey, setSessionKey] = useState(() => {
    const stored = localStorage.getItem(storageKey)
    if (stored) return stored
    const newKey = Math.random().toString(36).substring(2) + Date.now().toString(36)
    localStorage.setItem(storageKey, newKey)
    return newKey
  })

  useEffect(() => {
    const stored = localStorage.getItem(storageKey)
    if (stored) {
      setSessionKey(stored)
      return
    }

    const newKey = Math.random().toString(36).substring(2) + Date.now().toString(36)
    localStorage.setItem(storageKey, newKey)
    setSessionKey(newKey)
  }, [storageKey])

  const activeSession = useQuery(
    api.sessions.getActiveSession,
    sessionKey ? { sessionKey, workspaceSlug: slug } : 'skip'
  )
  const historyRecords = useQuery(
    api.sessions.listSearchHistory,
    loadSearchHistory ? { workspaceSlug: slug } : 'skip'
  )
  const saveSession = useMutation(api.sessions.saveSession)
  const addReviewedItem = useMutation(api.sessions.addReviewedItem)
  const saveSearchHistoryMutation = useMutation(api.sessions.saveSearchHistory)
  const markSearchHistoryOpenedMutation = useMutation(api.sessions.markSearchHistoryOpened)

  const [hasHydratedInitialState, setHasHydratedInitialState] = useState(false)
  const hasInitializedScopeRef = useRef(false)

  const [location, setLocation] = useState(DEFAULT_SESSION_LOCATION)
  const [keywords, setKeywords] = useState<string[]>([])
  const [jobDescriptionId, setJobDescriptionId] = useState<string | undefined>(undefined)
  const [filters, setFilters] = useState<ResumeFilters>({})

  useEffect(() => {
    if (!hasInitializedScopeRef.current) {
      hasInitializedScopeRef.current = true
      return
    }

    setHasHydratedInitialState(false)
    setLocation(DEFAULT_SESSION_LOCATION)
    setKeywords([])
    setJobDescriptionId(undefined)
    setFilters({})
  }, [slug, sessionKey])

  useEffect(() => {
    if (!AUTO_RESTORE_SCREENING_SESSION) {
      if (!hasHydratedInitialState) {
        setHasHydratedInitialState(true)
      }
      return
    }

    if (activeSession && !hasHydratedInitialState) {
      setLocation(activeSession.config.location)
      setKeywords(activeSession.config.keywords)
      setJobDescriptionId(activeSession.config.jobDescriptionId)
      setFilters(activeSession.config.filters || {})
      setHasHydratedInitialState(true)
    }
  }, [activeSession, hasHydratedInitialState])

  useEffect(() => {
    if (!sessionKey) return
    if (!hasHydratedInitialState) return

    const timer = setTimeout(() => {
      void saveSession({
        sessionKey,
        workspaceSlug: slug,
        location,
        keywords,
        jobDescriptionId,
        filters,
      })
    }, 1000)

    return () => clearTimeout(timer)
  }, [sessionKey, slug, location, keywords, jobDescriptionId, filters, saveSession, hasHydratedInitialState])

  const trackReviewedResume = useCallback(
    async (resumeId: string) => {
      if (!sessionKey) return
      await addReviewedItem({ sessionKey, workspaceSlug: slug, resumeId })
    },
    [sessionKey, slug, addReviewedItem]
  )

  const reviewedIdsSet = useMemo(
    () => new Set(activeSession?.reviewedResumeIds || []),
    [activeSession?.reviewedResumeIds]
  )

  const applyExternalState = useCallback((state: ExternalSessionState) => {
    if (state.location !== undefined) {
      setLocation(state.location.trim())
    }

    if (state.keywords !== undefined) {
      const normalizedKeywords = state.keywords
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0)
      setKeywords(normalizedKeywords)
    }

    if (state.jobDescriptionId !== undefined) {
      const normalizedJobDescriptionId = state.jobDescriptionId.trim()
      setJobDescriptionId(normalizedJobDescriptionId.length > 0 ? normalizedJobDescriptionId : undefined)
    }

    if (state.filters !== undefined) {
      setFilters(state.filters)
    }

    setHasHydratedInitialState(true)
  }, [setFilters, setJobDescriptionId, setKeywords, setLocation])

  const searchHistory = useMemo<SearchHistoryItem[]>(() => {
    if (!historyRecords) {
      return []
    }

    return historyRecords.map((record) => ({
      id: record._id,
      sessionKey: record.sessionKey,
      title: record.title,
      location: record.location,
      keywords: record.keywords,
      jobDescriptionId: record.jobDescriptionId,
      filters: (record.filters ?? {}) as Partial<ResumeFilters>,
      selectedTags: normalizeStringList(record.selectedTags),
      selectedCompanies: normalizeStringList(record.selectedCompanies),
      selectedExperienceLevel: normalizeOptionalString(record.selectedExperienceLevel),
      collectionTaskId: normalizeOptionalString(record.collectionTaskId),
      analysisTaskId: normalizeOptionalString(record.analysisTaskId),
      notes: normalizeOptionalString(record.notes),
      industryDbV2Stats: toIndustryDbV2Stats(record.industryDbV2Stats),
      createdAt: record.createdAt,
      lastOpenedAt: record.lastOpenedAt,
    }))
  }, [historyRecords])

  const saveSearchHistory = useCallback(async (input: SaveSearchHistoryInput = {}) => {
    if (!sessionKey) {
      return null
    }

    return await saveSearchHistoryMutation({
      sessionKey,
      workspaceSlug: slug,
      title: normalizeOptionalString(input.title),
      notes: normalizeOptionalString(input.notes),
      location: input.location ?? location,
      keywords: input.keywords ?? keywords,
      jobDescriptionId: input.jobDescriptionId ?? jobDescriptionId,
      filters: input.filters ?? filters,
      selectedTags: normalizeStringList(input.selectedTags ?? []),
      selectedCompanies: normalizeStringList(input.selectedCompanies ?? []),
      selectedExperienceLevel: normalizeOptionalString(input.selectedExperienceLevel),
      collectionTaskId: normalizeOptionalString(input.collectionTaskId),
      analysisTaskId: normalizeOptionalString(input.analysisTaskId),
      resumeIds: normalizeStringList(input.resumeIds),
    })
  }, [filters, jobDescriptionId, keywords, location, saveSearchHistoryMutation, sessionKey, slug])

  const markSearchHistoryOpened = useCallback(async (id: Id<'search_history'>) => {
    await markSearchHistoryOpenedMutation({ id, workspaceSlug: slug })
  }, [markSearchHistoryOpenedMutation, slug])

  return {
    location,
    setLocation,
    keywords,
    setKeywords,
    jobDescriptionId,
    setJobDescriptionId,
    filters,
    setFilters,
    reviewedIdsSet,
    trackReviewedResume,
    applyExternalState,
    searchHistory,
    searchHistoryLoading: loadSearchHistory && historyRecords === undefined,
    saveSearchHistory,
    markSearchHistoryOpened,
    loading: !hasHydratedInitialState,
  }
}
