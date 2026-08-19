import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { isRecord } from '@trends/shared'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { reportUiError } from '@/lib/ui-error-reporting'
import { useSettingsRequestJson } from '@/pages/system-settings/lib'
import {
  parseUnresolvedQueueView,
  type UnresolvedQueueItem,
  type UnresolvedQueueStatus,
  type UnresolvedQueueView,
} from './unresolved-queue-model'

const STATUS_TABS: UnresolvedQueueStatus[] = ['unresolved', 'linked', 'ignored', 'all']

/**
 * Unresolved employer queue (admin): employer names that failed to resolve
 * to a company during capture. Rows can be linked to a canonical companyKey
 * or ignored; resolutions are persisted server-side and re-applied on every
 * load. Capture is untouched — this page only consumes the offline queue.
 */
export function SystemSettingsUnresolvedQueuePage() {
  const { t } = useTranslation()
  const { requestJson } = useSettingsRequestJson()
  const [view, setView] = useState<UnresolvedQueueView | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [status, setStatus] = useState<UnresolvedQueueStatus>('unresolved')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set())
  const [linkTargets, setLinkTargets] = useState<Readonly<Record<string, string>>>({})
  const [bulkTarget, setBulkTarget] = useState('')
  const [resolving, setResolving] = useState(false)

  const load = useCallback(async () => {
    setLoadFailed(false)
    try {
      const params = new URLSearchParams()
      params.set('status', status)
      if (search.trim()) params.set('search', search.trim())
      const data = await requestJson(`/api/industry-data/unresolved?${params.toString()}`)
      setView(parseUnresolvedQueueView(data))
    } catch (error) {
      setLoadFailed(true)
      reportUiError('Failed to load unresolved employer queue', error)
      toast.error(
        t('unresolvedQueue.loadFailed', {
          defaultValue: 'Failed to load the unresolved employer queue',
        }),
      )
    }
  }, [requestJson, search, status, t])

  useEffect(() => {
    void load()
  }, [load])

  const applySearch = useCallback(() => {
    setSearch(searchInput.trim())
  }, [searchInput])

  const setLinkTarget = useCallback((key: string, value: string) => {
    setLinkTargets((prev) => ({ ...prev, [key]: value }))
  }, [])

  const toggleSelected = useCallback((key: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(key)
      } else {
        next.delete(key)
      }
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set())
  }, [])

  const resolveKeys = useCallback(
    async (keys: string[], action: 'link' | 'ignore', targetCompanyKey?: string) => {
      const target = targetCompanyKey?.trim()
      if (action === 'link' && !target) {
        toast.error(
          t('unresolvedQueue.requiresTarget', {
            defaultValue: 'Enter a company key to link.',
          }),
        )
        return
      }
      setResolving(true)
      try {
        const data = await requestJson('/api/industry-data/unresolved/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keys,
            action,
            ...(target ? { targetCompanyKey: target } : {}),
          }),
        })
        const payload = isRecord(data) ? data : {}
        const resolvedCount = Array.isArray(payload.resolved) ? payload.resolved.length : keys.length
        if (action === 'link') {
          toast.success(
            t('unresolvedQueue.linkSuccess', {
              defaultValue: 'Linked {{count}} employer key(s)',
              count: resolvedCount,
            }),
          )
        } else {
          toast.success(
            t('unresolvedQueue.ignoreSuccess', {
              defaultValue: 'Ignored {{count}} employer key(s)',
              count: resolvedCount,
            }),
          )
        }
        clearSelection()
        setBulkTarget('')
        await load()
      } catch (error) {
        reportUiError('Failed to resolve unresolved employer keys', error)
        toast.error(
          t('unresolvedQueue.resolveFailed', {
            defaultValue: 'Failed to update employer keys',
          }),
        )
      } finally {
        setResolving(false)
      }
    },
    [clearSelection, load, requestJson, t],
  )

  const counts = useMemo(() => view?.counts ?? null, [view])
  const selectedCount = selectedKeys.size
  const loading = view === null && !loadFailed

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">
          {t('unresolvedQueue.title', { defaultValue: 'Unresolved employer queue' })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('unresolvedQueue.description', {
            defaultValue:
              'Employer names that failed to resolve to a company during capture. Link them to a canonical company key or ignore them.',
          })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab}
            type="button"
            variant={status === tab ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setStatus(tab)}
            data-testid={`unresolved-queue-tab-${tab}`}
          >
            {t(`unresolvedQueue.statusTabs.${tab}`, { defaultValue: tab })}
            {counts ? ` (${tab === 'all' ? counts.total : counts[tab]})` : ''}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') applySearch()
          }}
          placeholder={t('unresolvedQueue.searchPlaceholder', {
            defaultValue: 'Search employer names…',
          })}
          className="max-w-xs"
          data-testid="unresolved-queue-search-input"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={applySearch}
          data-testid="unresolved-queue-search-button"
        >
          {t('unresolvedQueue.search', { defaultValue: 'Search' })}
        </Button>
      </div>

      {loading ? (
        <div
          className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground"
          data-testid="unresolved-queue-loading"
        >
          {t('unresolvedQueue.loading', { defaultValue: 'Loading unresolved employers…' })}
        </div>
      ) : null}

      {loadFailed && view === null ? (
        <div
          className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground"
          data-testid="unresolved-queue-error"
        >
          {t('unresolvedQueue.loadFailed', {
            defaultValue: 'Failed to load the unresolved employer queue',
          })}
          <div className="mt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void load()}
              data-testid="unresolved-queue-retry"
            >
              {t('unresolvedQueue.retry', { defaultValue: 'Retry' })}
            </Button>
          </div>
        </div>
      ) : null}

      {view !== null && view.items.length === 0 ? (
        <div
          className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground"
          data-testid="unresolved-queue-empty"
        >
          {t('unresolvedQueue.empty', {
            defaultValue: 'No employer names match this filter.',
          })}
        </div>
      ) : null}

      {view !== null && view.items.length > 0 ? (
        <Card data-testid="unresolved-queue-section">
          <CardHeader>
            <CardTitle className="text-base">
              {t('unresolvedQueue.sectionTitle', { defaultValue: 'Queue' })} ({view.total})
            </CardTitle>
            <CardDescription>
              {t('unresolvedQueue.sectionDescription', {
                defaultValue:
                  'Priority rows appear first (frequency, nearby score, or sell-brand misspelling). Linking records the canonical company key; ignoring records the decision so the row stops reappearing.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedCount > 0 ? (
              <div
                className="mb-4 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2"
                data-testid="unresolved-queue-bulk-bar"
              >
                <span className="text-xs text-muted-foreground">
                  {t('unresolvedQueue.selected', { defaultValue: '{{count}} selected', count: selectedCount })}
                </span>
                <Input
                  value={bulkTarget}
                  onChange={(event) => setBulkTarget(event.target.value)}
                  placeholder={t('unresolvedQueue.bulkTargetPlaceholder', {
                    defaultValue: 'Company key for all selected…',
                  })}
                  className="max-w-xs"
                  data-testid="unresolved-queue-bulk-target"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={resolving}
                  onClick={() => void resolveKeys([...selectedKeys], 'link', bulkTarget)}
                  data-testid="unresolved-queue-bulk-link"
                >
                  {t('unresolvedQueue.bulkLink', { defaultValue: 'Link selected' })}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={resolving}
                  onClick={() => void resolveKeys([...selectedKeys], 'ignore')}
                  data-testid="unresolved-queue-bulk-ignore"
                >
                  {t('unresolvedQueue.bulkIgnore', { defaultValue: 'Ignore selected' })}
                </Button>
              </div>
            ) : null}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <span className="sr-only">
                      {t('unresolvedQueue.column.select', { defaultValue: 'Select' })}
                    </span>
                  </TableHead>
                  <TableHead>{t('unresolvedQueue.column.employer', { defaultValue: 'Employer' })}</TableHead>
                  <TableHead>{t('unresolvedQueue.column.count', { defaultValue: 'Count' })}</TableHead>
                  <TableHead>{t('unresolvedQueue.column.score', { defaultValue: 'Nearby score' })}</TableHead>
                  <TableHead>{t('unresolvedQueue.column.priority', { defaultValue: 'Priority' })}</TableHead>
                  <TableHead>{t('unresolvedQueue.column.resolution', { defaultValue: 'Resolution' })}</TableHead>
                  <TableHead>{t('unresolvedQueue.column.actions', { defaultValue: 'Actions' })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.items.map((item) => (
                  <QueueRow
                    key={item.normalizedKey}
                    item={item}
                    selected={selectedKeys.has(item.normalizedKey)}
                    resolving={resolving}
                    linkTarget={linkTargets[item.normalizedKey] ?? ''}
                    onToggle={(checked) => toggleSelected(item.normalizedKey, checked)}
                    onLinkTargetChange={(value) => setLinkTarget(item.normalizedKey, value)}
                    onLink={() => void resolveKeys([item.normalizedKey], 'link', linkTargets[item.normalizedKey])}
                    onIgnore={() => void resolveKeys([item.normalizedKey], 'ignore')}
                    t={t}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

type QueueRowProps = {
  item: UnresolvedQueueItem
  selected: boolean
  resolving: boolean
  linkTarget: string
  onToggle: (checked: boolean) => void
  onLinkTargetChange: (value: string) => void
  onLink: () => void
  onIgnore: () => void
  t: (key: string, opts?: { defaultValue?: string; count?: number }) => string
}

function QueueRow({
  item,
  selected,
  resolving,
  linkTarget,
  onToggle,
  onLinkTargetChange,
  onLink,
  onIgnore,
  t,
}: QueueRowProps) {
  const key = item.normalizedKey
  const resolution = item.resolution
  return (
    <TableRow data-testid={`unresolved-queue-row-${key}`}>
      <TableCell>
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onToggle(checked === true)}
          aria-label={t('unresolvedQueue.column.select', { defaultValue: 'Select' })}
          data-testid={`unresolved-queue-select-${key}`}
        />
      </TableCell>
      <TableCell>
        <div className="space-y-1">
          <div className="font-mono text-sm font-medium">{key}</div>
          {item.examples.length > 0 ? (
            <div className="flex max-w-xs flex-wrap gap-1">
              {item.examples.map((example) => (
                <Badge key={example} variant="outline" className="text-[10px]">
                  {example}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <span className="font-mono text-sm">{item.count}</span>
      </TableCell>
      <TableCell>
        <span className="font-mono text-sm">{item.maxNearbyScore}</span>
      </TableCell>
      <TableCell>
        {item.priority ? (
          <Badge
            variant="secondary"
            className="text-[10px]"
            data-testid={`unresolved-queue-priority-${key}`}
          >
            {t('unresolvedQueue.priorityBadge', { defaultValue: 'Priority' })}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        {resolution ? (
          <Badge
            variant={resolution.action === 'link' ? 'default' : 'outline'}
            className="max-w-[220px] truncate font-mono text-[10px]"
            data-testid={`unresolved-queue-resolution-${key}`}
          >
            {resolution.action === 'link'
              ? t('unresolvedQueue.linkedTo', {
                  defaultValue: 'Linked: {{companyKey}}',
                  companyKey: resolution.targetCompanyKey ?? '—',
                })
              : t('unresolvedQueue.ignored', { defaultValue: 'Ignored' })}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        {resolution ? (
          <span className="text-xs text-muted-foreground">
            {resolution.resolvedBy ?? ''}
            {resolution.resolvedAt ? ` · ${resolution.resolvedAt}` : ''}
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={linkTarget}
              onChange={(event) => onLinkTargetChange(event.target.value)}
              placeholder={t('unresolvedQueue.linkTargetPlaceholder', {
                defaultValue: 'Company key…',
              })}
              className="h-8 w-40"
              data-testid={`unresolved-queue-link-target-${key}`}
            />
            <Button
              type="button"
              size="sm"
              disabled={resolving}
              onClick={onLink}
              data-testid={`unresolved-queue-link-${key}`}
            >
              {t('unresolvedQueue.link', { defaultValue: 'Link' })}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={resolving}
              onClick={onIgnore}
              data-testid={`unresolved-queue-ignore-${key}`}
            >
              {t('unresolvedQueue.ignore', { defaultValue: 'Ignore' })}
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  )
}
