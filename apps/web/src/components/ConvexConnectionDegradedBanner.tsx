import { WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

type ConvexConnectionDegradedBannerProps = {
  onRetry: () => void
}

export function ConvexConnectionDegradedBanner({
  onRetry,
}: ConvexConnectionDegradedBannerProps) {
  const { t } = useTranslation()

  return (
    <div
      data-testid="convex-connection-degraded-banner"
      className="flex flex-col items-center gap-3 rounded-[1.5rem] border border-destructive/40 bg-destructive/5 px-6 py-8 text-center"
      role="alert"
    >
      <WifiOff className="h-8 w-8 text-destructive/70" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {t('resumes.searchPage.connection.disconnectedTitle', {
            defaultValue: 'Connection interrupted',
          })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('resumes.searchPage.connection.disconnectedDescription', {
            defaultValue:
              'Live data is temporarily unavailable. Retry when the connection is back, or wait for it to restore.',
          })}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {t('common.retry', { defaultValue: 'Retry' })}
      </Button>
    </div>
  )
}
