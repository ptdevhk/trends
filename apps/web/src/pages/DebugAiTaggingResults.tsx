import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Brain } from 'lucide-react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import type { Doc } from '../../../../packages/convex/convex/_generated/dataModel'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select } from '@/components/ui/select'
import { JobDescriptionSelect } from '@/components/JobDescriptionSelect'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useConvexResumes } from '@/hooks/useConvexResumes'

type AiTaggingRow = Doc<'ai_tagging_results'>

type StatusFilter = 'all' | 'pending' | 'processing' | 'completed' | 'failed'

function toOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function formatRuleScore(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : '--'
}

function getStatusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' {
  if (status === 'completed') return 'default'
  if (status === 'failed') return 'destructive'
  return 'secondary'
}

function buildCandidateLabel(candidate: { name?: string; jobIntention?: string; externalId?: string }): string {
  const name = candidate.name?.trim() || '--'
  const intention = candidate.jobIntention?.trim()
  if (intention) {
    return `${name} · ${intention}`
  }
  return candidate.externalId?.trim() ? `${name} · ${candidate.externalId.trim()}` : name
}

export default function DebugAiTaggingResults() {
  const { t } = useTranslation()
  const { slug } = useWorkspace()

  const [profileKey, setProfileKey] = useState('cnc-sales-strict')
  const [promptVersion, setPromptVersion] = useState('v1')
  const [model, setModel] = useState('')
  const [jobDescriptionId, setJobDescriptionId] = useState('')
  const [candidateLimit, setCandidateLimit] = useState('50')
  const [minRuleScore, setMinRuleScore] = useState('')
  const [maxRuleScore, setMaxRuleScore] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [enqueueing, setEnqueueing] = useState(false)

  const normalizedProfileKey = profileKey.trim()
  const normalizedJobDescriptionId = jobDescriptionId.trim() || undefined
  const limit = Math.max(1, Math.min(Math.floor(Number(candidateLimit) || 50), 500))
  const minScore = toOptionalNumber(minRuleScore)
  const maxScore = toOptionalNumber(maxRuleScore)

  const { resumes, loading } = useConvexResumes(limit, undefined, normalizedJobDescriptionId)

  const enqueueBatch = useMutation(api.ai_tagging_results.enqueueBatch)

  const summary = useQuery(
    api.ai_tagging_results.getSummary,
    normalizedProfileKey ? { workspaceSlug: slug, profileKey: normalizedProfileKey } : 'skip'
  )

  const compareRows = useQuery(
    api.ai_tagging_results.listForCompare,
    normalizedProfileKey ? {
      workspaceSlug: slug,
      profileKey: normalizedProfileKey,
      status: statusFilter === 'all' ? undefined : statusFilter,
      limit: 50,
    } : 'skip'
  )

  const candidateMap = useMemo(() => {
    return new Map<string, { name?: string; jobIntention?: string; externalId?: string; ruleScore?: number }>(
      resumes.map((resume) => {
        const ruleScore = normalizedJobDescriptionId
          ? (resume.ingestData?.ruleScores?.[normalizedJobDescriptionId] ?? 0)
          : 0
        return [String(resume.resumeId), {
          name: resume.name,
          jobIntention: resume.jobIntention,
          externalId: resume.externalId,
          ruleScore,
        }]
      })
    )
  }, [normalizedJobDescriptionId, resumes])

  const filteredCandidates = useMemo(() => {
    return resumes.filter((resume) => {
      if (!normalizedJobDescriptionId) {
        return true
      }
      const score = resume.ingestData?.ruleScores?.[normalizedJobDescriptionId] ?? 0
      if (typeof minScore === 'number' && score < minScore) {
        return false
      }
      if (typeof maxScore === 'number' && score > maxScore) {
        return false
      }
      return true
    })
  }, [maxScore, minScore, normalizedJobDescriptionId, resumes])

  const handleEnqueue = useCallback(async () => {
    if (!normalizedProfileKey) {
      toast.error(t('aiTagging.profileKeyRequired', { defaultValue: 'profileKey is required' }))
      return
    }
    if (!filteredCandidates.length) {
      toast.info(t('aiTagging.noCandidates', { defaultValue: 'No candidates to enqueue' }))
      return
    }

    setEnqueueing(true)
    try {
      const result = await enqueueBatch({
        workspaceSlug: slug,
        profileKey: normalizedProfileKey,
        resumeIds: filteredCandidates.map((resume) => resume.resumeId),
        jobDescriptionId: normalizedJobDescriptionId,
        promptVersion: promptVersion.trim() || undefined,
        model: model.trim() || undefined,
        retryFailed: true,
      })

      toast.success(
        t('aiTagging.enqueueSuccess', {
          defaultValue: `Enqueued: created ${result.created}, reused ${result.reused}, retried ${result.retried}`,
        })
      )
    } catch (error) {
      console.error('Failed to enqueue AI tagging', error)
      toast.error(t('aiTagging.enqueueFailed', { defaultValue: 'Failed to enqueue AI tagging' }))
    } finally {
      setEnqueueing(false)
    }
  }, [
    enqueueBatch,
    filteredCandidates,
    model,
    normalizedJobDescriptionId,
    normalizedProfileKey,
    promptVersion,
    slug,
    t,
  ])

  const statusOptions = useMemo(() => {
    const options: Array<{ value: StatusFilter; label: string }> = [
      { value: 'all', label: t('aiTagging.statusAll', { defaultValue: 'All' }) },
      { value: 'pending', label: t('aiTagging.statusPending', { defaultValue: 'Pending' }) },
      { value: 'processing', label: t('aiTagging.statusProcessing', { defaultValue: 'Processing' }) },
      { value: 'completed', label: t('aiTagging.statusCompleted', { defaultValue: 'Completed' }) },
      { value: 'failed', label: t('aiTagging.statusFailed', { defaultValue: 'Failed' }) },
    ]
    return options
  }, [t])

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('aiTagging.title', { defaultValue: 'AI Tagging (Compare)' })}
        description={t('aiTagging.subtitle', { defaultValue: 'Shadow-mode tagging results stored in ai_tagging_results.' })}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-4 w-4" />
            {t('aiTagging.configTitle', { defaultValue: 'Config' })}
          </CardTitle>
          <CardDescription>
            {t('aiTagging.configDesc', { defaultValue: 'Controls idempotencyKey (profileKey + evidenceHash + promptVersion + model).' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('aiTagging.profileKey', { defaultValue: 'Profile Key' })}</label>
            <Input value={profileKey} onChange={(event) => setProfileKey(event.target.value)} placeholder="cnc-sales-strict" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('aiTagging.promptVersion', { defaultValue: 'Prompt Version' })}</label>
            <Input value={promptVersion} onChange={(event) => setPromptVersion(event.target.value)} placeholder="v1" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('aiTagging.model', { defaultValue: 'Model (optional)' })}</label>
            <Input value={model} onChange={(event) => setModel(event.target.value)} placeholder={t('aiTagging.modelPlaceholder', { defaultValue: 'Use server default (AI_TAGGING_MODEL/AI_MODEL)' })} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('aiTagging.jobDescription', { defaultValue: 'Baseline JD (optional)' })}</label>
            <JobDescriptionSelect value={jobDescriptionId} onChange={setJobDescriptionId} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('aiTagging.enqueueTitle', { defaultValue: 'Enqueue' })}</CardTitle>
          <CardDescription>
            {t('aiTagging.enqueueDesc', { defaultValue: 'Select candidates (by ruleScore) and enqueue shadow tagging.' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('aiTagging.candidateLimit', { defaultValue: 'Candidate Limit' })}</label>
              <Input value={candidateLimit} onChange={(event) => setCandidateLimit(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('aiTagging.minRuleScore', { defaultValue: 'Min Rule Score' })}</label>
              <Input value={minRuleScore} onChange={(event) => setMinRuleScore(event.target.value)} placeholder="45" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('aiTagging.maxRuleScore', { defaultValue: 'Max Rule Score' })}</label>
              <Input value={maxRuleScore} onChange={(event) => setMaxRuleScore(event.target.value)} placeholder="80" />
            </div>
            <div className="flex items-end">
              <Button onClick={handleEnqueue} disabled={enqueueing || loading} className="w-full">
                {enqueueing ? t('aiTagging.enqueueing', { defaultValue: 'Enqueueing...' }) : t('aiTagging.enqueue', { defaultValue: 'Enqueue AI Tagging' })}
              </Button>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            {t('aiTagging.candidateSummary', {
              defaultValue: `Candidates: ${filteredCandidates.length} (loaded ${resumes.length})`,
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('aiTagging.resultsTitle', { defaultValue: 'Results' })}</CardTitle>
          <CardDescription>
            {summary
              ? t('aiTagging.summary', {
                defaultValue: `total ${summary.total}, pending ${summary.pending}, processing ${summary.processing}, completed ${summary.completed}, failed ${summary.failed}`,
              })
              : t('aiTagging.summaryLoading', { defaultValue: 'Loading summary…' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-56">
              <Select
                options={statusOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              />
            </div>
            <Badge variant="secondary">{t('aiTagging.profile', { defaultValue: 'profile' })}: {normalizedProfileKey || '--'}</Badge>
          </div>

          {!compareRows ? (
            <div className="text-sm text-muted-foreground">{t('aiTagging.resultsLoading', { defaultValue: 'Loading…' })}</div>
          ) : compareRows.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t('aiTagging.noResults', { defaultValue: 'No results yet.' })}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('aiTagging.table.status', { defaultValue: 'Status' })}</TableHead>
                  <TableHead>{t('aiTagging.table.candidate', { defaultValue: 'Candidate' })}</TableHead>
                  <TableHead className="text-right">{t('aiTagging.table.rule', { defaultValue: 'Rule' })}</TableHead>
                  <TableHead>{t('aiTagging.table.ai', { defaultValue: 'AI' })}</TableHead>
                  <TableHead>{t('aiTagging.table.evidence', { defaultValue: 'Evidence' })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {compareRows.map((row: { ai: AiTaggingRow; resume: Doc<'resumes'> | null }) => {
                  const candidate = candidateMap.get(String(row.ai.resumeId))
                  const label = candidate
                    ? buildCandidateLabel(candidate)
                    : t('aiTagging.unknownCandidate', { defaultValue: 'Unknown candidate' })
                  const ruleScore = candidate?.ruleScore ?? row.ai.baseline?.ruleScore

                  const result = row.ai.result
                  const aiSummary = result
                    ? `${result.recommendation} (${Math.round(result.confidence)}) · ${result.roleFit}`
                    : row.ai.error
                      ? t('aiTagging.failed', { defaultValue: 'Failed' })
                      : t('aiTagging.pending', { defaultValue: 'Pending' })

                  const tags = result?.tags?.length ? result.tags.slice(0, 6).join(', ') : '--'
                  const evidenceLines = result?.evidenceLines?.length ? result.evidenceLines : []

                  return (
                    <TableRow key={String(row.ai._id)}>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(row.ai.status)}>
                          {row.ai.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate" title={label}>{label}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatRuleScore(ruleScore)}</TableCell>
                      <TableCell className="space-y-1">
                        <div className="text-sm">{aiSummary}</div>
                        <div className="text-xs text-muted-foreground truncate" title={tags}>{tags}</div>
                        {row.ai.error ? (
                          <div className="text-xs text-destructive truncate" title={row.ai.error}>{row.ai.error}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-[380px]">
                        {evidenceLines.length > 0 ? (
                          <details>
                            <summary className="cursor-pointer text-xs text-muted-foreground">
                              {t('aiTagging.showEvidence', { defaultValue: `Show (${evidenceLines.length})` })}
                            </summary>
                            <pre className="mt-2 whitespace-pre-wrap rounded-md border bg-muted/40 p-2 text-xs leading-relaxed">
                              {evidenceLines.join('\n')}
                            </pre>
                          </details>
                        ) : (
                          <span className="text-xs text-muted-foreground">--</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

