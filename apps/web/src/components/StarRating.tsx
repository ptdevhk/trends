import { useCallback, useRef, useState } from 'react'
import { Star, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

export function StarRating({
  value,
  onChange,
  onRatingComment,
  initialComment,
  disabled = false,
  size = 16,
}: {
  value?: number
  onChange?: (rating: number) => void
  onRatingComment?: (comment: string) => void
  initialComment?: string
  disabled?: boolean
  size?: number
}) {
  const readOnly = disabled || !onChange
  const { t } = useTranslation()

  const [commentOpen, setCommentOpen] = useState(false)
  const [commentText, setCommentText] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)
  const justOpenedRef = useRef(false)

  const handleSaveComment = useCallback(() => {
    if (commentText.trim()) {
      onRatingComment?.(commentText.trim())
    }
    setCommentOpen(false)
    setCommentText('')
  }, [commentText, onRatingComment])

  const handleDismissComment = useCallback(() => {
    setCommentOpen(false)
    setCommentText('')
  }, [])

  return (
    <div ref={wrapperRef} className="relative flex items-center gap-0.5" role="group" aria-label="User rating">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = typeof value === 'number' && star <= value
        return (
          <button
            key={star}
            type="button"
            className="p-0 leading-none disabled:cursor-not-allowed disabled:opacity-70"
            disabled={readOnly}
            onClick={(e) => {
              e.stopPropagation()
              if (readOnly) return
              const isClearing = value === star
              onChange?.(isClearing ? 0 : star)
              if (!isClearing && onRatingComment) {
                setCommentOpen(true)
                setCommentText(initialComment ?? '')
                justOpenedRef.current = true
                requestAnimationFrame(() => { justOpenedRef.current = false })
              } else if (isClearing) {
                setCommentOpen(false)
                setCommentText('')
              }
            }}
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
          >
            <Star
              size={size}
              className={filled
                ? 'fill-amber-400 text-amber-400'
                : 'text-slate-300 hover:text-amber-300'}
            />
          </button>
        )
      })}

      {commentOpen && (
        <div
          className="absolute top-full left-0 mt-2 z-50 w-72 rounded-lg border border-slate-700 bg-slate-800 p-3 shadow-xl"
          data-testid="rating-comment-popover"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <MessageSquare size={13} className="text-amber-400" />
            <span className="text-xs font-medium text-slate-200">
              {t('resumes.ratingComment.title', { defaultValue: '添加评价备注' })}
            </span>
          </div>

          <Textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={t('resumes.ratingComment.placeholder', { defaultValue: '写一下你对这个候选人的评价...' })}
            className="min-h-[60px] text-xs bg-slate-700 border-slate-600 text-white placeholder:text-slate-400 resize-none"
            autoFocus
            data-testid="rating-comment-input"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSaveComment()
              }
              if (e.key === 'Escape') {
                handleDismissComment()
              }
            }}
          />

          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-slate-400 hover:text-white"
              onClick={(e) => {
                e.stopPropagation()
                handleDismissComment()
              }}
              data-testid="rating-comment-cancel"
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs"
              onClick={(e) => {
                e.stopPropagation()
                handleSaveComment()
              }}
              data-testid="rating-comment-save"
            >
              {t('common.save', { defaultValue: 'Save' })}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
