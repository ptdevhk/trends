import type { ReactNode } from 'react'
import { Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type IndustryAdvancedToolsProps = {
  children: ReactNode
  targetedRecompute?: ReactNode
}

export function IndustryAdvancedTools({ children, targetedRecompute }: IndustryAdvancedToolsProps) {
  const { t } = useTranslation()

  return (
    <details className="group rounded-2xl border bg-card shadow-sm" data-testid="industry-advanced-tools">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
            <Wrench className="h-4 w-4" />
          </span>
          <span>
            <span className="block font-semibold">
              {t('industryEvidence.advancedTools', { defaultValue: 'Advanced tools' })}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {t('industryEvidence.advancedToolsDescription', {
                defaultValue: 'Coverage, approved lookup, recompute, and maintenance history',
              })}
            </span>
          </span>
        </span>
        <span className="text-xs font-medium text-muted-foreground group-open:hidden">
          {t('industryEvidence.expandAdvancedTools', { defaultValue: 'Show tools' })}
        </span>
        <span className="hidden text-xs font-medium text-muted-foreground group-open:inline">
          {t('industryEvidence.collapseAdvancedTools', { defaultValue: 'Hide tools' })}
        </span>
      </summary>
      <div className="space-y-6 border-t px-5 py-5">
        {children}
        {targetedRecompute ? (
          <div className="border-t pt-6">{targetedRecompute}</div>
        ) : null}
      </div>
    </details>
  )
}
