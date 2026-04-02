import { X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/contexts/WorkspaceContext'

const STORAGE_KEY = 'trends.resume.search-first.migration-banner.dismissed'

export function MigrationBanner() {
  const { slug } = useWorkspace()
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    setDismissed(localStorage.getItem(STORAGE_KEY) === '1')
  }, [])

  if (dismissed) {
    return null
  }

  return (
    <div className="flex flex-col gap-3 rounded-[1.5rem] border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-900 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <div className="font-medium">
          {t('resumes.searchPage.banner.title', {
            defaultValue: 'Search-first quick starts now open in Search Profiles.',
          })}
        </div>
        <div className="text-sky-800/80">
          {t('resumes.searchPage.banner.description', {
            defaultValue: 'Use this page for fast keyword review, or open Search Profiles to edit and run saved quick starts.',
          })}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link className="inline-flex h-9 items-center rounded-md border border-sky-200 bg-white px-3 text-sm font-medium" to={`/${slug}/system/profiles`}>
          {t('resumes.searchPage.banner.openProfiles', {
            defaultValue: 'Open Search Profiles',
          })}
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full"
          onClick={() => {
            localStorage.setItem(STORAGE_KEY, '1')
            setDismissed(true)
          }}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">
            {t('resumes.searchPage.banner.dismiss', {
              defaultValue: 'Dismiss migration banner',
            })}
          </span>
        </Button>
      </div>
    </div>
  )
}
