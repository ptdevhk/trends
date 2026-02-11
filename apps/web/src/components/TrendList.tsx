import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendItem } from './TrendItem'
import type { NewsItem } from '@/lib/types'
import { formatInAppTimezone } from '@/lib/timezone'

interface TrendListProps {
  news: NewsItem[]
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  onRefresh: () => void
  title?: string
}

export function TrendList({
  news,
  loading,
  error,
  lastUpdated,
  onRefresh,
  title,
}: TrendListProps) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xl font-semibold">
          {title ?? t('trends.latest')}
        </CardTitle>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              {t('trends.lastUpdated')}: {formatInAppTimezone(lastUpdated)}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && news.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 py-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-destructive mb-2">{t('trends.error')}</p>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button variant="outline" size="sm" onClick={onRefresh}>
              {t('trends.retry')}
            </Button>
          </div>
        ) : news.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-muted-foreground">{t('trends.empty')}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {news.map((item) => (
              <TrendItem key={`${item.platform_id}-${item.id}`} item={item} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
