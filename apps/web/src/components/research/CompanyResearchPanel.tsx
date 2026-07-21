import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  normalizeResearchPersona,
  rankSignalsForPersona,
  type ResearchPersona,
} from '@trends/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type ResearchSignalView = {
  _id?: string
  companyKey: string
  kind: string
  title: string
  summary?: string
  evidence: {
    newsItemId?: string
    title: string
    url?: string
    platform: string
    seenAt: number
    snippet?: string
  }
  score?: number
  capturedAt: number
}

export type CompanyResearchPanelProps = {
  companyKey: string
  signals: ResearchSignalView[]
  persona: ResearchPersona | string
  onPersonaChange?: (persona: ResearchPersona) => void
  loading?: boolean
  error?: string | null
  teamSlug?: string
  className?: string
}

export function CompanyResearchPanel({
  companyKey,
  signals,
  persona,
  onPersonaChange,
  loading = false,
  error = null,
  teamSlug,
  className,
}: CompanyResearchPanelProps) {
  const { t } = useTranslation()
  const activePersona = normalizeResearchPersona(persona)
  const ranked = useMemo(
    () => rankSignalsForPersona(signals, activePersona),
    [signals, activePersona],
  )

  return (
    <Card className={cn('w-full', className)} data-testid="company-research-panel">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle data-testid="company-research-title">
              {t('research.companyTitle', {
                defaultValue: 'Company research',
              })}
            </CardTitle>
            <CardDescription data-testid="company-research-key">
              {companyKey}
            </CardDescription>
          </div>
          <div
            className="inline-flex rounded-md border border-slate-200 p-0.5"
            data-testid="persona-toggle"
            role="group"
            aria-label={t('research.personaToggle', { defaultValue: 'Persona' })}
          >
            {(['hr', 'sales'] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={activePersona === value ? 'default' : 'ghost'}
                data-testid={`persona-${value}`}
                data-active={activePersona === value ? 'true' : 'false'}
                onClick={() => onPersonaChange?.(value)}
              >
                {value === 'hr'
                  ? t('research.personaHr', { defaultValue: 'HR' })
                  : t('research.personaSales', { defaultValue: 'Sales' })}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p data-testid="company-research-loading" className="text-sm text-muted-foreground">
            {t('research.loading', { defaultValue: 'Loading signals…' })}
          </p>
        ) : null}
        {error ? (
          <p data-testid="company-research-error" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
        {!loading && !error && ranked.length === 0 ? (
          <p data-testid="company-research-empty" className="text-sm text-muted-foreground">
            {t('research.empty', { defaultValue: 'No research signals for this company yet.' })}
          </p>
        ) : null}
        <ul className="space-y-3" data-testid="company-research-signal-list">
          {ranked.map((signal, index) => {
            const key = signal._id ?? `${signal.kind}-${signal.capturedAt}-${index}`
            const evidenceUrl = signal.evidence.url
            return (
              <li
                key={key}
                data-testid="company-research-signal"
                data-kind={signal.kind}
                data-rank={index}
                className="rounded-md border border-slate-100 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{signal.kind}</Badge>
                  <span className="font-medium text-sm">{signal.title}</span>
                </div>
                {signal.summary ? (
                  <p className="mt-1 text-sm text-muted-foreground">{signal.summary}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{signal.evidence.platform}</span>
                  {evidenceUrl ? (
                    <a
                      href={evidenceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline"
                      data-testid="company-research-evidence-link"
                    >
                      {t('research.evidenceLink', { defaultValue: 'Evidence' })}
                    </a>
                  ) : null}
                  {teamSlug ? (
                    <Link
                      to={`/${teamSlug}/research/${encodeURIComponent(companyKey)}?persona=${activePersona}`}
                      className="text-blue-600 hover:underline"
                    >
                      {t('research.openPage', { defaultValue: 'Open page' })}
                    </Link>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
