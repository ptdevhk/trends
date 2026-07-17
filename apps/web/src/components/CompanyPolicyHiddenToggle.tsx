import { useTranslation } from 'react-i18next'
import { Building2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

type CompanyPolicyHiddenToggleProps = {
  hiddenCount: number
  showHidden: boolean
  onShowHiddenChange: (show: boolean) => void
  className?: string
  /**
   * `bar` — compact row meant for inside BulkActionBar (default).
   * `standalone` — self-contained border (legacy/tests).
   */
  variant?: 'bar' | 'standalone'
}

/**
 * Company-policy hide recovery control.
 * Styled to match BulkActionBar chips (rounded-full pills + muted text).
 */
export function CompanyPolicyHiddenToggle({
  hiddenCount,
  showHidden,
  onShowHiddenChange,
  className,
  variant = 'bar',
}: CompanyPolicyHiddenToggleProps) {
  const { t } = useTranslation()

  if (hiddenCount <= 0 && !showHidden) {
    return null
  }

  const countLabel = t('settings.policies.runtime.hiddenCount', {
    defaultValue: '{{count}} hidden by company policy',
    count: hiddenCount,
  })
  const showLabel = t('settings.policies.runtime.showHidden', {
    defaultValue: 'Show company-policy hidden',
  })

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1',
        variant === 'standalone' && 'rounded-lg border bg-muted/50 p-3 gap-2',
        className,
      )}
      data-testid="company-policy-hidden-toggle"
    >
      {hiddenCount > 0 ? (
        <span
          className={cn(
            // Match status chip density (全部状态 / 新候选人)
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
            'border-red-200 bg-red-50 font-medium text-red-700',
          )}
          data-testid="company-policy-hidden-count"
          title={countLabel}
        >
          <Building2 className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
          {countLabel}
        </span>
      ) : null}

      <label
        className={cn(
          'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors',
          showHidden
            ? 'border-primary bg-primary/10 font-medium text-primary'
            : 'border-border text-muted-foreground hover:bg-muted',
        )}
      >
        <Checkbox
          checked={showHidden}
          onCheckedChange={(checked) => onShowHiddenChange(checked === true)}
          data-testid="company-policy-show-hidden"
          className="h-3.5 w-3.5"
        />
        <span>{showLabel}</span>
      </label>
    </div>
  )
}
