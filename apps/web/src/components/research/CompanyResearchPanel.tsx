import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  isLiveResearchSignal,
  normalizeResearchPersona,
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
  ingestRunId?: string
}

export type SignalsMeta = {
  liveCount: number
  showcaseCount: number
  liveFirst?: boolean
}

export const RESEARCH_SIGNAL_KINDS = [
  'hiring_signal',
  'sales_trigger',
  'market_move',
  'company_mention',
] as const

export type CompanyResearchPanelProps = {
  companyKey: string
  /** Preferred display name (nameCn-first). */
  companyName?: string
  nameEn?: string
  companyType?: string
  signals: ResearchSignalView[]
  /** Server live/showcase counts; derived from signals when omitted. */
  meta?: SignalsMeta | null
  persona: ResearchPersona | string
  onPersonaChange?: (persona: ResearchPersona) => void
  selectedKinds?: string[]
  onSelectedKindsChange?: (kinds: string[]) => void
  loading?: boolean
  error?: string | null
  teamSlug?: string
  emptyExtra?: ReactNode
  className?: string
}

function isRealExternalUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (parsed.hostname === 'showcase.local' || parsed.hostname.endsWith('.local')) {
      return false
    }
    return true
  } catch {
    return false
  }
}

function SignalListItem({
  signal,
  index,
  companyKey,
  teamSlug,
  activePersona,
}: {
  signal: ResearchSignalView
  index: number
  companyKey: string
  teamSlug?: string
  activePersona: ResearchPersona
}) {
  const { t } = useTranslation()
  const key = signal._id ?? `${signal.kind}-${signal.capturedAt}-${index}`
  const evidenceUrl = signal.evidence.url
  const realEvidence = isRealExternalUrl(evidenceUrl)
  const live = isLiveResearchSignal(signal)
  const isShowcase = !live

  return (
    <li
      key={key}
      data-testid="company-research-signal"
      data-kind={signal.kind}
      data-live={live ? 'true' : 'false'}
      data-rank={index}
      className="rounded-md border border-slate-100 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{signal.kind}</Badge>
        {isShowcase ? (
          <Badge variant="outline" data-testid="company-research-showcase-badge">
            {t('research.showcaseBadge', { defaultValue: '展示数据' })}
          </Badge>
        ) : null}
        <span className="font-medium text-sm">{signal.title}</span>
      </div>
      {signal.summary ? (
        <p className="mt-1 text-sm text-muted-foreground">{signal.summary}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{signal.evidence.platform}</span>
        {realEvidence ? (
          <a
            href={evidenceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline"
            data-testid="company-research-evidence-link"
          >
            {t('research.evidenceLink', { defaultValue: '原文' })}
          </a>
        ) : isShowcase ? (
          <span className="text-muted-foreground" data-testid="company-research-evidence-seed">
            {t('research.evidenceSeed', { defaultValue: '种子证据（非外链）' })}
          </span>
        ) : null}
        {teamSlug ? (
          <Link
            to={`/${teamSlug}/research/${encodeURIComponent(companyKey)}?persona=${activePersona}`}
            className="text-blue-600 hover:underline"
            data-testid="company-research-self-link"
          >
            {t('research.openPage', { defaultValue: '研究页' })}
          </Link>
        ) : null}
      </div>
    </li>
  )
}

export function CompanyResearchPanel({
  companyKey,
  companyName,
  nameEn,
  companyType,
  signals,
  meta: metaProp,
  persona,
  onPersonaChange,
  selectedKinds,
  onSelectedKindsChange,
  loading = false,
  error = null,
  teamSlug,
  emptyExtra,
  className,
}: CompanyResearchPanelProps) {
  const { t } = useTranslation()
  const activePersona = normalizeResearchPersona(persona)

  // Server already live-first ranks; only apply kind filter here (do not re-rank whole list).
  const filtered = useMemo(() => {
    if (!selectedKinds?.length) {
      return signals
    }
    const set = new Set(selectedKinds)
    return signals.filter((s) => set.has(s.kind))
  }, [signals, selectedKinds])

  const liveSignals = useMemo(
    () => filtered.filter((s) => isLiveResearchSignal(s)),
    [filtered],
  )
  const showcaseSignals = useMemo(
    () => filtered.filter((s) => !isLiveResearchSignal(s)),
    [filtered],
  )

  const liveCount = metaProp?.liveCount ?? liveSignals.length
  const showcaseCount = metaProp?.showcaseCount ?? showcaseSignals.length

  const toggleKind = (kind: string) => {
    if (!onSelectedKindsChange) {
      return
    }
    const current = selectedKinds ?? []
    if (current.includes(kind)) {
      onSelectedKindsChange(current.filter((k) => k !== kind))
    } else {
      onSelectedKindsChange([...current, kind])
    }
  }

  const title =
    companyName?.trim() ||
    t('research.companyTitle', {
      defaultValue: '企业研究',
    })
  const subtitleParts = [nameEn, companyKey, companyType].filter(Boolean)

  return (
    <Card className={cn('w-full', className)} data-testid="company-research-panel">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle data-testid="company-research-title">{title}</CardTitle>
            <CardDescription data-testid="company-research-key">
              {subtitleParts.join(' · ')}
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
        {onSelectedKindsChange ? (
          <div
            className="flex flex-wrap gap-1"
            data-testid="kind-filter"
            role="group"
            aria-label={t('research.kindFilter', { defaultValue: 'Signal kinds' })}
          >
            {RESEARCH_SIGNAL_KINDS.map((kind) => {
              const active = (selectedKinds ?? []).includes(kind)
              return (
                <Button
                  key={kind}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  data-testid={`kind-filter-${kind}`}
                  data-active={active ? 'true' : 'false'}
                  onClick={() => toggleKind(kind)}
                >
                  {kind}
                </Button>
              )
            })}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
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
        {!loading && !error && liveCount === 0 && showcaseCount > 0 ? (
          <p
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            data-testid="research-live-empty-banner"
          >
            {t('research.liveEmptyBanner', {
              defaultValue:
                '当前仅有展示数据；运行抓取或等待热榜命中后显示实时信号。',
            })}
          </p>
        ) : null}
        {!loading && !error && filtered.length === 0 ? (
          <div data-testid="company-research-empty" className="space-y-2 text-sm text-muted-foreground">
            <p>
              {t('research.empty', { defaultValue: 'No research signals for this company yet.' })}
            </p>
            {emptyExtra}
          </div>
        ) : null}

        {!loading && !error && liveSignals.length > 0 ? (
          <div data-testid="research-section-live">
            <h3 className="mb-2 text-sm font-semibold">
              {t('research.sectionLive', { defaultValue: '实时信号' })}
              <span className="ml-2 text-xs font-normal text-muted-foreground">{liveSignals.length}</span>
            </h3>
            <ul className="space-y-3" data-testid="company-research-signal-list-live">
              {liveSignals.map((signal, index) => (
                <SignalListItem
                  key={signal._id ?? `live-${index}`}
                  signal={signal}
                  index={index}
                  companyKey={companyKey}
                  teamSlug={teamSlug}
                  activePersona={activePersona}
                />
              ))}
            </ul>
          </div>
        ) : null}

        {!loading && !error && showcaseSignals.length > 0 ? (
          <div data-testid="research-section-showcase">
            <h3 className="mb-2 text-sm font-semibold">
              {t('research.sectionShowcase', { defaultValue: '展示数据' })}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {showcaseSignals.length}
              </span>
            </h3>
            <ul className="space-y-3" data-testid="company-research-signal-list-showcase">
              {showcaseSignals.map((signal, index) => (
                <SignalListItem
                  key={signal._id ?? `seed-${index}`}
                  signal={signal}
                  index={index}
                  companyKey={companyKey}
                  teamSlug={teamSlug}
                  activePersona={activePersona}
                />
              ))}
            </ul>
          </div>
        ) : null}

        {/* Backward-compatible flat list testid when only one bucket empty */}
        {!loading && !error && filtered.length > 0 ? (
          <ul className="hidden" data-testid="company-research-signal-list" aria-hidden>
            {filtered.map((signal, index) => (
              <li key={signal._id ?? `all-${index}`}>{signal.title}</li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}
