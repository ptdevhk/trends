import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DEBUG_AI_BREAKDOWN_LABELS,
  DEBUG_AI_KEYWORD_PROMPT_VARIANT,
  getResumeAiPromptDefinition,
  isRecord,
  sanitizeResumeRecordForSurface,
  type ResumeFieldUsagePolicy,
} from '@trends/shared'
import { useQuery } from 'convex/react'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../../../packages/convex/convex/_generated/api'
import type { Doc } from '../../../../packages/convex/convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/PageHeader'
import { useResumeFieldUsagePolicy } from '@/contexts/ResumeFieldUsagePolicyContext'
import {
  type BreakdownKey,
  extractBreakdown,
  readTextField,
} from '@/lib/debug-ai-score-utils'

type ResumeDoc = Doc<'resumes'>

const BREAKDOWN_KEYS: BreakdownKey[] = DEBUG_AI_BREAKDOWN_LABELS.map((item) => item.key as BreakdownKey)

const BREAKDOWN_LABELS = new Map(
  DEBUG_AI_BREAKDOWN_LABELS.map((item) => [item.key as BreakdownKey, item])
)

function buildResumeLabel(
  resume: ResumeDoc,
  unknownCandidateLabel: string,
  policy: ResumeFieldUsagePolicy,
): string {
  const content = sanitizeResumeRecordForSurface(
    isRecord(resume.content) ? resume.content : {},
    'debug',
    policy,
  )
  const name = readTextField(content, 'name') ?? unknownCandidateLabel
  const intention = readTextField(content, 'jobIntention') ?? readTextField(content, 'desiredPosition')

  if (!intention) {
    return name
  }

  return `${name} · ${intention}`
}

export default function DebugAI() {
  const { t, i18n } = useTranslation()
  const fieldUsagePolicy = useResumeFieldUsagePolicy()
  const resumeDocs = useQuery(api.resumes.list, { limit: 50 })
  const resumes = useMemo(() => resumeDocs ?? [], [resumeDocs])
  const promptDefinition = useMemo(() => getResumeAiPromptDefinition(i18n.resolvedLanguage), [i18n.resolvedLanguage])

  const [selectedResumeId, setSelectedResumeId] = useState('')

  const selectedResume = useMemo(
    () => resumes.find((resume) => String(resume._id) === selectedResumeId) ?? null,
    [resumes, selectedResumeId],
  )

  useEffect(() => {
    if (selectedResumeId && !selectedResume) {
      setSelectedResumeId('')
    }
  }, [selectedResume, selectedResumeId])

  const resumeOptions = useMemo(
    () => [
      { value: '', label: t('debugAi.selectResumePlaceholder') },
      ...resumes.map((resume) => ({
        value: String(resume._id),
        label: buildResumeLabel(resume, t('debugAi.unknownCandidate'), fieldUsagePolicy),
      })),
    ],
    [fieldUsagePolicy, resumes, t],
  )

  const analysisJson = useMemo(() => {
    if (!selectedResume) {
      return null
    }

    return JSON.stringify(
      {
        analysis: selectedResume.analysis ?? null,
        analyses: selectedResume.analyses ?? null,
      },
      null,
      2,
    )
  }, [selectedResume])

  const scoreBreakdown = useMemo(() => extractBreakdown(selectedResume), [selectedResume])

  const handleCopyJson = useCallback(() => {
    if (!analysisJson) return
    navigator.clipboard.writeText(analysisJson).then(() => {
      toast.success(t('debugAi.jsonCopied', 'JSON copied'))
    }).catch(() => {
      toast.error(t('debugAi.copyFailed', '复制失败'))
    })
  }, [analysisJson, t])

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('debugAi.title')}
        description={t('debugAi.subtitle')}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('debugAi.promptSection')}</CardTitle>
          <CardDescription>{t('debugAi.promptSectionDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">{t('debugAi.systemPrompt')}</h2>
            <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-4 text-xs leading-relaxed">{promptDefinition.sections.systemPrompt}</pre>
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">{t('debugAi.userPrompt')}</h2>
            <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-4 text-xs leading-relaxed">{promptDefinition.normalized.userPromptTemplate}</pre>
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">{DEBUG_AI_KEYWORD_PROMPT_VARIANT.title}</h2>
            <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-4 text-xs leading-relaxed">{DEBUG_AI_KEYWORD_PROMPT_VARIANT.body}</pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('debugAi.resumeOutputSection')}</CardTitle>
          <CardDescription>{t('debugAi.resumeOutputSectionDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {resumeDocs === undefined ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Select
              value={selectedResumeId}
              onChange={(event) => setSelectedResumeId(event.target.value)}
              options={resumeOptions}
            />
          )}

          <pre className="min-h-56 overflow-auto rounded-md border bg-muted/40 p-4 text-xs leading-relaxed">
            {analysisJson ?? t('debugAi.noAnalysis')}
          </pre>
          {analysisJson && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={handleCopyJson}>
                <Copy className="h-3 w-3" />
                {t('debugAi.copyJson', 'Copy')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('debugAi.scoreBreakdown')}</CardTitle>
          <CardDescription>{t('debugAi.scoreBreakdownDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {BREAKDOWN_KEYS.map((key) => {
              const score = scoreBreakdown[key]
              const label = BREAKDOWN_LABELS.get(key)
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{t(label?.labelKey ?? key, { defaultValue: label?.defaultLabel ?? key })}</span>
                    <span className="font-mono text-xs text-muted-foreground">{score}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${score}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
