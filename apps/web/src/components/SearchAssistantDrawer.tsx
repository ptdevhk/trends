import { History, Loader2, MapPin, MessageSquareMore, Sparkles, Tags, Wand2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SearchHistoryItem } from '@/hooks/useSession'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatInAppTimezone } from '@/lib/timezone'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type SearchAssistantWorkflow = {
  id: string
  label: string
  location: string
  keywords: string[]
}

export type SearchAssistantMatchedProfile = {
  name: string
  confidence: number
  jobDescriptionId?: string
  matchedKeywords: string[]
  filterSummary?: string
}

type SearchAssistantDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  location?: string
  keywords?: string[]
  jobDescriptionId?: string
  workflows: SearchAssistantWorkflow[]
  onApplyWorkflow: (workflow: SearchAssistantWorkflow) => void
  matching?: boolean
  matchedProfile?: SearchAssistantMatchedProfile | null
  onUseMatchedProfile?: () => void
  historyItems?: SearchHistoryItem[]
  historyLoading?: boolean
  onApplyHistoryItem?: (item: SearchHistoryItem) => void | Promise<void>
}

function formatTimestamp(value: number | undefined): string {
  if (!value) {
    return '—'
  }

  return formatInAppTimezone(value, { includeDate: true })
}

export function SearchAssistantDrawer({
  open,
  onOpenChange,
  location = '',
  keywords = [],
  jobDescriptionId,
  workflows,
  onApplyWorkflow,
  matching = false,
  matchedProfile,
  onUseMatchedProfile,
  historyItems = [],
  historyLoading = false,
  onApplyHistoryItem,
}: SearchAssistantDrawerProps) {
  const { t } = useTranslation()
  const hasDraftSummary = Boolean(location.trim() || keywords.length > 0 || jobDescriptionId?.trim())
  const recentHistory = historyItems.slice(0, 3)

  const handleApplyWorkflow = (workflow: SearchAssistantWorkflow) => {
    onApplyWorkflow(workflow)
    onOpenChange(false)
  }

  const handleApplyHistory = async (item: SearchHistoryItem) => {
    if (!onApplyHistoryItem) {
      return
    }

    await onApplyHistoryItem(item)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="search-assistant-drawer"
        className="left-auto right-0 top-0 h-screen max-h-screen w-full max-w-md translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-none border-l border-border/70 bg-background p-0 sm:max-w-lg sm:rounded-none"
      >
        <DialogHeader className="border-b border-border/70 px-4 py-4 text-left sm:px-5">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            <MessageSquareMore className="h-4 w-4" />
            {t('quickStart.assistant.eyebrow', 'Search assistant')}
          </div>
          <DialogTitle className="text-left text-lg">
            {t('quickStart.assistant.title', 'Use suggestions, keep the search shell canonical')}
          </DialogTitle>
          <DialogDescription className="text-left">
            {t(
              'quickStart.assistant.description',
              'This drawer only proposes search state. Every accepted suggestion writes back into the same shareable shell.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <section className="rounded-2xl border border-border/70 bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-amber-600" />
              {t('quickStart.assistant.currentDraft', 'Current draft')}
            </div>
            {hasDraftSummary ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {location.trim() ? (
                  <Badge variant="outline" className="h-6 px-2 text-xs font-normal">
                    <MapPin className="mr-1 h-3 w-3" />
                    {location}
                  </Badge>
                ) : null}
                {keywords.map((keyword) => (
                  <Badge key={`draft-${keyword}`} variant="secondary" className="h-6 px-2 text-xs font-normal">
                    {keyword}
                  </Badge>
                ))}
                {jobDescriptionId?.trim() ? (
                  <Badge variant="outline" className="h-6 px-2 text-xs font-normal">
                    {jobDescriptionId}
                  </Badge>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                {t('quickStart.assistant.currentDraftEmpty', 'Start with a workflow, matched profile, or recent search to reduce typing.')}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-border/70 bg-background p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Wand2 className="h-4 w-4 text-sky-600" />
              {t('quickStart.assistant.bestNextMove', 'Best next move')}
            </div>

            {matching ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-border/70 px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('quickStart.assistant.matching', 'Matching a profile for the current keywords...')}
              </div>
            ) : matchedProfile ? (
              <div className="mt-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{matchedProfile.name}</span>
                  <Badge variant="outline" className="border-primary/30 text-primary">
                    {Math.round(matchedProfile.confidence * 100)}%
                  </Badge>
                  {matchedProfile.jobDescriptionId ? (
                    <Badge variant="outline" className="font-normal">
                      {matchedProfile.jobDescriptionId}
                    </Badge>
                  ) : null}
                </div>
                {matchedProfile.matchedKeywords.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {matchedProfile.matchedKeywords.map((keyword) => (
                      <Badge key={`matched-${keyword}`} variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
                        {keyword}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {matchedProfile.filterSummary ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {matchedProfile.filterSummary}
                  </p>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  className="mt-3 h-10 px-4"
                  disabled={!onUseMatchedProfile}
                  onClick={() => {
                    onUseMatchedProfile?.()
                    onOpenChange(false)
                  }}
                >
                  {t('quickStart.assistant.useMatched', 'Use matched profile')}
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                {t('quickStart.assistant.noMatch', 'No matched profile yet. Try a workflow or add keywords in the main shell first.')}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-border/70 bg-background p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-emerald-600" />
              {t('quickStart.assistant.workflowStarts', 'Workflow starts')}
            </div>
            {workflows.length > 0 ? (
              <div className="mt-3 space-y-3">
                {workflows.map((workflow) => (
                  <div key={workflow.id} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                    <div className="text-sm font-medium text-foreground">{workflow.label}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {workflow.location ? (
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
                          <MapPin className="mr-1 h-3 w-3" />
                          {workflow.location}
                        </Badge>
                      ) : null}
                      {workflow.keywords.slice(0, 4).map((keyword) => (
                        <Badge key={`${workflow.id}-${keyword}`} variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
                          {keyword}
                        </Badge>
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3 h-10 px-4"
                      onClick={() => handleApplyWorkflow(workflow)}
                    >
                      {t('quickStart.assistant.useWorkflow', 'Use workflow')}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                {t('quickStart.assistant.noWorkflow', 'No workflow suggestions are available for this workspace yet.')}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-border/70 bg-background p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <History className="h-4 w-4 text-violet-600" />
              {t('quickStart.assistant.recentHistory', 'Recent history')}
            </div>

            {historyLoading ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-border/70 px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('quickStart.assistant.historyLoading', 'Loading recent saved searches...')}
              </div>
            ) : recentHistory.length > 0 ? (
              <div className="mt-3 space-y-3">
                {recentHistory.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="text-sm font-medium text-foreground">{item.title}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {item.location ? (
                            <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
                              <MapPin className="mr-1 h-3 w-3" />
                              {item.location}
                            </Badge>
                          ) : null}
                          {item.keywords.slice(0, 4).map((keyword) => (
                            <Badge key={`${item.id}-${keyword}`} variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
                              {keyword}
                            </Badge>
                          ))}
                          {item.selectedTags.slice(0, 2).map((tag) => (
                            <Badge key={`${item.id}-tag-${tag}`} variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
                              <Tags className="mr-1 h-3 w-3" />
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t('quickStart.assistant.lastOpened', 'Last opened')}: {formatTimestamp(item.lastOpenedAt)}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="h-10 px-4"
                        disabled={!onApplyHistoryItem}
                        onClick={() => {
                          void handleApplyHistory(item)
                        }}
                      >
                        {t('quickStart.assistant.openHistory', 'Open search')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                {t('quickStart.assistant.noHistory', 'No saved searches yet. Save one from the shell to make it reusable here.')}
              </p>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
