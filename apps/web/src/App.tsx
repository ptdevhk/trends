import { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Header } from '@/components/Header'
import { TrendList } from '@/components/TrendList'
import { PlatformFilter } from '@/components/PlatformFilter'
import { SearchBar } from '@/components/SearchBar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendItem } from '@/components/TrendItem'
import { useTrends, useSearch } from '@/hooks/useTrends'

function App() {
  const { t } = useTranslation()
  const [platform, setPlatform] = useState('')

  const platformsFilter = useMemo(
    () => (platform ? [platform] : undefined),
    [platform]
  )

  const { news, loading, error, lastUpdated, refresh } = useTrends({
    platforms: platformsFilter,
    limit: 50,
  })

  const {
    results: searchResults,
    loading: searchLoading,
    error: searchError,
    search,
    clear: clearSearch,
  } = useSearch({ platforms: platformsFilter })

  const handleSearch = useCallback(
    (keyword: string) => {
      search(keyword)
    },
    [search]
  )

  const handleClearSearch = useCallback(() => {
    clearSearch()
  }, [clearSearch])

  const isSearching = searchResults.length > 0 || searchLoading

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-6">
        <div className="flex flex-col gap-6">
          {/* Search and Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <SearchBar
                onSearch={handleSearch}
                onClear={handleClearSearch}
                loading={searchLoading}
              />
            </div>
            <PlatformFilter value={platform} onChange={setPlatform} />
          </div>

          {/* Content Area */}
          {isSearching ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-xl font-semibold">
                  {t('search.results')}
                  {searchResults.length > 0 && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {t('search.resultsCount', { count: searchResults.length })}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {searchLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-muted-foreground">{t('trends.loading')}</p>
                  </div>
                ) : searchError ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <p className="text-destructive">{t('trends.error')}</p>
                    <p className="text-sm text-muted-foreground mt-1">{searchError}</p>
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-muted-foreground">{t('search.noResults')}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {searchResults.map((item) => (
                      <TrendItem
                        key={`${item.platform_id}-${item.id}`}
                        item={item}
                        showRank={false}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <TrendList
              news={news}
              loading={loading}
              error={error}
              lastUpdated={lastUpdated}
              onRefresh={refresh}
              title={t('trends.latest')}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t py-6 mt-8">
        <div className="container text-center text-sm text-muted-foreground">
          {t('footer.poweredBy')}
        </div>
      </footer>
    </div>
  )
}

export default App
