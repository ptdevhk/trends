import { ChevronDown, ChevronUp, MapPin, Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import { SnippetCardExpanded } from '@/components/search/SnippetCardExpanded'

type SnippetCardProps = {
  expanded: boolean
  item: ResumeSearchResultItem
  onToggleExpanded: () => void
}

function getPrimaryHeadline(item: ResumeSearchResultItem): string {
  const latestWorkEntry = item.resume.workHistory?.[0]
  if (latestWorkEntry?.jobTitle) {
    return latestWorkEntry.jobTitle
  }

  return item.resume.jobIntention || 'Profile overview'
}

function getSnippetText(item: ResumeSearchResultItem): string {
  const latestWorkEntry = item.resume.workHistory?.[0]
  if (latestWorkEntry?.raw) {
    return latestWorkEntry.raw
  }

  return item.resume.selfIntro || 'Open the card to inspect recent work history and extracted signals.'
}

export function SnippetCard({ expanded, item, onToggleExpanded }: SnippetCardProps) {
  const visibleKeywords = (
    item.resume._provenance?.map((entry) => entry.term)
    ?? item.resume.ingestData?.industryTags
    ?? []
  ).slice(0, 3)

  return (
    <Card className="overflow-hidden rounded-[1.5rem] border-slate-200 bg-white shadow-[0_18px_50px_-40px_rgba(15,23,42,0.7)]">
      <div className="space-y-4 px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="space-y-1">
              <div className="truncate text-lg font-semibold text-slate-900">{item.resume.name || 'Unnamed resume'}</div>
              <div className="truncate text-sm text-slate-600">{getPrimaryHeadline(item)}</div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {item.resume.location ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {item.resume.location}
                </span>
              ) : null}
              {item.resume.experience ? <span>{item.resume.experience}</span> : null}
              {item.resume.ingestData?.experienceLevel ? (
                <Badge variant="outline" className="capitalize">{item.resume.ingestData.experienceLevel}</Badge>
              ) : null}
            </div>

            <p className="line-clamp-2 text-sm leading-6 text-slate-700">
              {getSnippetText(item)}
            </p>

            <div className="flex flex-wrap gap-2">
              {visibleKeywords.map((keyword) => (
                <Badge key={`${item.key}-${keyword}`} variant="secondary">
                  {keyword}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {typeof item.score === 'number' ? (
              <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-700">
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3.5 w-3.5" />
                  {Math.round(item.score)}
                </span>
              </div>
            ) : null}
            <Button type="button" variant="outline" className="rounded-full" onClick={onToggleExpanded}>
              {expanded ? 'Collapse' : 'Expand'}
              {expanded ? <ChevronUp className="ml-2 h-4 w-4" /> : <ChevronDown className="ml-2 h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {expanded ? <SnippetCardExpanded item={item} /> : null}
    </Card>
  )
}
