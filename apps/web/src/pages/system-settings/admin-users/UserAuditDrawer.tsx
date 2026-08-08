import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { listAdminUserAuthEvents, type AdminUserRecord } from '@/lib/admin-users'
import type { AuthEvent } from '@/lib/auth'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: AdminUserRecord | null
}

export function UserAuditDrawer({ open, onOpenChange, user }: Props) {
  const { t } = useTranslation()
  const [events, setEvents] = useState<AuthEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const result = await listAdminUserAuthEvents(user.id)
      if (result.success === false) {
        setEvents([])
        setError(result.error)
        return
      }
      setEvents(result.events)
    } catch (err) {
      console.error(err)
      setEvents([])
      setError(t('debugConfig.adminUsersAuditLoadFailed', { defaultValue: 'Failed to load audit events' }))
    } finally {
      setLoading(false)
    }
    // t is i18n; intentionally omit from deps to avoid remount loops when t identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    if (open && user) {
      void load()
    } else {
      setEvents([])
      setError(null)
    }
  }, [open, user, load])

  function handleClose() {
    setEvents([])
    setError(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) handleClose()
    }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="user-audit-drawer">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-4">
            <span>
              {t('debugConfig.adminUsersViewAudit', { defaultValue: 'Auth events' })}
              {user && (
                <span className="ml-2 text-base font-normal text-muted-foreground">
                  {user.displayName ?? user.email ?? user.id}
                </span>
              )}
            </span>
            <Button
              variant="outline"
              size="sm"
              data-testid="audit-refresh"
              onClick={() => {
                void load()
              }}
              disabled={loading}
            >
              <RefreshCw className="mr-1 h-3 w-3" />
              {t('common.refresh', { defaultValue: 'Refresh' })}
            </Button>
          </DialogTitle>
          <DialogDescription>
            {t('debugConfig.adminUsersAuditDescription', {
              defaultValue: 'Authentication and authorization events for this user.',
            })}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {t('debugConfig.adminUsersAuditLoading', { defaultValue: 'Loading events...' })}
          </div>
        ) : error ? (
          <div className="py-6 text-center text-sm text-destructive">{error}</div>
        ) : events.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {t('debugConfig.adminUsersAuditEmpty', { defaultValue: 'No events found.' })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Workspace</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{event.type}</td>
                    <td className="px-3 py-2">{event.workspaceSlug ?? '-'}</td>
                    <td className="px-3 py-2">{event.provider ?? '-'}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {event.reason ?? '-'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {event.createdAt}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
