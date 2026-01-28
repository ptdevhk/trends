import { useTranslation } from 'react-i18next'
import { TrendingUp } from 'lucide-react'
import { LanguageSwitcher } from './LanguageSwitcher'

export function Header() {
  const { t } = useTranslation()

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-6 w-6 text-primary" />
          <div className="flex items-baseline gap-1">
            <span className="font-bold text-lg">{t('app.title')}</span>
            <span className="text-sm text-muted-foreground">{t('app.subtitle')}</span>
          </div>
        </div>
        <LanguageSwitcher />
      </div>
    </header>
  )
}
