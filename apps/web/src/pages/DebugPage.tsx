import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import type { components } from '@/lib/api-types'
import { SearchBar } from '@/components/SearchBar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type ResumeSample = components['schemas']['ResumeSample']
type ResumeItem = components['schemas']['ResumeItem']
type ResumesResponse = components['schemas']['ResumesResponse']

type IndustryStatsResponse = {
  success: true
  stats: {
    loadedAt: string
    companiesCount: number
    keywordsCount: number
    brandsCount: number
  }
}

type IndustryValidationResponse = {
  success: true
  valid: boolean
  issues: Array<{
    section: string
    row: number
    issue: string
    severity: 'error' | 'warning'
  }>
  stats: {
    totalTables: number
    totalRows: number
    tablesWithIssues: number
  }
}

type JobDescriptionFile = {
  name: string
  filename: string
  updatedAt: string
  size: number
  title?: string
}

type JobDescriptionsResponse = {
  success: true
  items: JobDescriptionFile[]
}

type JobDescriptionResponse = {
  success: true
  item: JobDescriptionFile
  content: string
}

type IndustryListResponse<T> = {
  success: true
  count: number
  data: T[]
}

type IndustryCompany = {
  id: number
  nameCn: string
  nameEn?: string
  type: string
  category: 'key_company' | 'ites_exhibitor' | 'agent'
}

type IndustryKeyword = {
  id: number
  keyword: string
  english?: string
  category: 'machining' | 'lathe' | 'edm' | 'measurement' | 'smt' | '3d_printing'
}

type IndustryBrand = {
  id: number
  nameCn: string
  nameEn?: string
  type: string
  origin: 'international' | 'domestic' | 'agent'
}

type CountEntry = { label: string; count: number }

