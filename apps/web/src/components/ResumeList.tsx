import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { useResumes, type ResumeItem } from '@/hooks/useResumes'
import { ResumeCard } from '@/components/ResumeCard'
import { ResumeDetail } from '@/components/ResumeDetail'
import { SearchBar } from '@/components/SearchBar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export function ResumeList() {
  const { t } = useTranslation()
  const {
    resumes,
    samples,
    summary,
    loading,
    error,
    selectedSample,
    setSelectedSample,
    setQuery,
    refresh,
    reloadSamples,
  } = useResumes({ limit: 200 })

  const [detailResume, setDetailResume] = useState<ResumeItem | null>(null)

  const sampleOptions = useMemo(
    () =>
      samples.map((sample) => ({
        value: sample.name,
        label: sample.name,
      })),
    [samples]
  )

  const handleSearch = useCallback(
    (keyword: string) => {
      setQuery(keyword)
    },
    [setQuery]
  )

  const handleClearSearch = useCallback(() => {
    setQuery('')
  }, [setQuery])

  const handleRefresh = useCallback(async () => {
    await reloadSamples()
    await refresh()
  }, [reloadSamples, refresh])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{t('resumes.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('resumes.subtitle')}</p>
          </div>
          <Button variant="outline" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            {t('resumes.refresh')}
          </Button>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex-1">
            <SearchBar
              onSearch={handleSearch}
              onClear={handleClearSearch}
              loading={loading}
              placeholder={t('resumes.searchPlaceholder')}
              buttonLabel={t('resumes.searchButton')}
            />
          </div>
          <div className="lg:w-64">
            <Select
              options={sampleOptions}
              value={selectedSample}
              onChange={(event) => setSelectedSample(event.target.value)}
              disabled={sampleOptions.length === 0}
            />
          </div>
        </div>

        {summary && !error ? (
          <div className="text-sm text-muted-foreground">
            {t('resumes.summary', {
              returned: summary.returned ?? resumes.length,
              total: summary.total ?? resumes.length,
              sample: selectedSample || '--',
            })}
          </div>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{t('resumes.tableTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t('resumes.loading')}
            </div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-sm text-destructive">{t('resumes.error')}</p>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
            </div>
          ) : resumes.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t('resumes.empty')}
            </div>
          ) : (
            <div className="space-y-3">
              {resumes.map((resume, index) => (
                <ResumeCard
                  key={resume.resumeId || resume.perUserId || `${index}-${resume.name}`}
                  resume={resume}
                  onViewDetails={() => setDetailResume(resume)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ResumeDetail
        resume={detailResume}
        open={Boolean(detailResume)}
        onOpenChange={(open) => {
          if (!open) setDetailResume(null)
        }}
      />
    </div>
  )
}
