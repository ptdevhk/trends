import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Briefcase,
  Calendar,
  ExternalLink,
  GraduationCap,
  MapPin,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { ResumeItem } from '@/hooks/useResumes'

const JOB_KEYWORDS = [
  '\u603b\u88c1',
  'CEO',
  'CTO',
  'CFO',
  'COO',
  '\u603b\u7ecf\u7406',
  '\u603b\u76d1',
  '\u7ecf\u7406',
  '\u4e3b\u7ba1',
  '\u4e13\u5458',
  '\u52a9\u7406',
  '\u5de5\u7a0b\u5e08',
  '\u987e\u95ee',
  '\u4ee3\u8868',
  '\u9500\u552e',
  '\u5e02\u573a',
  '\u8fd0\u8425',
  '\u9879\u76ee',
  '\u4ea7\u54c1',
  '\u8bbe\u8ba1',
  '\u5f00\u53d1',
  '\u7814\u53d1',
  '\u5ba2\u670d',
  '\u6587\u5458',
  '\u53f8\u673a',
  '\u4f1a\u8ba1',
  '\u8d22\u52a1',
  '\u4eba\u4e8b',
  '\u884c\u653f',
  '\u6559\u5e08',
  '\u8bb2\u5e08',
  '\u533b\u751f',
  '\u62a4\u58eb',
  '\u5f8b\u5e08',
  '\u91c7\u8d2d',
  '\u7269\u6d41',
  '\u4ed3\u50a8',
  '\u751f\u4ea7',
  '\u5236\u9020',
  '\u8d28\u91cf',
  '\u6d4b\u8bd5',
  '\u5546\u52a1',
  '\u6cd5\u52a1',
  '\u6280\u5e08',
  '\u5de5\u827a',
]

const salaryTokenPattern =
  /^\d+(\s*[-~\u5230]\s*\d+)?(\u5143\/?\u6708|\u5143)?$/

interface ParsedJobIntention {
  locations: string[]
  positions: string[]
  salary: string
  raw: string
}

interface ResumeCardProps {
  item: ResumeItem
  selected: boolean
  onSelect: (checked: boolean) => void
  onViewDetails: (resume: ResumeItem) => void
}

function normalizeIntention(value: string): string {
  return value
    .replace(/^[\uFF1A:\s]+/, '')
    .replace(/(?:\uFF08[^\uFF09]*\uFF09|\([^)]*\))\s*$/g, '')
    .trim()
}

function findKeywordIndex(text: string): number {
  let earliest = -1
  for (const keyword of JOB_KEYWORDS) {
    const index = text.indexOf(keyword)
    if (index >= 0 && (earliest === -1 || index < earliest)) {
      earliest = index
    }
  }
  return earliest
}

function parseJobIntention(value?: string): ParsedJobIntention {
  if (!value) {
    return { locations: [], positions: [], salary: '', raw: '' }
  }

  const normalized = normalizeIntention(value)
  if (!normalized) {
    return { locations: [], positions: [], salary: '', raw: '' }
  }

  const tokens = normalized.split(/\s+/).filter(Boolean)
  let salary = ''
  let body = normalized

  if (tokens.length > 1) {
    const candidate = tokens[tokens.length - 1]
    if (
      /\u9762\u8bae|\u9762\u8b70/.test(candidate) ||
      salaryTokenPattern.test(candidate)
    ) {
      salary = candidate
      body = tokens.slice(0, -1).join(' ')
    }
  }

  const parts = body
    .split(/[\uFF0C,]/)
    .map((part) => part.trim())
    .filter(Boolean)

  const locations: string[] = []
  const positions: string[] = []
  let positionStarted = false

  parts.forEach((part) => {
    if (positionStarted) {
      positions.push(part)
      return
    }

    const keywordIndex = findKeywordIndex(part)
    if (keywordIndex === -1) {
      const suffixMatch = part.match(
        /^(.*?(?:\u7701|\u5e02|\u533a|\u53bf|\u9547|\u9109|\u4e61|\u5dde|\u76df|\u65d7|\u81ea\u6cbb\u5340|\u81ea\u6cbb\u533a|\u7279\u5225\u884c\u653f\u5340|\u7279\u522b\u884c\u653f\u533a))(.+)$/
      )
      if (suffixMatch) {
        const location = suffixMatch[1].trim()
        const position = suffixMatch[2].trim()
        if (location) locations.push(location)
        if (position) positions.push(position)
        positionStarted = true
        return
      }

      locations.push(part)
      return
    }

    if (keywordIndex > 0) {
      const location = part.slice(0, keywordIndex)
      if (location) locations.push(location)
    }

    const position = part.slice(keywordIndex)
    if (position) positions.push(position)
    positionStarted = true
  })

  return {
    locations: Array.from(new Set(locations)),
    positions: Array.from(new Set(positions)),
    salary,
    raw: body,
  }
}

