import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { normalizeResearchPersona, type ResearchPersona } from '@trends/shared'
import { PageHeader } from '@/components/PageHeader'
import {
  CompanyResearchPanel,
  type ResearchSignalView,
} from '@/components/research/CompanyResearchPanel'
import { rawApiClient } from '@/lib/api-helpers'
import { useWorkspace } from '@/contexts/WorkspaceContext'

type SignalsResponse = {
  success: boolean
  persona?: string
  items?: ResearchSignalView[]
}

export function ResearchCompanyPage() {
  const { t } = useTranslation()
  const { companyKey: companyKeyParam } = useParams()
  const { workspaceSlug } = useWorkspace()
  const [searchParams, setSearchParams] = useSearchParams()
  const companyKey = decodeURIComponent(companyKeyParam ?? '').trim()
  const persona = normalizeResearchPersona(searchParams.get('persona'))

  const [signals, setSignals] = useState<ResearchSignalView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const setPersona = useCallback(
    (next: ResearchPersona) => {
      const params = new URLSearchParams(searchParams)
      params.set('persona', next)
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    if (!companyKey) {
      setLoading(false)
      setError(t('research.missingCompany', { defaultValue: 'Missing company key' }))
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      const { data, error: apiError } = await rawApiClient.GET<SignalsResponse>(
        `/api/research/companies/${encodeURIComponent(companyKey)}/signals`,
        { params: { query: { persona } } },
      )
      if (cancelled) {
        return
      }
      if (apiError || !data?.success) {
        setError(
          t('research.loadError', {
            defaultValue: 'Failed to load research signals',
          }),
        )
        setSignals([])
        setLoading(false)
        return
      }
      setSignals(Array.isArray(data.items) ? data.items : [])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [companyKey, persona, t])

  const teamSlug = workspaceSlug || 'hr'

  return (
    <div className="space-y-4 p-4" data-testid="research-company-page">
      <PageHeader
        title={t('research.pageTitle', { defaultValue: 'Research' })}
        description={companyKey || undefined}
      />
      <div className="text-sm">
        <Link
          to={`/${teamSlug}/settings/policies?tab=companies`}
          className="text-blue-600 hover:underline"
          data-testid="research-back-to-policies"
        >
          {t('research.backToPolicies', { defaultValue: 'Company policies' })}
        </Link>
      </div>
      <CompanyResearchPanel
        companyKey={companyKey || '—'}
        signals={signals}
        persona={persona}
        onPersonaChange={setPersona}
        loading={loading}
        error={error}
        teamSlug={teamSlug}
      />
    </div>
  )
}

export default ResearchCompanyPage
