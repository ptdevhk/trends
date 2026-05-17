import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from 'convex/react'
import { toast } from 'sonner'
import { api } from '../../../../packages/convex/convex/_generated/api'

const EVENT_STALE_MS = 30_000

export function useSyncNotifications(enabled: boolean = true) {
  const { t } = useTranslation()
  const latestEvent = useQuery(api.sync_events.getLatest, enabled ? {} : 'skip')
  const initializedRef = useRef(false)
  const lastSeenTimestampRef = useRef(0)

  useEffect(() => {
    if (!enabled) {
      initializedRef.current = false
      lastSeenTimestampRef.current = 0
      return
    }

    if (latestEvent === undefined) {
      return
    }

    const eventTimestamp = latestEvent?.timestamp ?? 0

    if (!initializedRef.current) {
      initializedRef.current = true
      lastSeenTimestampRef.current = eventTimestamp
      return
    }

    if (!latestEvent || eventTimestamp <= lastSeenTimestampRef.current) {
      return
    }

    lastSeenTimestampRef.current = eventTimestamp

    if (Date.now() - eventTimestamp > EVENT_STALE_MS) {
      return
    }

    if (latestEvent.status === 'success') {
      toast.success(
        t('syncNotifications.success', {
          submitted: latestEvent.submitted,
          inserted: latestEvent.inserted,
          updated: latestEvent.updated,
          defaultValue: `Synced ${latestEvent.submitted} resumes (${latestEvent.inserted} new, ${latestEvent.updated} updated)`,
        })
      )
    } else {
      toast.error(
        t('syncNotifications.error', {
          error: latestEvent.error || 'Unknown error',
          defaultValue: `Sync failed: ${latestEvent.error || 'Unknown error'}`,
        })
      )
    }
  }, [enabled, latestEvent, t])
}
