import { Check } from 'lucide-react'
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
  const isAiMode = mode === 'ai'

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={isAiMode}
        onClick={() => onModeChange(isAiMode ? 'original' : 'ai')}
        disabled={disabled}
        className={cn(
          'inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-2.5 py-1.5 text-sm shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <span
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 ease-out',
            isAiMode
              ? 'border-sky-500 bg-sky-500'
              : 'border-slate-300 bg-slate-300',
          )}
        >
          <span
            className={cn(
              'pointer-events-none absolute left-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-white shadow-sm transition-transform duration-200 ease-out',
              isAiMode ? 'translate-x-5' : 'translate-x-0',
            )}
          >
            {isAiMode ? <Check className="h-3.5 w-3.5 text-sky-600" /> : null}
          </span>
        </span>
        <span className="font-medium text-slate-900">{t('resumes.mode.ai')}</span>
      </button>

      {isAiMode && aiStats ? (
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-sky-500 px-2 text-xs font-semibold text-white">
          {aiStats.matched}
        </span>
      ) : null}
    </div>
  )
}
