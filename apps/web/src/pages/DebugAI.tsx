import { useEffect, useMemo, useState } from 'react'
import {
  DEBUG_AI_BREAKDOWN_LABELS,
  DEBUG_AI_KEYWORD_PROMPT_VARIANT,
  getResumeAiPromptDefinition,
  sanitizeResumeRecordForSurface,
  type ResumeFieldUsagePolicy,
} from '@trends/shared'
import { useQuery } from 'convex/react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../../packages/convex/convex/_generated/api'
import type { Doc } from '../../../../packages/convex/convex/_generated/dataModel'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/PageHeader'
import { useResumeFieldUsagePolicy } from '@/contexts/ResumeFieldUsagePolicyContext'

type ResumeDoc = Doc<'resumes'>
type BreakdownKey = 'experience' | 'skills' | 'industry_db' | 'education' | 'location'

type ScoreBreakdown = Record<BreakdownKey, number>
const BREAKDOWN_KEYS: BreakdownKey[] = DEBUG_AI_BREAKDOWN_LABELS.map((item) => item.key as BreakdownKey)

const EMPTY_BREAKDOWN: ScoreBreakdown = {
  experience: 0,
  skills: 0,
  industry_db: 0,
  education: 0,
  location: 0,
}

const BREAKDOWN_LABELS = new Map(
  DEBUG_AI_BREAKDOWN_LABELS.map((item) => [item.key as BreakdownKey, item])
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toScore(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function parseBreakdownCandidate(candidate: unknown): ScoreBreakdown | null {
  if (!isRecord(candidate)) {
    return null
  }

  const rawBreakdown = candidate['breakdown']
  if (!isRecord(rawBreakdown)) {
    return null
  }

  return {
    experience: clampScore(toScore(rawBreakdown['related_exp'] ?? rawBreakdown['experience']) ?? 0),
    skills: clampScore(toScore(rawBreakdown['skills']) ?? 0),
    industry_db: clampScore(toScore(rawBreakdown['industry_db']) ?? 0),
    education: clampScore(toScore(rawBreakdown['education']) ?? 0),
    location: clampScore(toScore(rawBreakdown['location']) ?? 0),
  }
}

function extractBreakdown(resume: ResumeDoc | null): ScoreBreakdown {
  if (!resume) {
    return EMPTY_BREAKDOWN
  }

  const directBreakdown = parseBreakdownCandidate(resume.analysis)
  if (directBreakdown) {
    return directBreakdown
  }

  if (!isRecord(resume.analyses)) {
    return EMPTY_BREAKDOWN
  }

  const defaultBreakdown = parseBreakdownCandidate(resume.analyses['default'])
  if (defaultBreakdown) {
    return defaultBreakdown
  }

  for (const analysis of Object.values(resume.analyses)) {
    const parsed = parseBreakdownCandidate(analysis)
    if (parsed) {
      return parsed
    }
  }

  return EMPTY_BREAKDOWN
}

function readTextField(source: unknown, key: string): string | null {
  if (!isRecord(source)) {
    return null
  }

  const value = source[key]
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  return null
}

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
