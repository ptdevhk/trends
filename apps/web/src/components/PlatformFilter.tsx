import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Select } from '@/components/ui/select'
import { PLATFORMS } from '@/lib/api'

interface PlatformFilterProps {
  value: string
  onChange: (value: string) => void
}

export function PlatformFilter({ value, onChange }: PlatformFilterProps) {
  const { t } = useTranslation()

  const options = useMemo(() => [
    { value: '', label: t('trends.allPlatforms') },
    ...PLATFORMS.map((p) => ({
      value: p.id,
      label: t(`platforms.${p.id}`, { defaultValue: p.name }),
    })),
  ], [t])

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="platform-filter" className="text-sm text-muted-foreground whitespace-nowrap">
        {t('trends.platform')}:
      </label>
      <Select
        id="platform-filter"
        options={options}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-40"
      />
    </div>
  )
}