function buildCounts(items: ResumeItem[], key: keyof ResumeItem): CountEntry[] {
  const counter = new Map<string, number>()
  items.forEach((item) => {
    const value = (item[key] ?? '').toString().trim()
    if (!value) return
    counter.set(value, (counter.get(value) ?? 0) + 1)
  })

  return Array.from(counter.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
}

/* CONVEX INTEGRATION START */
import { useConvexResumes } from '@/hooks/useConvexResumes'
/* CONVEX INTEGRATION END */

export function DebugPage() {
  const { t } = useTranslation()
  const location = useLocation()

  // Use Convex hook instead of legacy API
  const [limit, setLimit] = useState(200)
  const { resumes: convexResumes, loading: convexLoading } = useConvexResumes(limit)

  // Adapting Convex data to legacy structure
  const [query, setQuery] = useState('')
  const [rawResponse, setRawResponse] = useState<ResumesResponse | null>(null)

  // Legacy state (kept to minimize refactor errors, but unused/dummy)
  const [samples] = useState<ResumeSample[]>([{ name: 'convex-db', filename: 'db', updatedAt: new Date().toISOString(), size: 0 }])
  const [selectedSample, setSelectedSample] = useState('convex-db')
  const [loading, setLoading] = useState(false)
  const [error] = useState<string | null>(null)

  // Update rawResponse when convex data changes
  useEffect(() => {
    if (convexLoading) {
      setLoading(true)
      return
    }

    // Filter client-side if query exists
    let displayResumes = convexResumes || []
    if (query) {
      const q = query.toLowerCase()
      displayResumes = displayResumes.filter(r =>
        (r.name && r.name.toLowerCase().includes(q)) ||
        (r.jobIntention && r.jobIntention.toLowerCase().includes(q))
      )
    }

    setRawResponse({
      success: true,
      data: displayResumes,
      summary: {
        returned: displayResumes.length,
        total: convexResumes?.length || 0
      },
      metadata: {
        sourceUrl: "Convex Database",
        totalResumes: convexResumes?.length || 0,
        generatedAt: new Date().toISOString(),
        generatedBy: "Convex Client",
        searchCriteria: { keyword: query || "all", location: "all" }
      }
    })
    setLoading(false)
  }, [convexResumes, convexLoading, query])

  // Legacy Industry & Job Description state
  const [industryStats, setIndustryStats] = useState<IndustryStatsResponse['stats'] | null>(null)
  const [industryValidation, setIndustryValidation] = useState<IndustryValidationResponse | null>(null)
  const [industryError, setIndustryError] = useState<string | null>(null)
  const [industryView, setIndustryView] = useState<'companies' | 'keywords' | 'brands'>('companies')
  const [industryFilter, setIndustryFilter] = useState('')
  const [industrySearch, setIndustrySearch] = useState('')
  const [industryLimit, setIndustryLimit] = useState(1000)
  const [industryItems, setIndustryItems] = useState<Array<IndustryCompany | IndustryKeyword | IndustryBrand>>([])
  const [industryCount, setIndustryCount] = useState(0)
  const [showAllIndustry, setShowAllIndustry] = useState(false)
  const [industryFormat, setIndustryFormat] = useState<'json' | 'markdown'>('markdown')
  const [industryAllData, setIndustryAllData] = useState<{
    companies: IndustryCompany[]
    keywords: IndustryKeyword[]
    brands: IndustryBrand[]
  }>({ companies: [], keywords: [], brands: [] })
  const [industryAllLoading, setIndustryAllLoading] = useState(false)
  const [jobDescriptions, setJobDescriptions] = useState<JobDescriptionFile[]>([])
  const [selectedJob, setSelectedJob] = useState('')
  const [jobContentMap, setJobContentMap] = useState<Record<string, string>>({})
  const [showAllJobs, setShowAllJobs] = useState(false)
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsError, setJobsError] = useState<string | null>(null)

  const apiBaseUrl = useMemo(() => {
    const rawBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
    return rawBaseUrl.replace(/\/api\/?$/, '')
  }, [])

  const fetchJson = useCallback(async <T,>(path: string): Promise<T> => {
    const response = await fetch(`${apiBaseUrl}${path}`)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return response.json() as Promise<T>
  }, [apiBaseUrl])

  const downloadText = useCallback((filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }, [])

  const sampleOptions = useMemo(
    () =>
      samples.map((sample) => ({
        value: sample.name,
        label: sample.name,
      })),
    [samples]
  )

  const industryDatasetOptions = useMemo(
    () => [
      { value: 'companies', label: t('debug.industryDatasetCompanies') },
      { value: 'keywords', label: t('debug.industryDatasetKeywords') },
      { value: 'brands', label: t('debug.industryDatasetBrands') },
    ],
    [t]
  )

  const industryFormatOptions = useMemo(
    () => [
      { value: 'markdown', label: t('debug.industryFormatMarkdown') },
      { value: 'json', label: t('debug.industryFormatJson') },
    ],
    [t]
  )

  const industryFilterOptions = useMemo(() => {
    if (industryView === 'companies') {
      return [
        { value: '', label: t('debug.industryFilterAll') },
        { value: 'key_company', label: t('debug.industryFilterKeyCompany') },
        { value: 'ites_exhibitor', label: t('debug.industryFilterItes') },
        { value: 'agent', label: t('debug.industryFilterAgent') },
      ]
    }
    if (industryView === 'brands') {
      return [
        { value: '', label: t('debug.industryFilterAll') },
        { value: 'international', label: t('debug.industryFilterInternational') },
        { value: 'domestic', label: t('debug.industryFilterDomestic') },
        { value: 'agent', label: t('debug.industryFilterAgent') },
      ]
    }
    return [
      { value: '', label: t('debug.industryFilterAll') },
      { value: 'machining', label: t('debug.industryFilterMachining') },
      { value: 'lathe', label: t('debug.industryFilterLathe') },
      { value: 'edm', label: t('debug.industryFilterEdm') },
      { value: 'measurement', label: t('debug.industryFilterMeasurement') },
      { value: 'smt', label: t('debug.industryFilterSmt') },
      { value: '3d_printing', label: t('debug.industryFilter3d') },
    ]
  }, [industryView, t])

  const resumes = rawResponse?.data ?? []
  const summary = rawResponse?.summary
  const metadata = rawResponse?.metadata

  const selectedJobContent = selectedJob ? (jobContentMap[selectedJob] ?? '') : ''

  const filteredIndustryItems = useMemo(() => {
    if (!industrySearch.trim()) return industryItems
    const keyword = industrySearch.trim().toLowerCase()
    return industryItems.filter((item) => JSON.stringify(item).toLowerCase().includes(keyword))
  }, [industryItems, industrySearch])

  const previewIndustryItems = useMemo(
    () => filteredIndustryItems.slice(0, industryLimit),
    [filteredIndustryItems, industryLimit]
  )

  const previewIndustryAll = useMemo(
    () => ({
      companies: industryAllData.companies.slice(0, industryLimit),
      keywords: industryAllData.keywords.slice(0, industryLimit),
      brands: industryAllData.brands.slice(0, industryLimit),
    }),
    [industryAllData, industryLimit]
  )

  const escapeCell = useCallback((value: unknown) => {
    return String(value ?? '').replace(/\|/g, '\\|')
  }, [])

  const toMarkdownTable = useCallback((headers: string[], rows: string[][]) => {
    const headerLine = `| ${headers.join(' | ')} |`
    const dividerLine = `| ${headers.map(() => '---').join(' | ')} |`
    const bodyLines = rows.map((row) => `| ${row.join(' | ')} |`)
    return [headerLine, dividerLine, ...bodyLines].join('\n')
  }, [])

  const industryMarkdown = useMemo(() => {
    if (industryView === 'companies') {
      const rows = previewIndustryItems.map((item) => {
        const company = item as IndustryCompany
        return [
          escapeCell(company.id),
          escapeCell(company.nameCn),
          escapeCell(company.nameEn ?? ''),
          escapeCell(company.type),
          escapeCell(company.category),
        ]
      })
      return toMarkdownTable(['id', 'nameCn', 'nameEn', 'type', 'category'], rows)
    }
    if (industryView === 'keywords') {
      const rows = previewIndustryItems.map((item) => {
        const keyword = item as IndustryKeyword
        return [
          escapeCell(keyword.id),
          escapeCell(keyword.keyword),
          escapeCell(keyword.english ?? ''),
          escapeCell(keyword.category),
        ]
      })
      return toMarkdownTable(['id', 'keyword', 'english', 'category'], rows)
    }
    const rows = previewIndustryItems.map((item) => {
      const brand = item as IndustryBrand
      return [
        escapeCell(brand.id),
        escapeCell(brand.nameCn),
        escapeCell(brand.nameEn ?? ''),
        escapeCell(brand.type),
        escapeCell(brand.origin),
      ]
    })
    return toMarkdownTable(['id', 'nameCn', 'nameEn', 'type', 'origin'], rows)
  }, [escapeCell, industryView, previewIndustryItems, toMarkdownTable])

  const industryAllMarkdown = useMemo(() => {
    const companies = toMarkdownTable(
      ['id', 'nameCn', 'nameEn', 'type', 'category'],
      previewIndustryAll.companies.map((company) => [
        escapeCell(company.id),
        escapeCell(company.nameCn),
        escapeCell(company.nameEn ?? ''),
        escapeCell(company.type),
        escapeCell(company.category),
      ])
    )
    const keywords = toMarkdownTable(
      ['id', 'keyword', 'english', 'category'],
      previewIndustryAll.keywords.map((keyword) => [
        escapeCell(keyword.id),
        escapeCell(keyword.keyword),
        escapeCell(keyword.english ?? ''),
        escapeCell(keyword.category),
      ])
    )
    const brands = toMarkdownTable(
      ['id', 'nameCn', 'nameEn', 'type', 'origin'],
      previewIndustryAll.brands.map((brand) => [
        escapeCell(brand.id),
        escapeCell(brand.nameCn),
        escapeCell(brand.nameEn ?? ''),
        escapeCell(brand.type),
        escapeCell(brand.origin),
      ])
    )
    return { companies, keywords, brands }
  }, [escapeCell, previewIndustryAll, toMarkdownTable])

  const activeSection = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean)
    const index = parts.indexOf('debug')
    const next = index >= 0 ? parts[index + 1] : undefined
    const allowed = new Set(['all', 'inputs', 'findings', 'process', 'raw', 'industry', 'jobs', 'config'])
    if (next && allowed.has(next)) return next
    return 'all'
  }, [location.pathname])

  const showAll = activeSection === 'all'
  const showInputs = showAll || activeSection === 'inputs'
  const showFindings = showAll || activeSection === 'findings'
  const showProcess = showAll || activeSection === 'process'
  const showRaw = showAll || activeSection === 'raw'
  const showIndustry = showAll || activeSection === 'industry'
  const showJobs = showAll || activeSection === 'jobs'

  const navLinks = useMemo(
    () => [
      { key: 'all', label: t('debug.navAll'), href: '/debug' },
      { key: 'inputs', label: t('debug.navInputs'), href: '/debug/inputs' },
      { key: 'findings', label: t('debug.navFindings'), href: '/debug/findings' },
      { key: 'process', label: t('debug.navProcess'), href: '/debug/process' },
      { key: 'raw', label: t('debug.navRaw'), href: '/debug/raw' },
      { key: 'industry', label: t('debug.navIndustry'), href: '/debug/industry' },
      { key: 'jobs', label: t('debug.navJobs'), href: '/debug/jobs' },
      { key: 'config', label: t('debug.navConfig'), href: '/debug/config' },
      { key: 'ai', label: t('debug.navAi'), href: '/debug/ai' },
    ],
    [t]
  )

  const locationCounts = useMemo(() => buildCounts(resumes, 'location').slice(0, 5), [resumes])
  const educationCounts = useMemo(() => buildCounts(resumes, 'education').slice(0, 5), [resumes])
  const intentionCounts = useMemo(() => buildCounts(resumes, 'jobIntention').slice(0, 5), [resumes])

  const missingStats = useMemo(() => {
    const fields: Array<keyof ResumeItem> = ['education', 'location', 'experience', 'jobIntention']
    const stats = fields.map((field) => {
      const missing = resumes.filter((item) => !item[field]?.toString().trim()).length
      return { field, missing }
    })
    const missingWorkHistory = resumes.filter((item) => (item.workHistory?.length ?? 0) === 0).length
    return { stats, missingWorkHistory }
  }, [resumes])

  useEffect(() => {
    if (!showIndustry) return
    let mounted = true
    setIndustryError(null)

    fetchJson<IndustryStatsResponse>('/api/industry/stats')
      .then((data) => {
        if (mounted) setIndustryStats(data.stats)
      })
      .catch((err: Error) => {
        if (mounted) setIndustryError(err.message)
      })

    fetchJson<IndustryValidationResponse>('/api/industry/validate')
      .then((data) => {
        if (mounted) setIndustryValidation(data)
      })
      .catch((err: Error) => {
        if (mounted) setIndustryError(err.message)
      })

    return () => {
      mounted = false
    }
  }, [fetchJson, showIndustry])

  useEffect(() => {
    setIndustryFilter('')
    setIndustrySearch('')
  }, [industryView])

  useEffect(() => {
    if (!showIndustry) return
    let mounted = true
    setIndustryError(null)

    const params = new URLSearchParams()
    if (industryFilter) {
      params.set(industryView === 'brands' ? 'origin' : 'category', industryFilter)
    }

    const path = industryView === 'companies'
      ? `/api/industry/companies?${params.toString()}`
      : industryView === 'keywords'
        ? `/api/industry/keywords?${params.toString()}`
        : `/api/industry/brands?${params.toString()}`

    fetchJson<IndustryListResponse<IndustryCompany | IndustryKeyword | IndustryBrand>>(path)
      .then((data) => {
        if (!mounted) return
        setIndustryItems(data.data)
        setIndustryCount(data.count)
      })
      .catch((err: Error) => {
        if (mounted) setIndustryError(err.message)
      })

    return () => {
      mounted = false
    }
  }, [fetchJson, industryFilter, industryView, showIndustry])

  useEffect(() => {
    if (!showIndustry || !showAllIndustry) return
    let mounted = true
    setIndustryError(null)
    setIndustryAllLoading(true)

    Promise.all([
      fetchJson<IndustryListResponse<IndustryCompany>>('/api/industry/companies'),
      fetchJson<IndustryListResponse<IndustryKeyword>>('/api/industry/keywords'),
      fetchJson<IndustryListResponse<IndustryBrand>>('/api/industry/brands'),
    ])
      .then(([companies, keywords, brands]) => {
        if (!mounted) return
        setIndustryAllData({
          companies: companies.data,
          keywords: keywords.data,
          brands: brands.data,
        })
        setIndustryAllLoading(false)
      })
      .catch((err: Error) => {
        if (mounted) {
          setIndustryError(err.message)
          setIndustryAllLoading(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [fetchJson, showAllIndustry, showIndustry])

  useEffect(() => {
    if (!showJobs) return
    let mounted = true
    setJobsError(null)

    fetchJson<JobDescriptionsResponse>('/api/job-descriptions')
      .then((data) => {
        if (!mounted) return
        setJobDescriptions(data.items)
        if (data.items.length) {
          setSelectedJob((current) => current || data.items[0].name)
        }
      })
      .catch((err: Error) => {
        if (mounted) setJobsError(err.message)
      })

    return () => {
      mounted = false
    }
  }, [fetchJson, showJobs])

  useEffect(() => {
    if (!showJobs || !selectedJob) return
    let mounted = true
    setJobsError(null)

    fetchJson<JobDescriptionResponse>(`/api/job-descriptions/${encodeURIComponent(selectedJob)}`)
      .then((data) => {
        if (mounted) {
          setJobContentMap((prev) => ({ ...prev, [selectedJob]: data.content }))
        }
      })
      .catch((err: Error) => {
        if (mounted) setJobsError(err.message)
      })

    return () => {
      mounted = false
    }
  }, [fetchJson, selectedJob, showJobs])

  useEffect(() => {
    if (!showJobs || !showAllJobs || jobDescriptions.length === 0) return
    let mounted = true
    setJobsError(null)
    setJobsLoading(true)

    Promise.all(
      jobDescriptions.map((job) =>
        fetchJson<JobDescriptionResponse>(`/api/job-descriptions/${encodeURIComponent(job.name)}`)
          .then((data) => ({ name: job.name, content: data.content }))
      )
    )
      .then((items) => {
        if (!mounted) return
        setJobContentMap((prev) => {
          const next = { ...prev }
          items.forEach((item) => {
            next[item.name] = item.content
          })
          return next
        })
        setJobsLoading(false)
      })
      .catch((err: Error) => {
        if (mounted) {
          setJobsError(err.message)
          setJobsLoading(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [fetchJson, jobDescriptions, showAllJobs, showJobs])

  const handleSearch = useCallback((keyword: string) => {
    setQuery(keyword)
  }, [])

  const handleClearSearch = useCallback(() => {
    setQuery('')
  }, [])

  const handleRefresh = useCallback(async () => {
    // Convex data is live, no need to manually refresh
    console.log("Convex subscriptions are active")
  }, [])

  const jobOptions = useMemo(
    () =>
      jobDescriptions.map((job) => ({
        value: job.name,
        label: job.title ? `${job.title} (${job.name})` : job.name,
      })),
    [jobDescriptions]
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{t('debug.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('debug.subtitle')}</p>
          </div>
          <Button variant="outline" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            {t('debug.refresh')}
          </Button>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr_0.6fr]">
          <SearchBar
            onSearch={handleSearch}
            onClear={handleClearSearch}
            loading={loading}
            placeholder={t('debug.searchPlaceholder')}
            buttonLabel={t('debug.searchButton')}
          />
          <Select
            options={sampleOptions}
            value={selectedSample}
            onChange={(event) => setSelectedSample(event.target.value)}
            disabled={sampleOptions.length === 0}
          />
          <Input
            type="number"
            min={1}
            max={1000}
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value) || 1000)}
            placeholder={t('debug.limitPlaceholder')}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {navLinks.map((link) => (
            <NavLink
              key={link.key}
              to={link.href}
              end={link.key === 'all'}
              className={({ isActive }) =>
                cn(
                  'rounded-full border px-3 py-1 transition-colors',
                  isActive ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        {summary && !error ? (
          <div className="text-sm text-muted-foreground">
            {t('debug.summary', {
              returned: summary.returned ?? resumes.length,
              total: summary.total ?? resumes.length,
              sample: selectedSample || '--',
            })}
          </div>
        ) : null}
      </div>

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('debug.errorTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      ) : null}

      {(showInputs || showFindings) && (
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          {showInputs ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('debug.inputsTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{t('debug.inputsSample')}</span>
                  <Badge variant="outline">{selectedSample || '--'}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{t('debug.inputsQuery')}</span>
                  <Badge variant="secondary">{query || t('debug.none')}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{t('debug.inputsLimit')}</span>
                  <Badge variant="secondary">{limit}</Badge>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('debug.inputsMetadata')}</p>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {metadata ? JSON.stringify(metadata, null, 2) : t('debug.none')}
                  </pre>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('debug.inputsSamples')}</p>
                  <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {samples.length ? JSON.stringify(samples, null, 2) : t('debug.none')}
                  </pre>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {showFindings ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('debug.findingsTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <p className="text-muted-foreground">{t('debug.findingsTotals')}</p>
                  <p className="text-lg font-semibold">{resumes.length}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-muted-foreground">{t('debug.findingsLocations')}</p>
                    <ul className="space-y-1 text-xs">
                      {locationCounts.length ? locationCounts.map((item) => (
                        <li key={item.label} className="flex justify-between">
                          <span className="truncate">{item.label}</span>
                          <span className="text-muted-foreground">{item.count}</span>
                        </li>
                      )) : <li>{t('debug.none')}</li>}
                    </ul>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t('debug.findingsEducation')}</p>
                    <ul className="space-y-1 text-xs">
                      {educationCounts.length ? educationCounts.map((item) => (
                        <li key={item.label} className="flex justify-between">
                          <span className="truncate">{item.label}</span>
                          <span className="text-muted-foreground">{item.count}</span>
                        </li>
                      )) : <li>{t('debug.none')}</li>}
                    </ul>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t('debug.findingsIntentions')}</p>
                    <ul className="space-y-1 text-xs">
                      {intentionCounts.length ? intentionCounts.map((item) => (
                        <li key={item.label} className="flex justify-between">
                          <span className="truncate">{item.label}</span>
                          <span className="text-muted-foreground">{item.count}</span>
                        </li>
                      )) : <li>{t('debug.none')}</li>}
                    </ul>
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('debug.findingsMissing')}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {missingStats.stats.map((stat) => (
                      <Badge key={stat.field} variant="outline">
                        {stat.field}: {stat.missing}
                      </Badge>
                    ))}
                    <Badge variant="outline">workHistory: {missingStats.missingWorkHistory}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {showProcess ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('debug.processTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-muted-foreground">{t('debug.processSteps')}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                <li>{t('debug.stepLoadSamples')}</li>
                <li>{t('debug.stepFetchResumes')}</li>
                <li>{t('debug.stepNormalize')}</li>
                <li>{t('debug.stepAggregate')}</li>
              </ol>
            </div>
            <div>
              <p className="text-muted-foreground">{t('debug.processPreview')}</p>
              <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs">
                {resumes.length ? JSON.stringify(resumes.slice(0, 3), null, 2) : t('debug.none')}
              </pre>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {showIndustry ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('debug.industryTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {industryError ? (
              <p className="text-sm text-destructive">{industryError}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{t('debug.industryCompanies', { count: industryStats?.companiesCount ?? 0 })}</Badge>
              <Badge variant="outline">{t('debug.industryKeywords', { count: industryStats?.keywordsCount ?? 0 })}</Badge>
              <Badge variant="outline">{t('debug.industryBrands', { count: industryStats?.brandsCount ?? 0 })}</Badge>
              {industryStats?.loadedAt ? (
                <Badge variant="secondary">{t('debug.industryLoadedAt', { value: industryStats.loadedAt })}</Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAllIndustry((current) => !current)}
              >
                {showAllIndustry ? t('debug.industryShowSelected') : t('debug.industryShowAll')}
              </Button>
              <Select
                className="w-40"
                options={industryFormatOptions}
                value={industryFormat}
                onChange={(event) => setIndustryFormat(event.target.value as 'json' | 'markdown')}
              />
              {industryAllLoading ? (
                <span className="text-xs text-muted-foreground">{t('debug.industryLoadingAll')}</span>
              ) : null}
            </div>
            {showAllIndustry ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">{t('debug.industryDatasetCompanies')}</p>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {previewIndustryAll.companies.length
                      ? (industryFormat === 'markdown' ? industryAllMarkdown.companies : JSON.stringify(previewIndustryAll.companies, null, 2))
                      : t('debug.none')}
                  </pre>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('debug.industryDatasetKeywords')}</p>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {previewIndustryAll.keywords.length
                      ? (industryFormat === 'markdown' ? industryAllMarkdown.keywords : JSON.stringify(previewIndustryAll.keywords, null, 2))
                      : t('debug.none')}
                  </pre>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('debug.industryDatasetBrands')}</p>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {previewIndustryAll.brands.length
                      ? (industryFormat === 'markdown' ? industryAllMarkdown.brands : JSON.stringify(previewIndustryAll.brands, null, 2))
                      : t('debug.none')}
                  </pre>
                </div>
              </div>
            ) : (
              <>
                <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1.4fr_0.6fr]">
                  <Select
                    options={industryDatasetOptions}
                    value={industryView}
                    onChange={(event) => setIndustryView(event.target.value as 'companies' | 'keywords' | 'brands')}
                  />
                  <Select
                    options={industryFilterOptions}
                    value={industryFilter}
                    onChange={(event) => setIndustryFilter(event.target.value)}
                    disabled={industryFilterOptions.length === 0}
                  />
                  <Input
                    value={industrySearch}
                    onChange={(event) => setIndustrySearch(event.target.value)}
                    placeholder={t('debug.industrySearchPlaceholder')}
                  />
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    value={industryLimit}
                    onChange={(event) => setIndustryLimit(Number(event.target.value) || 1000)}
                    placeholder={t('debug.industryLimitPlaceholder')}
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('debug.industryShowing', {
                    shown: previewIndustryItems.length,
                    filtered: filteredIndustryItems.length,
                    total: industryCount,
                  })}
                </div>
                <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                  {previewIndustryItems.length
                    ? (industryFormat === 'markdown' ? industryMarkdown : JSON.stringify(previewIndustryItems, null, 2))
                    : t('debug.none')}
                </pre>
              </>
            )}
            {industryValidation ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">{t('debug.industryTables', { count: industryValidation.stats.totalTables })}</Badge>
                  <Badge variant="secondary">{t('debug.industryRows', { count: industryValidation.stats.totalRows })}</Badge>
                  <Badge variant="secondary">{t('debug.industryIssues', { count: industryValidation.stats.tablesWithIssues })}</Badge>
                  <Badge variant={industryValidation.valid ? 'outline' : 'destructive'}>
                    {industryValidation.valid ? t('debug.industryValid') : t('debug.industryInvalid')}
                  </Badge>
                </div>
                {industryValidation.issues.length ? (
                  <pre className="max-h-52 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify(industryValidation.issues.slice(0, 5), null, 2)}
                  </pre>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('debug.none')}</p>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {showJobs ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('debug.jobsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {jobsError ? <p className="text-sm text-destructive">{jobsError}</p> : null}
            <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
              <Select
                options={jobOptions}
                value={selectedJob}
                onChange={(event) => setSelectedJob(event.target.value)}
                disabled={jobOptions.length === 0}
              />
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {jobDescriptions.length ? (
                  jobDescriptions.map((job) => (
                    <Badge key={job.name} variant="outline">
                      {job.name}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="outline">{t('debug.none')}</Badge>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAllJobs((current) => !current)}
              >
                {showAllJobs ? t('debug.jobsShowSelected') : t('debug.jobsShowAll')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!selectedJobContent) return
                  downloadText(`${selectedJob || 'job'}.md`, selectedJobContent)
                }}
                disabled={!selectedJobContent}
              >
                {t('debug.jobsDownloadSelected')}
              </Button>
              {jobsLoading ? (
                <span className="text-xs text-muted-foreground">{t('debug.jobsLoading')}</span>
              ) : null}
            </div>
            {showAllJobs ? (
              <div className="space-y-3">
                {jobDescriptions.length ? (
                  jobDescriptions.map((job) => (
                    <div key={job.name} className="rounded-md border bg-muted/20 p-3">
                      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{job.title ?? job.name}</span>
                        <div className="flex items-center gap-2">
                          <span>{job.name}</span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const content = jobContentMap[job.name] || ''
                              if (!content) return
                              downloadText(`${job.name}.md`, content)
                            }}
                            disabled={!jobContentMap[job.name]}
                          >
                            {t('debug.jobsDownload')}
                          </Button>
                        </div>
                      </div>
                      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                        {jobContentMap[job.name] || t('debug.none')}
                      </pre>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">{t('debug.none')}</p>
                )}
              </div>
            ) : (
              <pre className="max-h-[480px] overflow-auto rounded-md bg-muted p-3 text-xs">
                {selectedJobContent || t('debug.none')}
              </pre>
            )}
          </CardContent>
        </Card>
      ) : null}

      {showRaw ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('debug.rawTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[480px] overflow-auto rounded-md bg-muted p-3 text-xs">
              {rawResponse ? JSON.stringify(rawResponse, null, 2) : t('debug.none')}
            </pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
