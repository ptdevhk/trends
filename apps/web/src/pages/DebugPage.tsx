import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { apiClient } from '@/lib/api-client'
import type { components } from '@/lib/api-types'
import { SearchBar } from '@/components/SearchBar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type ResumeSample = components['schemas']['ResumeSample']
type ResumeItem = components['schemas']['ResumeItem']
type ResumesResponse = components['schemas']['ResumesResponse']

type IndustryStatsResponse = {
  success: true
  stats: {
    loadedAt: string
    companiesCount: number
    keywordsCount: number
    brandsCount: number
  }
}

type IndustryValidationResponse = {
  success: true
  valid: boolean
  issues: Array<{
    section: string
    row: number
    issue: string
    severity: 'error' | 'warning'
  }>
  stats: {
    totalTables: number
    totalRows: number
    tablesWithIssues: number
  }
}

type JobDescriptionFile = {
  name: string
  filename: string
  updatedAt: string
  size: number
  title?: string
}

type JobDescriptionsResponse = {
  success: true
  items: JobDescriptionFile[]
}

type JobDescriptionResponse = {
  success: true
  item: JobDescriptionFile
  content: string
}

type CountEntry = { label: string; count: number }

function buildCounts(items: ResumeItem[], key: keyof ResumeItem): CountEntry[] {
  const counter = new Map<string, number>()
  items.forEach((item) => {
    const value = (item[key] ?? '').toString().trim()
    if (!value) return
    counter.set(value, (counter.get(value) ?? 0) + 1)
  })

  return Array.from(counter.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
}

export function DebugPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const [samples, setSamples] = useState<ResumeSample[]>([])
  const [selectedSample, setSelectedSample] = useState('')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(50)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rawResponse, setRawResponse] = useState<ResumesResponse | null>(null)
  const [industryStats, setIndustryStats] = useState<IndustryStatsResponse['stats'] | null>(null)
  const [industryValidation, setIndustryValidation] = useState<IndustryValidationResponse | null>(null)
  const [industryError, setIndustryError] = useState<string | null>(null)
  const [jobDescriptions, setJobDescriptions] = useState<JobDescriptionFile[]>([])
  const [selectedJob, setSelectedJob] = useState('')
  const [jobContent, setJobContent] = useState('')
  const [jobsError, setJobsError] = useState<string | null>(null)

  const apiBaseUrl = useMemo(() => {
    const rawBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
    return rawBaseUrl.replace(/\/api\/?$/, '')
  }, [])

  const fetchJson = useCallback(async <T,>(path: string): Promise<T> => {
    const response = await fetch(`${apiBaseUrl}${path}`)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return response.json() as Promise<T>
  }, [apiBaseUrl])

  const sampleOptions = useMemo(
    () =>
      samples.map((sample) => ({
        value: sample.name,
        label: sample.name,
      })),
    [samples]
  )

  const resumes = rawResponse?.data ?? []
  const summary = rawResponse?.summary
  const metadata = rawResponse?.metadata

  const activeSection = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean)
    const index = parts.indexOf('debug')
    const next = index >= 0 ? parts[index + 1] : undefined
    const allowed = new Set(['all', 'inputs', 'findings', 'process', 'raw', 'industry', 'jobs'])
    if (next && allowed.has(next)) return next
    return 'all'
  }, [location.pathname])

  const showAll = activeSection === 'all'
  const showInputs = showAll || activeSection === 'inputs'
  const showFindings = showAll || activeSection === 'findings'
  const showProcess = showAll || activeSection === 'process'
  const showRaw = showAll || activeSection === 'raw'
  const showIndustry = showAll || activeSection === 'industry'
  const showJobs = showAll || activeSection === 'jobs'

  const navLinks = useMemo(
    () => [
      { key: 'all', label: t('debug.navAll'), href: '/debug' },
      { key: 'inputs', label: t('debug.navInputs'), href: '/debug/inputs' },
      { key: 'findings', label: t('debug.navFindings'), href: '/debug/findings' },
      { key: 'process', label: t('debug.navProcess'), href: '/debug/process' },
      { key: 'raw', label: t('debug.navRaw'), href: '/debug/raw' },
      { key: 'industry', label: t('debug.navIndustry'), href: '/debug/industry' },
      { key: 'jobs', label: t('debug.navJobs'), href: '/debug/jobs' },
    ],
    [t]
  )

  const locationCounts = useMemo(() => buildCounts(resumes, 'location').slice(0, 5), [resumes])
  const educationCounts = useMemo(() => buildCounts(resumes, 'education').slice(0, 5), [resumes])
  const intentionCounts = useMemo(() => buildCounts(resumes, 'jobIntention').slice(0, 5), [resumes])

  const missingStats = useMemo(() => {
    const fields: Array<keyof ResumeItem> = ['education', 'location', 'experience', 'jobIntention']
    const stats = fields.map((field) => {
      const missing = resumes.filter((item) => !item[field]?.toString().trim()).length
      return { field, missing }
    })
    const missingWorkHistory = resumes.filter((item) => (item.workHistory?.length ?? 0) === 0).length
    return { stats, missingWorkHistory }
  }, [resumes])

  const loadSamples = useCallback(async () => {
    setError(null)
    const { data, error: apiError } = await apiClient.GET('/api/resumes/samples')
    if (apiError || !data?.success) {
      setError('Failed to load resume samples')
      return
    }

    setSamples(data.samples ?? [])
    if (data.samples?.length) {
      setSelectedSample((current) => current || data.samples[0].name)
    }
  }, [])

  const loadResumes = useCallback(async () => {
    if (!selectedSample) return
    setLoading(true)
    setError(null)

    const { data, error: apiError } = await apiClient.GET('/api/resumes', {
      params: {
        query: {
          sample: selectedSample,
          q: query || undefined,
          limit,
        },
      },
    })

    if (apiError || !data?.success) {
      setLoading(false)
      setError('Failed to load resume data')
      setRawResponse(null)
      return
    }

    setRawResponse(data)
    setLoading(false)
  }, [limit, query, selectedSample])

  useEffect(() => {
    loadSamples()
  }, [loadSamples])

  useEffect(() => {
    if (selectedSample) {
      loadResumes()
    }
  }, [loadResumes, selectedSample])

  useEffect(() => {
    if (!showIndustry) return
    let mounted = true
    setIndustryError(null)

    fetchJson<IndustryStatsResponse>('/api/industry/stats')
      .then((data) => {
        if (mounted) setIndustryStats(data.stats)
      })
      .catch((err: Error) => {
        if (mounted) setIndustryError(err.message)
      })

    fetchJson<IndustryValidationResponse>('/api/industry/validate')
      .then((data) => {
        if (mounted) setIndustryValidation(data)
      })
      .catch((err: Error) => {
        if (mounted) setIndustryError(err.message)
      })

    return () => {
      mounted = false
    }
  }, [fetchJson, showIndustry])

  useEffect(() => {
    if (!showJobs) return
    let mounted = true
    setJobsError(null)

    fetchJson<JobDescriptionsResponse>('/api/job-descriptions')
      .then((data) => {
        if (!mounted) return
        setJobDescriptions(data.items)
        if (data.items.length) {
          setSelectedJob((current) => current || data.items[0].name)
        }
      })
      .catch((err: Error) => {
        if (mounted) setJobsError(err.message)
      })

    return () => {
      mounted = false
    }
  }, [fetchJson, showJobs])

  useEffect(() => {
    if (!showJobs || !selectedJob) return
    let mounted = true
    setJobsError(null)

    fetchJson<JobDescriptionResponse>(`/api/job-descriptions/${encodeURIComponent(selectedJob)}`)
      .then((data) => {
        if (mounted) setJobContent(data.content)
      })
      .catch((err: Error) => {
        if (mounted) setJobsError(err.message)
      })

    return () => {
      mounted = false
    }
  }, [fetchJson, selectedJob, showJobs])

  const handleSearch = useCallback((keyword: string) => {
    setQuery(keyword)
  }, [])

  const handleClearSearch = useCallback(() => {
    setQuery('')
  }, [])

  const handleRefresh = useCallback(async () => {
    await loadSamples()
    await loadResumes()
  }, [loadResumes, loadSamples])

  const jobOptions = useMemo(
    () =>
      jobDescriptions.map((job) => ({
        value: job.name,
        label: job.title ? `${job.title} (${job.name})` : job.name,
      })),
    [jobDescriptions]
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{t('debug.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('debug.subtitle')}</p>
          </div>
          <Button variant="outline" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            {t('debug.refresh')}
          </Button>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr_0.6fr]">
          <SearchBar
            onSearch={handleSearch}
            onClear={handleClearSearch}
            loading={loading}
            placeholder={t('debug.searchPlaceholder')}
            buttonLabel={t('debug.searchButton')}
          />
          <Select
            options={sampleOptions}
            value={selectedSample}
            onChange={(event) => setSelectedSample(event.target.value)}
            disabled={sampleOptions.length === 0}
          />
          <Input
            type="number"
            min={1}
            max={500}
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value) || 50)}
            placeholder={t('debug.limitPlaceholder')}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {navLinks.map((link) => (
            <NavLink
              key={link.key}
              to={link.href}
              end={link.key === 'all'}
              className={({ isActive }) =>
                cn(
                  'rounded-full border px-3 py-1 transition-colors',
                  isActive ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        {summary && !error ? (
          <div className="text-sm text-muted-foreground">
            {t('debug.summary', {
              returned: summary.returned ?? resumes.length,
              total: summary.total ?? resumes.length,
              sample: selectedSample || '--',
            })}
          </div>
        ) : null}
      </div>

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('debug.errorTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      ) : null}

      {(showInputs || showFindings) && (
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          {showInputs ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('debug.inputsTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{t('debug.inputsSample')}</span>
                  <Badge variant="outline">{selectedSample || '--'}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{t('debug.inputsQuery')}</span>
                  <Badge variant="secondary">{query || t('debug.none')}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{t('debug.inputsLimit')}</span>
                  <Badge variant="secondary">{limit}</Badge>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('debug.inputsMetadata')}</p>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {metadata ? JSON.stringify(metadata, null, 2) : t('debug.none')}
                  </pre>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('debug.inputsSamples')}</p>
                  <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {samples.length ? JSON.stringify(samples, null, 2) : t('debug.none')}
                  </pre>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {showFindings ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('debug.findingsTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <p className="text-muted-foreground">{t('debug.findingsTotals')}</p>
                  <p className="text-lg font-semibold">{resumes.length}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-muted-foreground">{t('debug.findingsLocations')}</p>
                    <ul className="space-y-1 text-xs">
                      {locationCounts.length ? locationCounts.map((item) => (
                        <li key={item.label} className="flex justify-between">
                          <span className="truncate">{item.label}</span>
                          <span className="text-muted-foreground">{item.count}</span>
                        </li>
                      )) : <li>{t('debug.none')}</li>}
                    </ul>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t('debug.findingsEducation')}</p>
                    <ul className="space-y-1 text-xs">
                      {educationCounts.length ? educationCounts.map((item) => (
                        <li key={item.label} className="flex justify-between">
                          <span className="truncate">{item.label}</span>
                          <span className="text-muted-foreground">{item.count}</span>
                        </li>
                      )) : <li>{t('debug.none')}</li>}
                    </ul>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t('debug.findingsIntentions')}</p>
                    <ul className="space-y-1 text-xs">
                      {intentionCounts.length ? intentionCounts.map((item) => (
                        <li key={item.label} className="flex justify-between">
                          <span className="truncate">{item.label}</span>
                          <span className="text-muted-foreground">{item.count}</span>
                        </li>
                      )) : <li>{t('debug.none')}</li>}
                    </ul>
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('debug.findingsMissing')}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {missingStats.stats.map((stat) => (
                      <Badge key={stat.field} variant="outline">
                        {stat.field}: {stat.missing}
                      </Badge>
                    ))}
                    <Badge variant="outline">workHistory: {missingStats.missingWorkHistory}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {showProcess ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('debug.processTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-muted-foreground">{t('debug.processSteps')}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                <li>{t('debug.stepLoadSamples')}</li>
                <li>{t('debug.stepFetchResumes')}</li>
                <li>{t('debug.stepNormalize')}</li>
                <li>{t('debug.stepAggregate')}</li>
              </ol>
            </div>
            <div>
              <p className="text-muted-foreground">{t('debug.processPreview')}</p>
              <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs">
                {resumes.length ? JSON.stringify(resumes.slice(0, 3), null, 2) : t('debug.none')}
              </pre>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {showIndustry ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('debug.industryTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {industryError ? (
              <p className="text-sm text-destructive">{industryError}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{t('debug.industryCompanies', { count: industryStats?.companiesCount ?? 0 })}</Badge>
              <Badge variant="outline">{t('debug.industryKeywords', { count: industryStats?.keywordsCount ?? 0 })}</Badge>
              <Badge variant="outline">{t('debug.industryBrands', { count: industryStats?.brandsCount ?? 0 })}</Badge>
              {industryStats?.loadedAt ? (
                <Badge variant="secondary">{t('debug.industryLoadedAt', { value: industryStats.loadedAt })}</Badge>
              ) : null}
            </div>
            {industryValidation ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">{t('debug.industryTables', { count: industryValidation.stats.totalTables })}</Badge>
                  <Badge variant="secondary">{t('debug.industryRows', { count: industryValidation.stats.totalRows })}</Badge>
                  <Badge variant="secondary">{t('debug.industryIssues', { count: industryValidation.stats.tablesWithIssues })}</Badge>
                  <Badge variant={industryValidation.valid ? 'outline' : 'destructive'}>
                    {industryValidation.valid ? t('debug.industryValid') : t('debug.industryInvalid')}
                  </Badge>
                </div>
                {industryValidation.issues.length ? (
                  <pre className="max-h-52 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify(industryValidation.issues.slice(0, 5), null, 2)}
                  </pre>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('debug.none')}</p>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {showJobs ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('debug.jobsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {jobsError ? <p className="text-sm text-destructive">{jobsError}</p> : null}
            <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
              <Select
                options={jobOptions}
                value={selectedJob}
                onChange={(event) => setSelectedJob(event.target.value)}
                disabled={jobOptions.length === 0}
              />
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {jobDescriptions.length ? (
                  jobDescriptions.map((job) => (
                    <Badge key={job.name} variant="outline">
                      {job.name}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="outline">{t('debug.none')}</Badge>
                )}
              </div>
            </div>
            <pre className="max-h-[480px] overflow-auto rounded-md bg-muted p-3 text-xs">
              {jobContent || t('debug.none')}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      {showRaw ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('debug.rawTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[480px] overflow-auto rounded-md bg-muted p-3 text-xs">
              {rawResponse ? JSON.stringify(rawResponse, null, 2) : t('debug.none')}
            </pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
