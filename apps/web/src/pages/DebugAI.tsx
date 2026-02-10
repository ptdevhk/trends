import { useEffect, useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import type { Doc } from '../../../../packages/convex/convex/_generated/dataModel'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

const SYSTEM_PROMPT = `你是一个专业的HR助手，专门帮助筛选精密机械和机床行业的简历。
你必须严格按照【纯数字 JSON】格式返回结果。
1. 绝对不要包含 markdown 标记 (如 \`\`\`json ... \`\`\`)。
2. 所有评分字段（score, breakdown.*）必须是【JSON Number 类型】，绝对禁止使用字符串或中文数字（如 "30", "三十", thirty）。
3. 正确示例: "score": 85
4. 错误示例: "score": "85", "score": "eighty-five"
5. 如果无法确切评分，请基于现有信息估算一个数字。`

const USER_PROMPT_TEMPLATE = `请分析以下候选人与职位的匹配度：

## 职位信息
**职位名称**: {jobTitle}
**职位要求**:
{requirements}

## 评分规则 (权重与标准)
{matchingRules}

## 候选人信息
**姓名**: {candidateName}
**求职意向**: {jobIntention}
**工作经验**: {workExperience}年
**学历**: {education}
**技能**: {skills}
**曾任职公司**: {companies}
**简介**: {summary}

请以JSON格式返回分析结果，确保 score 为数字类型：
{
  "score": 30, // 必须是0-100的整数数字 (Number)，不要加引号
  "breakdown": {
    "experience": 10, // 数字
    "skills": 5, // 数字
    "industry_db": 5, // 数字
    "education": 5, // 数字
    "location": 5 // 数字
  },
  "recommendation": "strong_match" | "match" | "potential" | "no_match",
  "highlights": ["匹配亮点1", ...],
  "concerns": ["不足之处1", ...],
  "summary": "中文总结"
}`

type ResumeDoc = Doc<'resumes'>
type BreakdownKey = 'experience' | 'skills' | 'industry_db' | 'education' | 'location'

type ScoreBreakdown = Record<BreakdownKey, number>
const BREAKDOWN_KEYS: BreakdownKey[] = ['experience', 'skills', 'industry_db', 'education', 'location']

const BREAKDOWN_LABELS: Record<BreakdownKey, string> = {
  experience: 'Experience',
  skills: 'Skills',
  industry_db: 'Industry DB',
  education: 'Education',
  location: 'Location',
}

const EMPTY_BREAKDOWN: ScoreBreakdown = {
  experience: 0,
  skills: 0,
  industry_db: 0,
  education: 0,
  location: 0,
}

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
    experience: clampScore(toScore(rawBreakdown['experience']) ?? 0),
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

function buildResumeLabel(resume: ResumeDoc): string {
  const name = readTextField(resume.content, 'name') ?? 'Unknown Candidate'
  const intention = readTextField(resume.content, 'jobIntention') ?? readTextField(resume.content, 'desiredPosition')

  if (!intention) {
    return name
  }

  return `${name} · ${intention}`
}

export default function DebugAI() {
  const resumeDocs = useQuery(api.resumes.list, { limit: 50 })
  const resumes = useMemo(() => resumeDocs ?? [], [resumeDocs])

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
      { value: '', label: 'Select a resume' },
      ...resumes.map((resume) => ({
        value: String(resume._id),
        label: buildResumeLabel(resume),
      })),
    ],
    [resumes],
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
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Debug AI</h1>
        <p className="text-sm text-muted-foreground">Inspect prompt templates and resume analysis output from Convex.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Prompt Templates</CardTitle>
          <CardDescription>Display-only templates copied from `packages/convex/convex/analyze.ts`.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">SYSTEM_PROMPT</h2>
            <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-4 text-xs leading-relaxed">{SYSTEM_PROMPT}</pre>
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">USER_PROMPT_TEMPLATE</h2>
            <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-4 text-xs leading-relaxed">{USER_PROMPT_TEMPLATE}</pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resume Selector + Raw Output</CardTitle>
          <CardDescription>Select one resume and inspect `analysis` and `analyses` fields.</CardDescription>
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
            {analysisJson ?? 'Select a resume to inspect analysis output.'}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Score Breakdown Visualization</CardTitle>
          <CardDescription>Breakdown from `analysis.breakdown` (fallback to first valid `analyses[*].breakdown`).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {BREAKDOWN_KEYS.map((key) => {
              const score = scoreBreakdown[key]
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{BREAKDOWN_LABELS[key]}</span>
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
