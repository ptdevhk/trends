import { History, Loader2, MapPin, Search, Tags, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SearchHistoryItem } from '@/hooks/useSession'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { formatInAppTimezone } from '@/lib/timezone'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type SearchHistoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: SearchHistoryItem[]
  loading?: boolean
  onApply: (item: SearchHistoryItem) => void | Promise<void>
}

function formatTimestamp(value: number | undefined): string {
  if (!value) {
    return '—'
  }

  return formatInAppTimezone(value, { includeDate: true })
}

export function SearchHistoryDialog({
  open,
  onOpenChange,
  items,
  loading = false,
  onApply,
}: SearchHistoryDialogProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) {
      return items
    }
    return items.filter((item) =>
      [
        item.title,
        item.location,
        ...item.keywords,
        ...item.selectedTags,
        ...item.selectedCompanies,
        item.jobDescriptionId,
        item.notes,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    )
  }, [items, searchQuery])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('quickStart.history.title', 'Search history')}</DialogTitle>
          <DialogDescription>
            {t('quickStart.history.description', 'Open a previously saved search without silently restoring it on page load.')}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('quickStart.history.loading', 'Loading history...')}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            {t('quickStart.history.empty', 'No saved searches yet.')}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('quickStart.history.searchPlaceholder', 'Search history by title, keyword, location...')}
                className="pl-8 pr-8"
                data-testid="search-history-filter-input"
              />
              {searchQuery ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
                  onClick={() => setSearchQuery('')}
                  aria-label={t('quickStart.history.clearSearch', 'Clear search')}
                  data-testid="search-history-clear-search"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>

            {filteredItems.length === 0 ? (
              <div
                className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground"
                data-testid="search-history-empty-filter"
              >
                {t('quickStart.history.noMatches', 'No saved searches match your filter.')}
                <div className="mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSearchQuery('')}
                    data-testid="search-history-clear-filter-empty"
                  >
                    {t('quickStart.history.clearSearch', 'Clear search')}
                  </Button>
                </div>
              </div>
            ) : (
              filteredItems.map((item) => (
                <div key={item.id} className="rounded-lg border px-4 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">{item.title}</span>
                        {item.jobDescriptionId ? (
                          <Badge variant="outline" className="font-normal">
                            {item.jobDescriptionId}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {item.location || t('quickStart.history.noLocation', 'No location')}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <History className="h-3.5 w-3.5" />
                          {t('quickStart.history.lastOpened', 'Last opened')}: {formatTimestamp(item.lastOpenedAt)}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {item.keywords.map((keyword) => (
                          <Badge key={`${item.id}-${keyword}`} variant="secondary" className="font-normal">
                            {keyword}
                          </Badge>
                        ))}
                        {item.selectedTags.map((tag) => (
                          <Badge key={`${item.id}-tag-${tag}`} variant="outline" className="font-normal">
                            <Tags className="mr-1 h-3 w-3" />
                            {tag}
                          </Badge>
                        ))}
                      </div>

                      <div className="text-xs text-muted-foreground">
                        {t('quickStart.history.createdAt', 'Created')}: {formatTimestamp(item.createdAt)}
                      </div>

                      {item.notes ? (
                        <div className="rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
                          {item.notes}
                        </div>
                      ) : null}
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        void onApply(item)
                        onOpenChange(false)
                      }}
                    >
                      {t('quickStart.history.open', 'Open')}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
