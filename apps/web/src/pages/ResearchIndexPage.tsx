import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { rawApiClient } from '@/lib/api-helpers'
import { useWorkspace } from '@/contexts/WorkspaceContext'

type CompanyHit = {
  companyKey: string
  displayName: string
  nameCn?: string
  nameEn?: string
}

type SearchResponse = {
  success: boolean
  items?: CompanyHit[]
}

export function ResearchIndexPage() {
  const { t } = useTranslation()
  const { workspaceSlug } = useWorkspace()
  const teamSlug = workspaceSlug || 'hr'
  const [q, setQ] = useState('')
  const [items, setItems] = useState<CompanyHit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const search = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSearched(true)
    const { data, error: apiError } = await rawApiClient.GET<SearchResponse>(
      '/api/research/companies/search',
      { params: { query: { q: q.trim() } } },
    )
    setLoading(false)
    if (apiError || !data?.success) {
      setError(t('research.searchError', { defaultValue: 'Company search failed' }))
      setItems([])
      return
    }
    setItems(Array.isArray(data.items) ? data.items : [])
  }, [q, t])

  return (
    <div className="space-y-4 p-4" data-testid="research-index-page">
      <PageHeader
        title={t('research.indexTitle', { defaultValue: 'Research' })}
        description={t('research.indexDescription', {
          defaultValue: 'Search a company to open hiring and market signals.',
        })}
      />
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={t('research.searchPlaceholder', {
            defaultValue: 'Company name, alias, or key…',
          })}
          className="max-w-md"
          data-testid="research-company-search"
        />
        <Button type="submit" disabled={loading} data-testid="research-company-search-submit">
          {loading
            ? t('research.searching', { defaultValue: 'Searching…' })
            : t('research.search', { defaultValue: 'Search' })}
        </Button>
      </form>
      {error ? (
        <p className="text-sm text-red-600" data-testid="research-search-error">
          {error}
        </p>
      ) : null}
      {!loading && searched && items.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground" data-testid="research-search-empty">
          {t('research.searchEmpty', {
            defaultValue: 'No companies matched. Seed the company registry or try another query.',
          })}
        </p>
      ) : null}
      <ul className="space-y-2" data-testid="research-search-results">
        {items.map((item) => (
          <li key={item.companyKey}>
            <Link
              to={`/${teamSlug}/research/${encodeURIComponent(item.companyKey)}?persona=hr`}
              className="text-blue-600 hover:underline"
              data-testid="research-search-result"
            >
              {item.displayName}
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {item.companyKey}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default ResearchIndexPage
