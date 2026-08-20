import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'
import { rawApiClient } from '@/lib/api-helpers'
import { isModEnterKey } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type CandidateExplanation = {
  identityKey: string
  summary: string
  keyFactors: Array<{ factor: string; value: string }>
  decidedAt: number
  decisionType: string
  scrubbedFields?: string[]
  protectedAttributesExcluded: boolean
}

type ExplanationResponse = {
  success: boolean
  data?: CandidateExplanation | null
  error?: string
}

function useExplanation(resumeId: string, workspaceSlug: string) {
  const [data, setData] = useState<CandidateExplanation | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!resumeId || !workspaceSlug) return
    setLoading(true)
    setError(null)
    const { data: result, error: apiError } = await rawApiClient.POST<ExplanationResponse>(
      '/api/resumes/explanation',
      { body: { resumeId, workspaceSlug } },
    )
    if (apiError || !result?.success) {
      setError(result?.error ?? 'Failed to load explanation')
      setLoading(false)
      return
    }
    setData(result.data ?? null)
    setLoading(false)
  }, [resumeId, workspaceSlug])

  useEffect(() => {
    void load()
  }, [load])

  return { data, loading, error, reload: load }
}

function formatFactorName(factor: string): string {
  return factor
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function AppealForm({ resumeId, identityKey }: { resumeId: string; identityKey: string }) {
  const { t } = useTranslation('explanationPage')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(async () => {
    setSubmitting(true)
    setError(null)
    try {
      const { error: apiError } = await rawApiClient.POST('/api/candidate-appeal', {
        body: {
          resumeId,
          identityKey,
          reason: reason.trim() || undefined,
        },
      })
      if (apiError) {
        setError(t('appeal.error', { defaultValue: 'Failed to submit appeal. Please try again.' }))
        setSubmitting(false)
        return
      }
      setSubmitted(true)
    } catch {
      setError(t('appeal.error', { defaultValue: 'Failed to submit appeal. Please try again.' }))
    } finally {
      setSubmitting(false)
    }
  }, [resumeId, identityKey, reason, t])

  if (submitted) {
    return (
      <div className="space-y-2" data-testid="appeal-submitted">
        <p className="text-sm font-medium text-green-700 dark:text-green-400">
          {t('appeal.success', { defaultValue: 'Your appeal has been submitted. A qualified person will review your application.' })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('appeal.nextSteps', { defaultValue: 'You will be notified of the review outcome.' })}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Textarea
        placeholder={t('appeal.placeholder', { defaultValue: 'Optional: explain why you believe this decision should be reviewed...' })}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (isModEnterKey(e)) {
            e.preventDefault()
            void handleSubmit()
          }
        }}
        rows={3}
        maxLength={2000}
        data-testid="appeal-reason"
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t('appeal.shortcutHint', { defaultValue: 'Ctrl/⌘ + Enter to submit' })}</span>
        <span data-testid="appeal-character-count">{reason.length}/2000</span>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        onClick={handleSubmit}
        disabled={submitting}
        data-testid="request-human-review"
      >
        {submitting
          ? t('appeal.submitting', { defaultValue: 'Submitting...' })
          : t('rights.requestReview', { defaultValue: 'Request Human Review' })}
      </Button>
    </div>
  )
}

export function CandidateExplanationPage() {
  const { t } = useTranslation('explanationPage')
  const { resumeId = '' } = useParams<{ resumeId: string }>()
  const [searchParams] = useSearchParams()
  const workspaceSlug = searchParams.get('workspace') ?? ''

  const { data, loading, error, reload } = useExplanation(resumeId, workspaceSlug)

  if (!resumeId || !workspaceSlug) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>{t('missingId.title', { defaultValue: 'Invalid Link' })}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t('missingId.description', {
                defaultValue: 'This explanation link is missing required information. Please contact the employer for a valid link.',
              })}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">
          {t('loading', { defaultValue: 'Loading your application status...' })}
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>{t('error.title', { defaultValue: 'Unable to Load' })}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t('error.description', {
                defaultValue: 'We could not load the explanation for this application. Please try again later.',
              })}
            </p>
            <Button variant="outline" className="mt-4" onClick={reload}>
              {t('common.retry', { defaultValue: 'Retry' })}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>{t('noData.title', { defaultValue: 'No Explanation Available' })}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t('noData.description', {
                defaultValue: 'An explanation for this application decision is not currently available. You have the right to request one from the employer.',
              })}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const decisionLabel = t(`decisionType.${data.decisionType}`, {
    defaultValue: data.decisionType === 'score' ? 'Scored' : data.decisionType,
  })

  return (
    <div className="min-h-screen bg-background p-4 sm:p-8" data-testid="candidate-explanation-page">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Layer 1: Summary */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge variant="outline" data-testid="decision-badge">
                {t('summary.status', { defaultValue: 'Application Status' })}: {decisionLabel}
              </Badge>
            </div>
            <CardTitle className="text-xl">
              {t('summary.title', { defaultValue: 'Your Application Status' })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm leading-relaxed" data-testid="summary-text">
              {data.summary}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('summary.decidedAt', { defaultValue: 'Decision made' })}:{' '}
              {new Date(data.decidedAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          </CardContent>
        </Card>

        {/* Layer 2: Key Factors */}
        {data.keyFactors.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t('factors.title', { defaultValue: 'Key Factors' })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                {t('factors.description', {
                  defaultValue: 'These are the main factors that influenced this decision.',
                })}
              </p>
              <Table data-testid="factors-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('factors.factor', { defaultValue: 'Factor' })}</TableHead>
                    <TableHead>{t('factors.value', { defaultValue: 'Value' })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.keyFactors.map((f) => (
                    <TableRow key={f.factor}>
                      <TableCell className="text-sm">{formatFactorName(f.factor)}</TableCell>
                      <TableCell className="text-sm font-mono">{f.value}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Layer 3: AI Safeguards & Rights */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('safeguards.title', { defaultValue: 'AI Safeguards' })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('safeguards.description', {
                defaultValue: 'This decision was assisted by AI with the following safeguards in place:',
              })}
            </p>
            <ul className="text-sm space-y-1 list-disc list-inside">
              <li>{t('safeguards.biasAudit', { defaultValue: 'Weekly bias audit monitoring' })}</li>
              <li>{t('safeguards.humanOversight', { defaultValue: 'Human oversight tracking' })}</li>
              <li>{t('safeguards.anomalyDetection', { defaultValue: 'Anomaly detection for score drift' })}</li>
            </ul>
            {data.protectedAttributesExcluded && (
              <p className="text-xs text-muted-foreground mt-2" data-testid="protected-attributes-note">
                {t('safeguards.protectedExcluded', {
                  defaultValue: 'Protected attributes (e.g., age, gender) were excluded from the decision process.',
                })}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Rights & Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('rights.title', { defaultValue: 'Your Rights' })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('rights.description', {
                defaultValue: 'You have the right to request human review of this decision. A qualified person will re-evaluate your application independently.',
              })}
            </p>
            <AppealForm
              resumeId={resumeId}
              identityKey={data.identityKey}
            />
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-xs text-center text-muted-foreground pb-4">
          {t('footer.compliance', {
            defaultValue: 'This explanation is provided in compliance with EU AI Act Article 13.',
          })}
        </p>
      </div>
    </div>
  )
}
