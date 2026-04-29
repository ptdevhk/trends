import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ExperienceLevelFilter } from '@/hooks/useUrlSearchState'

interface ActiveTagFiltersProps {
  selectedTags: string[]
  selectedCompanies: string[]
  selectedBrands: string[]
  selectedExperienceLevel?: ExperienceLevelFilter
  selectedLocation?: string
  onRemoveTag: (tag: string) => void
  onRemoveCompany: (company: string) => void
  onRemoveBrand: (brand: string) => void
  onRemoveExperienceLevel: (level: ExperienceLevelFilter | undefined) => void
  onRemoveLocation?: () => void
  onClearAll: () => void
}

function getExperienceLabel(level: ExperienceLevelFilter): string {
  if (level === 'senior') return '资深'
  if (level === 'mid') return '中级'
  return '初级'
}

export function ActiveTagFilters({
  selectedTags,
  selectedCompanies,
  selectedBrands,
  selectedExperienceLevel,
  selectedLocation,
  onRemoveTag,
  onRemoveCompany,
  onRemoveBrand,
  onRemoveExperienceLevel,
  onRemoveLocation,
  onClearAll,
}: ActiveTagFiltersProps) {
  const normalizedLocation = selectedLocation?.trim()
  const hasActiveFilters =
    Boolean(normalizedLocation)
    ||
    selectedTags.length > 0
    || selectedCompanies.length > 0
    || selectedBrands.length > 0
    || Boolean(selectedExperienceLevel)

  if (!hasActiveFilters) {
    return null
  }

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {normalizedLocation ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-green-700 bg-green-600 px-2 py-1 text-xs font-medium text-white"
            onClick={() => onRemoveLocation?.()}
          >
            📍 {normalizedLocation}
            <X className="h-3 w-3" />
          </button>
        ) : null}

        {selectedTags.map((tag) => (
          <button
            key={`tag-${tag}`}
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-violet-700 bg-violet-600 px-2 py-1 text-xs font-medium text-white"
            onClick={() => onRemoveTag(tag)}
          >
            {tag}
            <X className="h-3 w-3" />
          </button>
        ))}

        {selectedCompanies.map((company) => (
          <button
            key={`company-${company}`}
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-blue-700 bg-blue-600 px-2 py-1 text-xs font-medium text-white"
            onClick={() => onRemoveCompany(company)}
          >
            {company.toUpperCase()}
            <X className="h-3 w-3" />
          </button>
        ))}

        {selectedBrands.map((brand) => (
          <button
            key={`brand-${brand}`}
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-amber-700 bg-amber-600 px-2 py-1 text-xs font-medium text-white"
            onClick={() => onRemoveBrand(brand)}
          >
            {brand}
            <X className="h-3 w-3" />
          </button>
        ))}

        {selectedExperienceLevel ? (
          <button
            type="button"
            className={
              selectedExperienceLevel === 'senior'
                ? 'inline-flex items-center gap-1 rounded-full border border-orange-700 bg-orange-600 px-2 py-1 text-xs font-medium text-white'
                : selectedExperienceLevel === 'mid'
                  ? 'inline-flex items-center gap-1 rounded-full border border-teal-700 bg-teal-600 px-2 py-1 text-xs font-medium text-white'
                  : 'inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-600 px-2 py-1 text-xs font-medium text-white'
            }
            onClick={() => onRemoveExperienceLevel(selectedExperienceLevel)}
          >
            {getExperienceLabel(selectedExperienceLevel)}
            <X className="h-3 w-3" />
          </button>
        ) : null}

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={onClearAll}
        >
          Clear All
        </Button>
      </div>
    </div>
  )
}
