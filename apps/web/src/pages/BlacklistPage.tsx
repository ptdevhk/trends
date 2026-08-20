import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { useCandidateBlocks } from '@/hooks/useCandidateBlocks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function BlacklistPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation()
  const { items, loading, error, unblockCandidate, updateBlockReason } = useCandidateBlocks()
  const [search, setSearch] = useState('')
  const [selectedIdentityKeys, setSelectedIdentityKeys] = useState<string[]>([])
  const [editingIdentityKey, setEditingIdentityKey] = useState<string | null>(null)
  const [editingReason, setEditingReason] = useState('')
  const [savingReason, setSavingReason] = useState(false)
  const [bulkUnblocking, setBulkUnblocking] = useState(false)
  const [rowUnblockingIdentityKey, setRowUnblockingIdentityKey] = useState<string | null>(null)
  const [pendingUnblockId, setPendingUnblockId] = useState<string | null>(null)

  useEffect(() => {
    const currentKeys = new Set(items.map((item) => item.identityKey))
    setSelectedIdentityKeys((previous) => previous.filter((identityKey) => currentKeys.has(identityKey)))
  }, [items])

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    const sorted = [...items].sort((a, b) => b.blockedAt - a.blockedAt)
    if (!keyword) {
      return sorted
    }

    return sorted.filter((item) => {
      const reason = item.reason ?? ''
      return item.identityKey.toLowerCase().includes(keyword) || reason.toLowerCase().includes(keyword)
    })
  }, [items, search])

  const filteredIdentityKeys = useMemo(() => filteredItems.map((item) => item.identityKey), [filteredItems])
  const selectedVisibleCount = useMemo(
    () => filteredIdentityKeys.filter((identityKey) => selectedIdentityKeys.includes(identityKey)).length,
    [filteredIdentityKeys, selectedIdentityKeys]
  )
  const allVisibleSelected = filteredIdentityKeys.length > 0 && selectedVisibleCount === filteredIdentityKeys.length
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected

  const toggleAllVisible = useCallback(
    (checked: boolean) => {
      setSelectedIdentityKeys((previous) => {
        if (checked) {
          return Array.from(new Set([...previous, ...filteredIdentityKeys]))
        }
        const visible = new Set(filteredIdentityKeys)
        return previous.filter((identityKey) => !visible.has(identityKey))
      })
    },
    [filteredIdentityKeys]
  )

  const toggleOne = useCallback((identityKey: string, checked: boolean) => {
    setSelectedIdentityKeys((previous) => {
      if (checked) {
        return Array.from(new Set([...previous, identityKey]))
      }
      return previous.filter((item) => item !== identityKey)
    })
  }, [])

  const startEditing = useCallback((identityKey: string, reason?: string) => {
    setEditingIdentityKey(identityKey)
    setEditingReason(reason ?? '')
  }, [])

  const cancelEditing = useCallback(() => {
    setEditingIdentityKey(null)
    setEditingReason('')
    setSavingReason(false)
  }, [])

  const commitReason = useCallback(
    async (identityKey: string) => {
      if (savingReason || editingIdentityKey !== identityKey) {
        return
      }

      const nextReason = editingReason.trim()
      const existing = items.find((item) => item.identityKey === identityKey)
      const currentReason = (existing?.reason ?? '').trim()
      if (currentReason === nextReason) {
        cancelEditing()
        return
      }

      setSavingReason(true)
      const updated = await updateBlockReason(identityKey, nextReason.length > 0 ? nextReason : undefined)
      setSavingReason(false)

      if (!updated) {
        toast.error(t('settings.blocks.toasts.reasonUpdateFailed', { defaultValue: 'Failed to update block reason' }))
        return
      }

      toast.success(t('settings.blocks.toasts.reasonUpdated', { defaultValue: 'Block reason updated' }))
      cancelEditing()
    },
    [cancelEditing, editingIdentityKey, editingReason, items, savingReason, t, updateBlockReason]
  )

  const handleUnblock = useCallback(
    async (identityKey: string) => {
      setPendingUnblockId(null)
      setRowUnblockingIdentityKey(identityKey)
      const removed = await unblockCandidate(identityKey)
      setRowUnblockingIdentityKey(null)

      if (!removed) {
        toast.error(t('settings.blocks.toasts.unblockFailed', { defaultValue: 'Failed to unblock candidate' }))
        return
      }

      setSelectedIdentityKeys((previous) => previous.filter((item) => item !== identityKey))
      toast.success(t('settings.blocks.toasts.unblockSuccess', { defaultValue: 'Candidate unblocked' }))
    },
    [t, unblockCandidate]
  )

  const handleBulkUnblock = useCallback(async () => {
    if (selectedIdentityKeys.length === 0 || bulkUnblocking) {
      return
    }

    setBulkUnblocking(true)
    let removedCount = 0

    for (const identityKey of selectedIdentityKeys) {
      const removed = await unblockCandidate(identityKey)
      if (removed) {
        removedCount += 1
      }
    }

    setBulkUnblocking(false)
    setSelectedIdentityKeys([])

    if (removedCount > 0) {
      toast.success(
        t('settings.blocks.toasts.bulkUnblockSuccess', {
          defaultValue: 'Unblocked {{count}} candidate(s)',
          count: removedCount,
        })
      )
      if (removedCount === selectedIdentityKeys.length) {
        return
      }
    }

    toast.error(t('settings.blocks.toasts.bulkUnblockFailed', { defaultValue: 'Failed to unblock selected candidates' }))
  }, [bulkUnblocking, selectedIdentityKeys, t, unblockCandidate])

  const isEmpty = items.length === 0
  const hasNoFilteredResults = !isEmpty && filteredItems.length === 0

  return (
    <div className="space-y-6" data-testid="blacklist-page">
      {!embedded ? (
        <PageHeader
          title={t('settings.blocks.title', { defaultValue: 'Blacklist Management' })}
          description={t('settings.blocks.description', { defaultValue: 'View and manage blocked candidates for this workspace.' })}
          actions={
            <Badge variant="secondary" data-testid="blacklist-count-badge">
              {t('settings.blocks.countBadge', { defaultValue: '{{count}} blocked', count: items.length })}
            </Badge>
          }
        />
      ) : null}

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>{t('settings.blocks.nav', { defaultValue: 'Blacklist' })}</CardTitle>
              <CardDescription>
                {t('settings.blocks.description', { defaultValue: 'View and manage blocked candidates for this workspace.' })}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('settings.blocks.searchPlaceholder', { defaultValue: 'Search by candidate key or reason...' })}
                className="w-full sm:w-72"
                data-testid="blacklist-search-input"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleBulkUnblock()}
                disabled={selectedIdentityKeys.length === 0 || bulkUnblocking}
                data-testid="blacklist-bulk-unblock"
              >
                {t('settings.blocks.bulkUnblock', { defaultValue: 'Unblock Selected ({{count}})', count: selectedIdentityKeys.length })}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {loading ? <div className="text-sm text-muted-foreground">{t('resumes.loading', { defaultValue: 'Loading...' })}</div> : null}
          {!loading && error ? <div className="text-sm text-destructive">{error}</div> : null}
          {!loading && !error && isEmpty ? (
            <div className="text-sm text-muted-foreground">{t('settings.blocks.empty', { defaultValue: 'No blocked candidates yet.' })}</div>
          ) : null}
          {!loading && !error && hasNoFilteredResults ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground" data-testid="blacklist-empty-search">
              <span>
                {t('settings.blocks.emptySearch', { defaultValue: 'No blocked candidates match your search.' })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSearch('')}
                data-testid="blacklist-clear-search"
              >
                {t('settings.blocks.clearSearch', { defaultValue: 'Clear search' })}
              </Button>
            </div>
          ) : null}

          {!loading && !error && filteredItems.length > 0 ? (
            <Table data-testid="blacklist-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[42px]">
                    <Checkbox
                      checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                      onCheckedChange={(checked: boolean | 'indeterminate') => toggleAllVisible(checked === true)}
                      aria-label={t('bulkActions.selectAll', { defaultValue: 'Select all' })}
                      data-testid="blacklist-select-all"
                    />
                  </TableHead>
                  <TableHead>{t('settings.blocks.columns.candidate', { defaultValue: 'Candidate' })}</TableHead>
                  <TableHead>{t('settings.blocks.columns.reason', { defaultValue: 'Reason' })}</TableHead>
                  <TableHead>{t('settings.blocks.columns.blockedAt', { defaultValue: 'Blocked Date' })}</TableHead>
                  <TableHead>{t('settings.blocks.columns.blockedBy', { defaultValue: 'Blocked By' })}</TableHead>
                  <TableHead className="text-right">{t('settings.blocks.columns.actions', { defaultValue: 'Actions' })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => {
                  const isEditing = editingIdentityKey === item.identityKey
                  const isRowUnblocking = rowUnblockingIdentityKey === item.identityKey
                  const displayedReason = item.reason?.trim()

                  return (
                    <TableRow key={item._id} data-testid="blacklist-row" data-identity-key={item.identityKey}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIdentityKeys.includes(item.identityKey)}
                          onCheckedChange={(checked: boolean | 'indeterminate') => toggleOne(item.identityKey, checked === true)}
                          aria-label={item.identityKey}
                          data-testid="blacklist-row-checkbox"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.identityKey}</TableCell>
                      <TableCell className="max-w-[360px]">
                        {isEditing ? (
                          <Input
                            value={editingReason}
                            onChange={(event) => setEditingReason(event.target.value)}
                            onBlur={() => void commitReason(item.identityKey)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                event.currentTarget.blur()
                              } else if (event.key === 'Escape') {
                                event.preventDefault()
                                cancelEditing()
                              }
                            }}
                            disabled={savingReason}
                            autoFocus
                            className="h-8"
                            data-testid="blacklist-reason-input"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEditing(item.identityKey, item.reason)}
                            className="w-full text-left text-sm hover:text-foreground text-muted-foreground"
                            data-testid="blacklist-reason-display"
                          >
                            {displayedReason || t('settings.blocks.noReason', { defaultValue: '-' })}
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{new Date(item.blockedAt).toLocaleString()}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.blockedBy?.trim() || '-'}</TableCell>
                      <TableCell className="text-right">
                        {pendingUnblockId === item.identityKey ? (
                          <div
                            className="inline-flex items-center gap-2 rounded-full border bg-muted px-3 py-1"
                            data-testid="unblock-confirm-row"
                          >
                            <span className="text-xs">
                              {t('settings.blocks.unblockConfirm', { defaultValue: 'Unblock this candidate?' })}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={isRowUnblocking || bulkUnblocking}
                              onClick={() => void handleUnblock(item.identityKey)}
                              data-testid="unblock-confirm-yes"
                            >
                              {t('settings.blocks.unblockConfirmYes', { defaultValue: 'Yes, unblock' })}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={isRowUnblocking}
                              onClick={() => setPendingUnblockId(null)}
                              data-testid="unblock-confirm-cancel"
                            >
                              {t('settings.blocks.actions.cancel', { defaultValue: 'Cancel' })}
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isRowUnblocking || bulkUnblocking}
                            onClick={() => setPendingUnblockId(item.identityKey)}
                            data-testid="blacklist-row-unblock"
                          >
                            {t('settings.blocks.actions.unblock', { defaultValue: 'Unblock' })}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
