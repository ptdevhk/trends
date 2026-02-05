import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface ModeToggleProps {
  mode: 'ai' | 'original'
  onModeChange: (mode: 'ai' | 'original') => void
  aiStats?: { avgScore: number; matched: number; processed?: number }
  disabled?: boolean
}

export function ModeToggle({ mode, onModeChange, aiStats, disabled }: ModeToggleProps) {
  const { t } = useTranslation()

  const options = [
    { value: 'ai' as const, label: t('resumes.mode.ai') },
    { value: 'original' as const, label: t('resumes.mode.original') },
  ]

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex items-center rounded-full border bg-muted p-1 text-sm">
        {options.map((option) => {
          const active = mode === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onModeChange(option.value)}
              disabled={disabled}
              className={cn(
                'px-3 py-1 rounded-full transition',
                active ? 'bg-background shadow text-foreground' : 'text-muted-foreground',
                disabled && 'opacity-60'
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>

      {mode === 'ai' && aiStats ? (
        <span className="text-xs text-muted-foreground">
          {t('resumes.matching.stats', {
            matched: aiStats.matched,
            processed: aiStats.processed ?? aiStats.matched,
            avgScore: aiStats.avgScore,
          })}
        </span>
      ) : null}
    </div>
  )
}
