import { useTranslation } from 'react-i18next'
import { Select } from '@/components/ui/select'
import { PLATFORMS } from '@/lib/api'

interface PlatformFilterProps {
  value: string
  onChange: (value: string) => void
}

export function PlatformFilter({ value, onChange }: PlatformFilterProps) {
  const { t } = useTranslation()

  const options = [
    { value: '', label: t('trends.allPlatforms') },
    ...PLATFORMS.map((p) => ({
      value: p.id,
      label: t(`platforms.${p.id}`, { defaultValue: p.name }),
    })),
  ]

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-muted-foreground whitespace-nowrap">
        {t('trends.platform')}:
      </label>
      <Select
        options={options}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-40"
      />
    </div>
  )
}
