import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'

type FacetBadgeProps = {
  activeCount: number
  floating?: boolean
  onClick: () => void
}

export function FacetBadge({ activeCount, floating = false, onClick }: FacetBadgeProps) {
  return (
    <Button
      type="button"
      variant="outline"
      className={floating ? 'rounded-full bg-white shadow-lg' : 'rounded-full bg-white'}
      onClick={onClick}
    >
      <SlidersHorizontal className="mr-2 h-4 w-4" />
      Filters
      {activeCount > 0 ? (
        <span className="ml-2 rounded-full bg-slate-900 px-2 py-0.5 text-xs text-white">
          {activeCount}
        </span>
      ) : null}
    </Button>
  )
}
