import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ExperienceLevelFilter } from '@/hooks/useUrlSearchState'

interface ActiveTagFiltersProps {
  selectedTags: string[]
  selectedCompanies: string[]
  selectedExperienceLevel?: ExperienceLevelFilter
  onRemoveTag: (tag: string) => void
  onRemoveCompany: (company: string) => void
  onRemoveExperienceLevel: (level: ExperienceLevelFilter | undefined) => void
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
  selectedExperienceLevel,
  onRemoveTag,
  onRemoveCompany,
  onRemoveExperienceLevel,
  onClearAll,
}: ActiveTagFiltersProps) {
  const hasActiveFilters =
    selectedTags.length > 0
    || selectedCompanies.length > 0
    || Boolean(selectedExperienceLevel)

  if (!hasActiveFilters) {
    return null
  }

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
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
