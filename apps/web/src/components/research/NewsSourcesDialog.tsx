import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type NewsSourcesDialogSeedGroup = {
  id: string
  label: string
  feeds: string[]
}

export type NewsSourcesDialogSeed = {
  version: string
  groups: NewsSourcesDialogSeedGroup[]
  catalogIds: string[]
  defaultGroupIds: string[]
}

export type NewsSourcesDialogWorkspace = {
  version: 1
  masterEnabled?: boolean
  excludedGroups: string[]
  excludedFeeds: string[]
  enabledFeeds: string[]
}

export type NewsSourcesDialogState = {
  seed: NewsSourcesDialogSeed
  workspace: NewsSourcesDialogWorkspace
  effective: string[]
}

export type NewsSourcesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: NewsSourcesDialogState | null
  saving?: boolean
  onSave: (body: {
    masterEnabled?: boolean
    excludedGroups: string[]
    excludedFeeds: string[]
    enabledFeeds: string[]
  }) => void | Promise<void>
}

/**
 * 数据源 (CNC news sources): master on/off + per-group enable + per-feed toggles.
 * Opt-out (default-ON): save sends the opt-out vectors (masterEnabled + excluded*
 * + enabledFeeds), matching the workspace overlay shape.
 */
export function NewsSourcesDialog({
  open,
  onOpenChange,
  initial,
  saving = false,
  onSave,
}: NewsSourcesDialogProps) {
  const { t } = useTranslation()
  const [master, setMaster] = useState<boolean>(true)
  const [excludedGroups, setExcludedGroups] = useState<Set<string>>(() => new Set())
  const [excludedFeeds, setExcludedFeeds] = useState<Set<string>>(() => new Set())
  const [enabledFeeds, setEnabledFeeds] = useState<Set<string>>(() => new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !initial) return
    setMaster(initial.workspace.masterEnabled ?? true)
    setExcludedGroups(new Set(initial.workspace.excludedGroups))
    setExcludedFeeds(new Set(initial.workspace.excludedFeeds))
    setEnabledFeeds(new Set(initial.workspace.enabledFeeds))
    setCollapsed(new Set())
    setLocalError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const groups = initial?.seed.groups ?? []
  const defaultGroups = new Set(initial?.seed.defaultGroupIds ?? [])
  const catalogSet = new Set(initial?.seed.catalogIds ?? [])

  // A feed is ON iff (master AND its group is not excluded) OR it's explicitly
  // in enabledFeeds — but excludedFeeds always wins.
  const isFeedOn = (feed: string, groupId: string): boolean => {
    if (excludedFeeds.has(feed)) return false
    if (enabledFeeds.has(feed)) return true
    if (!master) return false
    if (excludedGroups.has(groupId)) return false
    return defaultGroups.has(groupId)
  }

  const isGroupOn = (groupId: string): boolean => {
    if (!master) return false
    if (excludedGroups.has(groupId)) {
      // ON if any child feed is force-enabled
      const g = groups.find((x) => x.id === groupId)
      return !!g?.feeds.some((f) => isFeedOn(f, groupId) && enabledFeeds.has(f))
    }
    return defaultGroups.has(groupId)
  }

  const toggleMaster = (next: boolean) => {
    setMaster(next)
    setLocalError(null)
  }

  const toggleGroupHeaders = (groupId: string, next: boolean) => {
    setExcludedGroups((prev) => {
      const copy = new Set(prev)
      if (next) copy.delete(groupId)
      else copy.add(groupId)
      return copy
    })
    setLocalError(null)
  }

  const toggleFeed = (feed: string, groupId: string, next: boolean) => {
    if (next) {
      // turning ON: if group is OFF, use the escape-hatch enabledFeeds
      const groupOff = !master || excludedGroups.has(groupId) || !defaultGroups.has(groupId)
      setExcludedFeeds((prev) => {
        const c = new Set(prev)
        c.delete(feed)
        return c
      })
      if (groupOff) {
        setEnabledFeeds((prev) => {
          const c = new Set(prev)
          c.add(feed)
          return c
        })
      } else {
        setEnabledFeeds((prev) => {
          const c = new Set(prev)
          c.delete(feed)
          return c
        })
      }
    } else {
      // turning OFF inside an ON group => excludedFeeds; remove from enabledFeeds too
      setExcludedFeeds((prev) => {
        const c = new Set(prev)
        c.add(feed)
        return c
      })
      setEnabledFeeds((prev) => {
        const c = new Set(prev)
        c.delete(feed)
        return c
      })
    }
    setLocalError(null)
  }

  const toggleCollapse = (groupId: string) => {
    setCollapsed((prev) => {
      const c = new Set(prev)
      if (c.has(groupId)) c.delete(groupId)
      else c.add(groupId)
      return c
    })
  }

  const activeFeedCount = useMemo(() => {
    let n = 0
    for (const g of groups) {
      for (const f of g.feeds) {
        if (isFeedOn(f, g.id)) n += 1
      }
    }
    return n
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [master, excludedGroups, excludedFeeds, enabledFeeds, groups, defaultGroups])

  const handleSave = () => {
    void onSave({
      masterEnabled: master,
      excludedGroups: [...excludedGroups],
      excludedFeeds: [...excludedFeeds],
      enabledFeeds: [...enabledFeeds].filter((f) => catalogSet.has(f)),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="research-news-sources-dialog" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('research.newsSources.dialogTitle', { defaultValue: '新闻数据源' })}
          </DialogTitle>
          <DialogDescription>
            {t('research.newsSources.dialogDescription', {
              defaultValue:
                '管理 CNC/机床新闻数据源（默认全部开启）。可关闭整体，或按组 / 按单个源关闭。',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border border-primary"
              checked={master}
              onChange={(e) => toggleMaster(e.target.checked)}
              data-testid="research-news-sources-master"
            />
            <span>
              {t('research.newsSources.master', { defaultValue: '启用 CNC/机床新闻数据源' })}
            </span>
          </label>

          {groups.map((group) => {
            const groupOn = isGroupOn(group.id)
            return (
              <div key={group.id} className="rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleCollapse(group.id)}
                    className="flex-1 cursor-pointer text-left text-sm font-medium"
                    data-testid={`research-news-sources-group-header-${group.id}`}
                  >
                    <span>{group.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {groupOn ? '（开）' : '（关）'}
                    </span>
                  </button>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border border-primary"
                    checked={groupOn}
                    onChange={(e) => toggleGroupHeaders(group.id, e.target.checked)}
                    data-testid={`research-news-sources-group-toggle-${group.id}`}
                  />
                </div>
                {!collapsed.has(group.id) ? (
                  <ul className="mt-2 space-y-1">
                    {group.feeds.map((feed) => (
                      <li key={feed}>
                        <label className="flex cursor-pointer items-center gap-2 text-sm font-normal">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border border-primary"
                            checked={isFeedOn(feed, group.id)}
                            onChange={(e) => toggleFeed(feed, group.id, e.target.checked)}
                            data-testid={`research-news-sources-feed-toggle-${feed}`}
                          />
                          <span className="font-mono text-[10px] text-muted-foreground">{feed}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )
          })}
          {localError ? (
            <p className="text-xs text-red-600" data-testid="research-news-sources-local-error">
              {localError}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground" data-testid="research-news-sources-active-count">
            {t('research.newsSources.activeCount', {
              defaultValue: `已启用 ${activeFeedCount} 个数据源`,
              count: activeFeedCount,
            })}
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel', { defaultValue: '取消' })}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving} data-testid="research-news-sources-save">
            {saving
              ? t('common.saving', { defaultValue: '保存中…' })
              : t('common.save', { defaultValue: '保存' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
