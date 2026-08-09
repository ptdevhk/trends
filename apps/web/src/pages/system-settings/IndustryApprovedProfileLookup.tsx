import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { reportUiError } from '@/lib/ui-error-reporting'
import {
  formatDate,
  parseBundle,
  parseItems,
  type IndustryBundle,
  type ReviewedProfileSummary,
} from './industry-verification-model'

/**
 * Read-only lookup for already-approved (or rejected) company truth.
 * Uses the same company-industry-bundles path the proposal detail pane uses.
 * Does not open the attended approval controls.
 */
export function IndustryApprovedProfileLookup({
  requestJson,
}: {
  requestJson: (path: string, init?: RequestInit) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lookedUpKey, setLookedUpKey] = useState<string | null>(null)
  const [bundle, setBundle] = useState<IndustryBundle>({ profile: null, revisions: [], sources: [] })
  const [approvedList, setApprovedList] = useState<ReviewedProfileSummary[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        // Prefer verified profiles for the quick picker; fall back to full list.
        const payload = await requestJson('/api/company-industry-profiles?verificationLevel=verified')
        const items = parseItems<ReviewedProfileSummary>(payload)
        if (!cancelled) setApprovedList(items)
      } catch (err) {
        reportUiError('Failed to load approved industry profiles', err)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [requestJson])

  const runLookup = useCallback(
    async (rawKey: string) => {
      const companyKey = rawKey.trim()
      if (!companyKey) {
        toast.error(
          t('industryEvidence.lookupKeyRequired', {
            defaultValue: 'Enter a companyKey (e.g. eonmetall-group)',
          }),
        )
        return
      }
      setLoading(true)
      setError(null)
      try {
        const payload = await requestJson(
          `/api/company-industry-bundles/${encodeURIComponent(companyKey)}`,
        )
        const next = parseBundle(payload)
        if (!next.profile && next.revisions.length === 0 && next.sources.length === 0) {
          setBundle({ profile: null, revisions: [], sources: [] })
          setLookedUpKey(companyKey)
          setError(
            t('industryEvidence.lookupEmpty', {
              defaultValue: `No profile, revisions, or sources for “${companyKey}”.`,
              companyKey,
            }),
          )
          return
        }
        setBundle(next)
        setLookedUpKey(companyKey)
      } catch (err) {
        reportUiError('Failed to look up industry profile bundle', err)
        setError(
          t('industryEvidence.lookupFailed', {
            defaultValue: 'Lookup failed — check companyKey and try again.',
          }),
        )
        setBundle({ profile: null, revisions: [], sources: [] })
        setLookedUpKey(companyKey)
      } finally {
        setLoading(false)
      }
    },
    [requestJson, t],
  )

  const approvedSources = useMemo(
    () =>
      bundle.sources.filter(
        (s) => s.reviewStatus === 'approved' || s.sourceState === 'active',
      ),
    [bundle.sources],
  )

  return (
    <Card data-testid="industry-approved-profile-lookup">
      <CardHeader>
        <CardTitle>
          {t('industryEvidence.approvedLookupTitle', {
            defaultValue: 'Approved profiles / companyKey lookup',
          })}
        </CardTitle>
        <CardDescription>
          {t('industryEvidence.approvedLookupDescription', {
            defaultValue:
              'Inspect current truth for an employer that is not in the ready-for-review queue (e.g. MY bootstrap). Same bundle API as proposal detail — read-only.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            // Prefer the live DOM value so browser automation / paste still works
            // even when controlled-state onChange is skipped.
            const form = event.currentTarget
            const raw =
              new FormData(form).get('companyKey')?.toString()
              ?? query
            setQuery(raw)
            void runLookup(raw)
          }}
        >
          <Input
            name="companyKey"
            data-testid="industry-lookup-company-key"
            aria-label="companyKey"
            placeholder="eonmetall-group"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-[16rem] flex-1 font-mono text-sm"
          />
          <Button
            type="submit"
            data-testid="industry-lookup-submit"
            disabled={loading}
          >
            {loading
              ? t('common.loading', { defaultValue: 'Loading…' })
              : t('industryEvidence.lookup', { defaultValue: 'Lookup' })}
          </Button>
        </form>

        {approvedList.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('industryEvidence.verifiedQuickPick', {
                defaultValue: 'Verified profiles',
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              {approvedList.slice(0, 24).map((profile) => (
                <Button
                  key={profile.companyKey}
                  type="button"
                  size="sm"
                  variant={lookedUpKey === profile.companyKey ? 'default' : 'outline'}
                  data-testid={`industry-lookup-chip-${profile.companyKey}`}
                  className="font-mono text-xs"
                  onClick={() => {
                    setQuery(profile.companyKey)
                    void runLookup(profile.companyKey)
                  }}
                >
                  {profile.companyKey}
                  {profile.industryClass ? (
                    <Badge variant="secondary" className="ml-2">
                      {profile.industryClass}
                    </Badge>
                  ) : null}
                </Button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" data-testid="industry-lookup-error">
            {error}
          </p>
        )}

        {lookedUpKey && !error && (
          <div className="space-y-4" data-testid="industry-lookup-result">
            <div className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">companyKey</p>
                <p className="mt-1 break-all font-mono text-xs">{lookedUpKey}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Current verdict</p>
                <p className="mt-1 font-medium">
                  {bundle.profile?.verificationLevel ?? 'No approved revision'}
                  {bundle.profile?.industryClass
                    ? ` · ${bundle.profile.industryClass}`
                    : ''}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Current revision</p>
                <p className="mt-1 break-all font-mono text-xs">
                  {bundle.profile?.currentRevisionId ?? '—'}
                </p>
              </div>
            </div>

            {(() => {
              const profileAny = bundle.profile as { summary?: string; evidenceSummary?: string } | null
              const summary =
                bundle.revisions[0]?.evidenceSummary
                ?? profileAny?.evidenceSummary
                ?? profileAny?.summary
              return summary ? (
                <p className="text-sm leading-6 text-muted-foreground" data-testid="industry-lookup-summary">
                  {summary}
                </p>
              ) : null
            })()}

            <div>
              <p className="mb-2 text-sm font-medium">
                {t('industryEvidence.lookupSources', {
                  defaultValue: 'Evidence sources',
                })}{' '}
                <span className="font-normal text-muted-foreground">
                  ({approvedSources.length || bundle.sources.length})
                </span>
              </p>
              {(approvedSources.length ? approvedSources : bundle.sources).length === 0 ? (
                <p className="text-sm text-muted-foreground">No sources on this profile.</p>
              ) : (
                <div className="space-y-2">
                  {(approvedSources.length ? approvedSources : bundle.sources).map((source) => (
                    <div
                      key={source.sourceId}
                      className="rounded-lg border p-3 text-sm"
                      data-testid={`industry-lookup-source-${source.sourceId}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{source.title ?? source.sourceDomain}</span>
                        <Badge variant="outline">{source.sourceType}</Badge>
                        <Badge variant="secondary">{source.trustTier}</Badge>
                        {source.reviewStatus && (
                          <Badge variant="outline">{source.reviewStatus}</Badge>
                        )}
                      </div>
                      {source.evidenceExcerpt && (
                        <p className="mt-1 text-muted-foreground">{source.evidenceExcerpt}</p>
                      )}
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        {source.url}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {bundle.revisions.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">
                  {t('industryEvidence.revisionHistory', {
                    defaultValue: 'Revision history',
                  })}
                </p>
                <div className="space-y-2">
                  {bundle.revisions.map((revision) => (
                    <div key={revision.revisionId} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                        <Badge>{revision.verificationLevel}</Badge>
                        <Badge variant="outline">{revision.industryClass}</Badge>
                        <span className="break-all font-mono text-xs">{revision.revisionId}</span>
                      </div>
                      <p className="mt-2 text-sm">{revision.evidenceSummary}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {revision.reviewedBy} · {formatDate(revision.reviewedAt)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
