import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'

export type SourceFacet = {
  key: string
  label: string
  count: number
}

interface SourceFacetSelectProps {
  id: string
  facets: SourceFacet[] | undefined
  value: string[]
  onChange: (value: string[]) => void
}

export function SourceFacetSelect({ id, facets, value, onChange }: SourceFacetSelectProps) {
  const { t } = useTranslation()

  const options = (Array.isArray(facets) ? facets : []).map((item) => ({
    value: item.key,
    label: `${item.label} (${item.count})`,
  }))

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onChange(Array.from(event.target.selectedOptions).map((option) => option.value))
  }

  return (
    <div className="flex min-w-[220px] flex-col gap-1">
      <Label htmlFor={id}>
        {t('debugIngest.sourceFilter', { defaultValue: 'Source Filter' })}
      </Label>
      <select
        id={id}
        multiple
        value={value}
        onChange={handleChange}
        className="min-h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
        aria-label={t('debugIngest.sourceFilter', { defaultValue: 'Source Filter' })}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
