import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { isImeComposition } from '@/lib/utils'
import { createPortal } from 'react-dom'
import { Star, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

const POPOVER_WIDTH = 288 // w-72

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
  const [editing, setEditing] = useState(true)
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 })
  const wrapperRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const openCommentPopover = useCallback(() => {
    const existing = (initialComment ?? '').trim()
    setCommentText(existing)
    setEditing(existing.length === 0)
    setCommentOpen(true)
  }, [initialComment])

  const handleSaveComment = useCallback(() => {
    const trimmed = commentText.trim()
    if (trimmed) {
      onRatingComment?.(trimmed)
    }
    setCommentOpen(false)
    setCommentText('')
    setEditing(true)
  }, [commentText, onRatingComment])

  const handleDismissComment = useCallback(() => {
    setCommentOpen(false)
    setCommentText('')
    setEditing(true)
  }, [])

  useLayoutEffect(() => {
    if (!commentOpen || !wrapperRef.current) {
      return
    }

    const updatePosition = () => {
      const trigger = wrapperRef.current
      if (!trigger) {
        return
      }
      const rect = trigger.getBoundingClientRect()
      const left = Math.min(
        Math.max(8, rect.left),
        Math.max(8, window.innerWidth - POPOVER_WIDTH - 8),
      )
      const top = rect.bottom + 8
      setPopoverPos({ top, left })
    }

    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [commentOpen])

  useLayoutEffect(() => {
    if (!commentOpen) {
      return
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (wrapperRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return
      }
      handleDismissComment()
    }

    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [commentOpen, handleDismissComment])

  const popover =
    commentOpen && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[100] w-72 rounded-lg border bg-popover text-popover-foreground p-3 shadow-lg"
            style={{ top: popoverPos.top, left: popoverPos.left }}
            data-testid="rating-comment-popover"
            data-portal="true"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <MessageSquare size={13} className="text-amber-500" />
              <span className="text-xs font-medium text-foreground">
                {editing
                  ? t('resumes.ratingComment.title', { defaultValue: 'Add Rating Note' })
                  : t('resumes.ratingComment.viewTitle', { defaultValue: 'User Comment' })}
              </span>
            </div>

            {editing ? (
              <Textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={t('resumes.ratingComment.placeholder', {
                  defaultValue: '写一下你对这个候选人的评价...',
                })}
                className="min-h-[60px] text-xs resize-none"
                autoFocus
                data-testid="rating-comment-input"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  // Ignore IME composition key events (e.g. Enter confirming a Chinese candidate).
                  if (isImeComposition(e)) {
                    return
                  }
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                    e.preventDefault()
                    handleSaveComment()
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    handleDismissComment()
                  }
                }}
              />
            ) : (
              <p
                className="min-h-[60px] text-xs text-foreground whitespace-pre-wrap break-words rounded-md border bg-muted/40 px-2 py-1.5"
                data-testid="rating-comment-view"
              >
                {commentText}
              </p>
            )}

            <div className="flex justify-end gap-2 mt-2">
              <span className="text-[10px] text-muted-foreground mr-auto" data-testid="rating-comment-shortcut-hint">{t('resumes.card.notesSaveShortcut')}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDismissComment()
                }}
                data-testid="rating-comment-cancel"
              >
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Button>
              {editing ? (
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
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditing(true)
                  }}
                  data-testid="rating-comment-edit"
                >
                  {t('common.edit', { defaultValue: 'Edit' })}
                </Button>
              )}
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <div ref={wrapperRef} className="relative flex items-center gap-0.5" role="group" aria-label="User rating">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = typeof value === 'number' && star <= value
        return (
          <button
            key={star}
            type="button"
            className="p-0 leading-none disabled:cursor-not-allowed disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
            disabled={readOnly}
            onClick={(e) => {
              e.stopPropagation()
              if (readOnly) return
              const isClearing = value === star
              onChange?.(isClearing ? 0 : star)
              if (!isClearing && onRatingComment) {
                openCommentPopover()
              } else if (isClearing) {
                handleDismissComment()
              }
            }}
            aria-label={t('resumes.rating.starValue', { count: star, defaultValue: '{{count}} star' })}
          >
            <Star
              size={size}
              className={filled
                ? 'fill-amber-400 text-amber-400'
                : 'text-muted-foreground hover:text-amber-400'}
            />
          </button>
        )
      })}
      {popover}
    </div>
  )
}
