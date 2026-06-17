import { Star } from 'lucide-react'

export function StarRating({
  value,
  onChange,
  disabled = false,
  size = 16,
}: {
  value?: number
  onChange?: (rating: number) => void
  disabled?: boolean
  size?: number
}) {
  const readOnly = disabled || !onChange

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="User rating">
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
              if (readOnly) {
                return
              }
              onChange?.(value === star ? 0 : star)
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
    </div>
  )
}
