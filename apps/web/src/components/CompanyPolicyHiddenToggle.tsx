import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

type CompanyPolicyHiddenToggleProps = {
  hiddenCount: number
  showHidden: boolean
  onShowHiddenChange: (show: boolean) => void
  className?: string
}

export function CompanyPolicyHiddenToggle({
  hiddenCount,
  showHidden,
  onShowHiddenChange,
  className,
}: CompanyPolicyHiddenToggleProps) {
  const { t } = useTranslation()

  if (hiddenCount <= 0 && !showHidden) {
    return null
  }

  return (
    <div
      className={cn('flex flex-wrap items-center gap-2 text-sm', className)}
      data-testid="company-policy-hidden-toggle"
    >
      {hiddenCount > 0 ? (
        <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 text-[10px]">
          {t('settings.policies.runtime.hiddenCount', {
            defaultValue: '{{count}} hidden by company policy',
            count: hiddenCount,
          })}
        </Badge>
      ) : null}
      <label className="flex items-center gap-2 cursor-pointer text-muted-foreground">
        <Checkbox
          checked={showHidden}
          onCheckedChange={(checked) => onShowHiddenChange(checked === true)}
          data-testid="company-policy-show-hidden"
        />
        <span>
          {t('settings.policies.runtime.showHidden', {
            defaultValue: 'Show company-policy hidden',
          })}
        </span>
      </label>
    </div>
  )
}
