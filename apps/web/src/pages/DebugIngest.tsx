import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useAction } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { useConvexResumes } from '@/hooks/useConvexResumes'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Database, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function getSearchTarget(resume: ConvexResumeItem): string {
  return [
    resume.externalId,
    resume.name,
    resume.jobIntention,
    resume.location,
    resume.experience,
    resume.education,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase()
}

function formatTimestamp(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--'
  }
  return new Date(value).toLocaleString()
}

function parseSkillsVersionPayload(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  if (!('success' in value) || value.success !== true) {
    return null
  }
  if (!('version' in value)) {
    return null
  }
  return typeof value.version === 'number' ? value.version : null
}

function toBrandLabel(value: string): string {
  return value.toUpperCase()
}

export default function DebugIngest() {
  const { t } = useTranslation()
  const { resumes, loading } = useConvexResumes(500)
  const backfillIngestData = useAction(api.migrations.backfillIngestData)
  const reIngestStaleSkillsVersion = useAction(api.migrations.reIngestStaleSkillsVersion)

  const [search, setSearch] = useState('')
  const [skillsVersion, setSkillsVersion] = useState<number | null>(null)
  const [versionLoading, setVersionLoading] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [reingesting, setReingesting] = useState(false)

  const apiBaseUrl = useMemo(() => {
    const rawBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
    return rawBaseUrl.replace(/\/api\/?$/, '')
  }, [])

  const loadSkillsVersion = useCallback(async () => {
    setVersionLoading(true)
    try {
      const response = await fetch(`${apiBaseUrl}/api/resumes/skills-version`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const payload = await response.json()
      const version = parseSkillsVersionPayload(payload)
      if (version === null) {
        throw new Error('Invalid skills version response')
      }
      setSkillsVersion(version)
    } catch (error) {
      console.error('Failed to fetch skills version', error)
      toast.error(t('debugIngest.skillsVersionFailed', { defaultValue: 'Failed to load skills version' }))
    } finally {
      setVersionLoading(false)
    }
  }, [apiBaseUrl, t])

  useEffect(() => {
    void loadSkillsVersion()
  }, [loadSkillsVersion])

  const filteredResumes = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return resumes
    }
    return resumes.filter((resume) => getSearchTarget(resume).includes(query))
  }, [resumes, search])

  const withIngestCount = useMemo(
    () => resumes.filter((resume) => resume.ingestData !== undefined).length,
    [resumes]
  )

  const staleCount = useMemo(() => {
    if (skillsVersion === null) {
      return 0
    }
    return resumes.filter((resume) => {
      const version = resume.ingestData?.skillsVersion
      return typeof version !== 'number' || version < skillsVersion
    }).length
  }, [resumes, skillsVersion])

  const toggleExpanded = useCallback((resumeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(resumeId)) {
        next.delete(resumeId)
      } else {
        next.add(resumeId)
      }
      return next
    })
  }, [])

  const triggerReIngest = useCallback(async () => {
    setReingesting(true)
    try {
      const [backfillResult, staleResult] = await Promise.all([
        backfillIngestData({ limit: 200 }),
        reIngestStaleSkillsVersion({ limit: 200 }),
      ])
      toast.success(
        t('debugIngest.reingestSuccess', {
          scheduled: backfillResult.scheduled + staleResult.scheduled,
          defaultValue: `Scheduled ${backfillResult.scheduled + staleResult.scheduled} resumes for ingest`,
        })
      )
      await loadSkillsVersion()
    } catch (error) {
      console.error('Failed to trigger re-ingest', error)
      toast.error(t('debugIngest.reingestFailed', { defaultValue: 'Failed to trigger re-ingest' }))
    } finally {
      setReingesting(false)
    }
  }, [backfillIngestData, loadSkillsVersion, reIngestStaleSkillsVersion, t])

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Database className="h-6 w-6 text-primary" />
          {t('debugIngest.title', { defaultValue: 'Ingest Diagnostics' })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('debugIngest.subtitle', { defaultValue: 'Inspect ingestData, staleness, and trigger re-ingest tasks.' })}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('debugIngest.total', { defaultValue: 'Total Resumes' })}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{resumes.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('debugIngest.withIngest', { defaultValue: 'With Ingest Data' })}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{withIngestCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('debugIngest.stale', { defaultValue: 'Stale / Missing' })}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{staleCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('debugIngest.skillsVersion', { defaultValue: 'Skills Version' })}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {versionLoading ? '...' : skillsVersion ?? '--'}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('debugIngest.searchPlaceholder', { defaultValue: 'Search by name / intention / location...' })}
          className="max-w-xl"
        />
        <Button variant="outline" onClick={() => void loadSkillsVersion()} disabled={versionLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${versionLoading ? 'animate-spin' : ''}`} />
          {t('common.refresh', { defaultValue: 'Refresh' })}
        </Button>
        <Button onClick={() => void triggerReIngest()} disabled={reingesting}>
          <RefreshCw className={`mr-2 h-4 w-4 ${reingesting ? 'animate-spin' : ''}`} />
          {t('debugIngest.reingest', { defaultValue: 'Trigger Re-ingest' })}
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[48px]" />
              <TableHead>{t('resumes.columns.name', { defaultValue: 'Name' })}</TableHead>
              <TableHead>{t('resumes.columns.intention', { defaultValue: 'Intention' })}</TableHead>
              <TableHead>{t('resumes.columns.location', { defaultValue: 'Location' })}</TableHead>
              <TableHead>{t('debugIngest.skillsVersion', { defaultValue: 'Skills Version' })}</TableHead>
              <TableHead>{t('debugIngest.computedAt', { defaultValue: 'Computed At' })}</TableHead>
              <TableHead>{t('debugIngest.status', { defaultValue: 'Status' })}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {t('resumes.loading', { defaultValue: 'Loading...' })}
                </TableCell>
              </TableRow>
            ) : filteredResumes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {t('debugIngest.noResults', { defaultValue: 'No resumes found' })}
                </TableCell>
              </TableRow>
            ) : (
              filteredResumes.map((resume) => {
                const resumeId = String(resume.resumeId)
                const isExpanded = expandedIds.has(resumeId)
                const ingestData = resume.ingestData
                const isStale = skillsVersion !== null
                  && (typeof ingestData?.skillsVersion !== 'number' || ingestData.skillsVersion < skillsVersion)

                return (
                  <Fragment key={resumeId}>
                    <TableRow key={resumeId}>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(resumeId)}
                          className="rounded p-1 hover:bg-muted"
                          aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                        >
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </TableCell>
                      <TableCell>{resume.name || '--'}</TableCell>
                      <TableCell>{resume.jobIntention || '--'}</TableCell>
                      <TableCell>{resume.location || '--'}</TableCell>
                      <TableCell>{ingestData?.skillsVersion ?? '--'}</TableCell>
                      <TableCell>{formatTimestamp(ingestData?.computedAt)}</TableCell>
                      <TableCell>
                        {!ingestData ? (
                          <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-zinc-600">
                            {t('debugIngest.missing', { defaultValue: 'Missing' })}
                          </Badge>
                        ) : isStale ? (
                          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                            {t('debugIngest.staleBadge', { defaultValue: 'Stale' })}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                            {t('debugIngest.fresh', { defaultValue: 'Fresh' })}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                    {isExpanded ? (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/20">
                          {ingestData ? (
                            <div className="grid gap-2 text-sm md:grid-cols-2">
                              <div>
                                <span className="font-medium">{t('debugIngest.industryTags', { defaultValue: 'Industry Tags' })}:</span>{' '}
                                {ingestData.industryTags.length > 0 ? ingestData.industryTags.join(', ') : '--'}
                              </div>
                              <div>
                                <span className="font-medium">{t('debugIngest.companyHits', { defaultValue: 'Company Hits' })}:</span>{' '}
                                {ingestData.companyHits.length > 0 ? ingestData.companyHits.join(', ') : '--'}
                              </div>
                              <div className="md:col-span-2">
                                <span className="font-medium">{t('debugIngest.brandHits', { defaultValue: 'Brand Hits' })}:</span>{' '}
                                {ingestData.brandHits.length > 0
                                  ? ingestData.brandHits
                                    .map((hit) => {
                                      const sourceLabel = t(`debugIngest.brandSource.${hit.source}`, { defaultValue: hit.source })
                                      const contextLabel = t(`debugIngest.brandContext.${hit.context}`, { defaultValue: hit.context })
                                      const roleLabel = t(`debugIngest.brandRole.${hit.role}`, { defaultValue: hit.role })
                                      return `${toBrandLabel(hit.brand)} (${sourceLabel} / ${contextLabel} / ${roleLabel})`
                                    })
                                    .join('; ')
                                  : '--'}
                              </div>
                              <div>
                                <span className="font-medium">{t('debugIngest.experienceLevel', { defaultValue: 'Experience Level' })}:</span>{' '}
                                {ingestData.experienceLevel || '--'}
                              </div>
                              <div>
                                <span className="font-medium">{t('debugIngest.ruleScoreCount', { defaultValue: 'Rule Scores' })}:</span>{' '}
                                {Object.keys(ingestData.ruleScores || {}).length}
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {t('debugIngest.noIngestData', { defaultValue: 'No ingest data yet for this resume.' })}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
