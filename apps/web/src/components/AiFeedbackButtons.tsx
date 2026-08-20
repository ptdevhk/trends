import { useTranslation } from 'react-i18next'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AiFeedbackSentiment } from '@/types/resume'

interface AiFeedbackButtonsProps {
  feedback?: AiFeedbackSentiment
  label: string
  onSelect: (sentiment: AiFeedbackSentiment) => void
  testId?: string
  className?: string
  stopPropagation?: boolean
}

export function AiFeedbackButtons({
  feedback,
  label,
  onSelect,
  testId,
  className,
  stopPropagation = false,
}: AiFeedbackButtonsProps) {
  const { t } = useTranslation()
  return (
    <span className={cn('flex items-center gap-0.5', className)} data-testid={testId}>
      <Button
        variant="ghost"
        size="icon"
        className={cn('h-6 w-6', feedback === 'like' && 'text-emerald-600 bg-emerald-50')}
        onClick={(event) => {
          if (stopPropagation) {
            event.stopPropagation()
          }
          onSelect('like')
        }}
        aria-label={t('feedback.likeAria', { label, defaultValue: `Like ${label}` })}
        aria-pressed={feedback === 'like'}
      >
        <ThumbsUp className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn('h-6 w-6', feedback === 'unlike' && 'text-red-600 bg-red-50')}
        onClick={(event) => {
          if (stopPropagation) {
            event.stopPropagation()
          }
          onSelect('unlike')
        }}
        aria-label={t('feedback.unlikeAria', { label, defaultValue: `Unlike ${label}` })}
        aria-pressed={feedback === 'unlike'}
      >
        <ThumbsDown className="h-3 w-3" />
      </Button>
    </span>
  )
}
