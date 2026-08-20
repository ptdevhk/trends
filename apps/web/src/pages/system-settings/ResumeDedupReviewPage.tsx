import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQuery } from 'convex/react'
import { api } from '../../../../../packages/convex/convex/_generated/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface ResumeSummaryView {
  resumeId: string
  name: string | null
  source: string
  externalId: string
  identityKey?: string
  contactSignals?: {
    email?: string
    phone?: string
    linkedin?: string
  }
}

interface CandidateView {
  score: number
  evidence: string[]
  left: ResumeSummaryView
  right: ResumeSummaryView
}

/**
 * Resume dedup review (advisory): lists suggested same-person matches across
 * collection sources, scored from capture-time contact signals and content
 * heuristics. Suggestions only — nothing on this page merges resumes or
 * changes identityKey.
 */
export default function SystemSettingsResumeDedupReviewPage() {
  const { t } = useTranslation()
  const result = useQuery(api.resume_dedup.suggestMergeCandidates, {})

  const [searchQuery, setSearchQuery] = useState('')
  const [minScoreFilter, setMinScoreFilter] = useState<number | 'all'>('all')

  const candidates: CandidateView[] = result?.candidates ?? []

  const filteredCandidates = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return candidates.filter((candidate) => {
      if (minScoreFilter !== 'all' && candidate.score < minScoreFilter) {
        return false
      }
      if (!query) {
        return true
      }
      const haystack = [
        candidate.left.name,
        candidate.right.name,
        candidate.left.externalId,
        candidate.right.externalId,
        candidate.left.identityKey,
        candidate.right.identityKey,
        candidate.left.contactSignals?.email,
        candidate.right.contactSignals?.email,
        candidate.left.contactSignals?.phone,
        candidate.right.contactSignals?.phone,
        candidate.left.contactSignals?.linkedin,
        candidate.right.contactSignals?.linkedin,
        ...candidate.evidence,
      ]
        .filter((part): part is string => Boolean(part))
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [candidates, minScoreFilter, searchQuery])

  if (result === undefined) {
    return (
      <div
        className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
        data-testid="resume-dedup-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('resumeDedup.loading', { defaultValue: 'Loading merge suggestions…' })}
      </div>
    )
  }

  const clearFilters = () => {
    setSearchQuery('')
    setMinScoreFilter('all')
  }

  const signalLine = (resume: ResumeSummaryView): string => {
    const parts: string[] = []
    if (resume.contactSignals?.email) {
      parts.push(resume.contactSignals.email)
    }
    if (resume.contactSignals?.phone) {
      parts.push(resume.contactSignals.phone)
    }
    if (resume.contactSignals?.linkedin) {
      parts.push(resume.contactSignals.linkedin)
    }
    return parts.length > 0 ? parts.join(' · ') : ''
  }

  const resumeCell = (resume: ResumeSummaryView) => (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{resume.name ?? '—'}</span>
        <Badge variant="outline" className="text-[10px]">
          {resume.source}
        </Badge>
      </div>
      {resume.externalId ? (
        <div className="font-mono text-xs text-muted-foreground">{resume.externalId}</div>
      ) : null}
      {resume.identityKey ? (
        <div className="max-w-[260px] truncate font-mono text-[10px] text-muted-foreground">
          {resume.identityKey}
        </div>
      ) : null}
      {signalLine(resume) ? (
        <div className="max-w-[260px] truncate text-xs text-muted-foreground">
          {signalLine(resume)}
        </div>
      ) : null}
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">
          {t('resumeDedup.title', { defaultValue: 'Resume dedup review' })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('resumeDedup.description', {
            defaultValue:
              'Suggested same-person matches across resume collection sources, scored from contact signals and content heuristics.',
          })}
        </p>
      </div>

      <Card data-testid="resume-dedup-section">
        <CardHeader>
          <CardTitle className="text-base">
            {t('resumeDedup.sectionTitle', { defaultValue: 'Suggested matches' })}
          </CardTitle>
          <CardDescription>
            {t('resumeDedup.sectionDescription', {
              defaultValue:
                'Advisory only — nothing here merges resumes or changes identity keys. Pair scores start at 1.5 and accumulate per matching signal.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {candidates.length === 0 ? (
            <div
              className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground"
              data-testid="resume-dedup-empty"
            >
              {t('resumeDedup.empty', {
                defaultValue:
                  'No suggested matches yet. Suggestions appear when resumes captured from different sources share contact signals (email, phone, LinkedIn) or strong content signals.',
              })}
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Input
                  type="search"
                  data-testid="resume-dedup-search-input"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t('resumeDedup.searchPlaceholder', {
                    defaultValue: 'Search candidates by name, contact, or evidence...',
                  })}
                  className="sm:max-w-xs"
                />
                <Select
                  data-testid="resume-dedup-min-score"
                  value={String(minScoreFilter)}
                  onChange={(event) => {
                    const value = event.target.value
                    setMinScoreFilter(value === 'all' ? 'all' : Number(value))
                  }}
                  options={[
                    { value: 'all', label: t('resumeDedup.allScores', { defaultValue: 'All Scores' }) },
                    { value: '2', label: t('resumeDedup.minScoreLabel', { score: '2.0', defaultValue: 'Score ≥ 2.0' }) },
                    { value: '4', label: t('resumeDedup.minScoreLabel', { score: '4.0', defaultValue: 'Score ≥ 4.0' }) },
                    { value: '6', label: t('resumeDedup.minScoreLabel', { score: '6.0', defaultValue: 'Score ≥ 6.0' }) },
                  ]}
                  className="sm:w-44"
                />
              </div>
              {filteredCandidates.length === 0 ? (
                <div
                  className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground"
                  data-testid="resume-dedup-no-matches"
                >
                  <p className="mb-3">
                    {t('resumeDedup.noMatches', {
                      defaultValue: 'No duplicate suggestions match your filter.',
                    })}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="resume-dedup-clear-filter"
                    onClick={clearFilters}
                  >
                    {t('resumeDedup.clearFilter', { defaultValue: 'Clear filter' })}
                  </Button>
                </div>
              ) : (
                <>
                  <p className="mb-4 text-xs text-muted-foreground">
                    {t('resumeDedup.scanned', { defaultValue: 'Blocking keys scanned' })}: {result.scannedBlocks}
                  </p>
                  <p className="mb-2 text-xs text-muted-foreground" data-testid="resume-dedup-count">
                    {t('resumeDedup.showingCount', {
                      shown: filteredCandidates.length,
                      total: candidates.length,
                      defaultValue: 'Showing {{shown}} of {{total}} candidate pairs',
                    })}
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('resumeDedup.score', { defaultValue: 'Score' })}</TableHead>
                        <TableHead>{t('resumeDedup.evidence', { defaultValue: 'Evidence' })}</TableHead>
                        <TableHead>{t('resumeDedup.leftResume', { defaultValue: 'Resume A' })}</TableHead>
                        <TableHead>{t('resumeDedup.rightResume', { defaultValue: 'Resume B' })}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCandidates.map((candidate) => (
                        <TableRow key={`${candidate.left.resumeId}|${candidate.right.resumeId}`} data-testid="resume-dedup-candidate-row">
                          <TableCell>
                            <span className="font-mono text-sm font-semibold">{candidate.score.toFixed(1)}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex max-w-xs flex-wrap gap-1">
                              {candidate.evidence.map((piece) => (
                                <Badge key={piece} variant="outline" className="text-[10px]">
                                  {piece}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>{resumeCell(candidate.left)}</TableCell>
                          <TableCell>{resumeCell(candidate.right)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
