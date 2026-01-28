import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { NewsItem } from '@/lib/types'

interface TrendItemProps {
  item: NewsItem
  showRank?: boolean
}

export function TrendItem({ item, showRank = true }: TrendItemProps) {
  const { t } = useTranslation()

  const platformKey = `platforms.${item.platform_id}` as const
  const platformName = t(platformKey, { defaultValue: item.platform_name ?? item.platform_id })

  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0 hover:bg-accent/50 transition-colors px-2 rounded-sm">
      {showRank && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <span className="text-sm font-semibold text-primary">
            {item.rank}
          </span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium leading-snug line-clamp-2">
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary hover:underline inline-flex items-start gap-1"
              >
                {item.title}
                <ExternalLink className="w-3 h-3 flex-shrink-0 mt-1 opacity-50" />
              </a>
            ) : (
              item.title
            )}
          </h3>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <Badge variant="secondary" className="text-xs">
            {platformName}
          </Badge>
        </div>
      </div>
    </div>
  )
}