function getActivityAppearance(status: string | undefined, fallback: string) {
  const label = status?.trim() || fallback
  const normalized = label.replace(/\s+/g, '')

  if (/\u521a\u521a|\u525b\u525b/.test(normalized)) {
    return {
      label,
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    }
  }

  if (/24|\u4e00\u5929|\u4eca\u65e5|\u4eca\u5929|\u7576\u5929/.test(normalized)) {
    return {
      label,
      className: 'border-sky-200 bg-sky-50 text-sky-700',
    }
  }

  if (/\u672c\u5468|\u672c\u9031|\u4e00\u5468|\u4e00\u9031|7\u5929|\u4e03\u5929/.test(normalized)) {
    return {
      label,
      className: 'border-slate-200 bg-slate-50 text-slate-600',
    }
  }

  return {
    label,
    className: 'border-border bg-muted text-muted-foreground',
  }
}

export function ResumeCard({ item, selected, onSelect, onViewDetails }: ResumeCardProps) {
  const { t } = useTranslation()

  const parsedIntention = useMemo(
    () => parseJobIntention(item.jobIntention),
    [item.jobIntention]
  )

  const intentionText = useMemo(() => {
    const locationText = parsedIntention.locations.join('\u3001')
    const positionText = parsedIntention.positions.join('\u3001')
    const merged = [locationText, positionText]
      .filter(Boolean)
      .join(` \u00b7 `)
    if (merged) return merged
    if (parsedIntention.raw) return parsedIntention.raw
    return t('resumes.card.intentionEmpty')
  }, [parsedIntention, t])

  const salaryText = useMemo(() => {
    const expectedSalary = item.expectedSalary?.trim()
    const parsedSalary = parsedIntention.salary.trim()

    if (/\u9762\u8bae|\u9762\u8b70/.test(parsedSalary)) {
      return t('resumes.card.salaryNegotiable')
    }

    if (expectedSalary) {
      if (!parsedSalary) return expectedSalary
      if (expectedSalary.includes(parsedSalary)) return expectedSalary
    }

    if (parsedSalary) return parsedSalary
    return t('resumes.card.salaryNegotiable')
  }, [item.expectedSalary, parsedIntention.salary, t])

  const activity = useMemo(
    () => getActivityAppearance(item.activityStatus, t('resumes.card.activityStale')),
    [item.activityStatus, t]
  )

  const demographics = useMemo(
    () =>
      [
        { icon: Calendar, value: item.age },
        { icon: Briefcase, value: item.experience },
        { icon: GraduationCap, value: item.education },
        { icon: MapPin, value: item.location },
      ].filter((entry) => entry.value),
    [item.age, item.education, item.experience, item.location]
  )

  const workHistory = useMemo(() => {
    if (!item.workHistory?.length) return []
    return item.workHistory.filter((entry) => entry.raw)
  }, [item.workHistory])

  const avatarInitial = item.name?.trim() ? item.name.trim().slice(0, 1) : '?'

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="border-b border-border/60 bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{t('resumes.columns.intention')}</p>
            <p className="text-sm font-medium text-foreground" title={intentionText}>
              {intentionText}
            </p>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 border-border bg-background text-xs text-muted-foreground"
          >
            {salaryText}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1 px-4 pt-4">
        <div className="flex items-start gap-3">
          <Checkbox
            checked={selected}
            onCheckedChange={(value) => onSelect(Boolean(value))}
            aria-label={t('resumes.columns.select')}
            className="mt-1"
          />
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
            {avatarInitial}
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{item.name || '--'}</p>
                {item.profileUrl ? (
                  <a
                    className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    href={item.profileUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('resumes.detail.profileLink')}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
              <Badge
                variant="outline"
                className={cn('border', activity.className)}
              >
                {activity.label}
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {demographics.length > 0 ? (
                demographics.map((entry, index) => {
                  const Icon = entry.icon
                  return (
                    <span key={`${entry.value}-${index}`} className="inline-flex items-center gap-1">
                      <Icon className="h-3.5 w-3.5" />
                      <span>{entry.value}</span>
                    </span>
                  )
                })
              ) : (
                <span>--</span>
              )}
            </div>

            {workHistory.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t('resumes.detail.workHistory')}</p>
                <div className="space-y-3 border-l border-border/70 pl-4">
                  {workHistory.map((entry, index) => (
                    <div key={`${item.name}-${index}`} className="relative text-sm text-foreground/80">
                      <span className="absolute -left-[9px] top-2 h-2 w-2 rounded-full bg-muted-foreground" />
                      <p className="leading-relaxed">{entry.raw}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>

      <CardFooter className="border-t border-border/60 px-4 py-3">
        <div className="flex w-full items-center justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onViewDetails(item)}
          >
            {t('resumes.actions.view')}
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
