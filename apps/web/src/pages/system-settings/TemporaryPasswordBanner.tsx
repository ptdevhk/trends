import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

export function TemporaryPasswordBanner({
  password,
  onDismiss,
}: {
  password: string
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="temp-password-panel"
      className="sticky top-16 z-30 rounded-md border border-amber-200 bg-amber-50 p-4 shadow-sm"
    >
      <div className="mb-2 text-sm font-medium text-amber-800">
        {t('debugConfig.adminUsersTempPasswordTitle', { defaultValue: 'Temporary password' })}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <code className="rounded bg-white px-2 py-1 font-mono text-sm break-all">
          {password}
        </code>
        <Button
          variant="outline"
          size="sm"
          data-testid="copy-temp-password"
          onClick={() => {
            void navigator.clipboard.writeText(password)
            toast.success(t('debugConfig.adminUsersTempPasswordCopied', {
              defaultValue: 'Password copied to clipboard',
            }))
          }}
        >
          <Copy className="mr-1 h-3 w-3" />
          {t('debugConfig.adminUsersTempPasswordCopy', { defaultValue: 'Copy password' })}
        </Button>
      </div>
      <p className="text-xs text-amber-700">
        {t('debugConfig.adminUsersTempPasswordWarning', {
          defaultValue: 'Copy this now. It will not be shown again after you close this dialog.',
        })}
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="mt-2"
        data-testid="close-temp-password"
        onClick={onDismiss}
      >
        Dismiss
      </Button>
    </div>
  )
}
