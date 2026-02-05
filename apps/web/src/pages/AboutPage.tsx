import { useTranslation } from 'react-i18next'

export function AboutPage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6">
      <h1 className="text-3xl font-semibold">{t('about.title')}</h1>
      <p className="text-muted-foreground">{t('about.testText')}</p>
    </div>
  )
}
