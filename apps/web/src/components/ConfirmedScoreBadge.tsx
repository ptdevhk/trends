import { Badge } from '@/components/ui/badge'
import { useTranslation } from 'react-i18next'

export function ConfirmedScoreBadge() {
  const { t } = useTranslation()
  return (
    <Badge variant="outline" className="text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700">
      ✓ {t('resumes.searchPage.card.confirmed', { defaultValue: 'Confirmed' })}
    </Badge>
  )
}
