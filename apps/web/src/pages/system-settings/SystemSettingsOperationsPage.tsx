import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { api } from '../../../../../packages/convex/convex/_generated/api'
import { SchedulerStatus } from '@/components/SchedulerStatus'
import { TaskMonitor } from '@/components/TaskMonitor'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSettingsRequestJson } from '@/pages/system-settings/lib'
import { SystemSummary } from '@/pages/system-settings/SystemSummary'

export function SystemSettingsOperationsPage() {
  const { t } = useTranslation()
  const { apiBaseUrl } = useSettingsRequestJson()
  const dispatchCollection = useMutation(api.resume_tasks.dispatch)

  const [collectionKeyword, setCollectionKeyword] = useState('')
  const [collectionLocation, setCollectionLocation] = useState('广东')
  const [collectionLimit, setCollectionLimit] = useState('200')
  const [collectionMaxPages, setCollectionMaxPages] = useState('10')

  async function handleStartCollection() {
    if (!collectionKeyword.trim()) {
      toast.error('Please enter a keyword')
      return
    }

    try {
      const limit = parseInt(collectionLimit, 10) || 200
      const maxPages = parseInt(collectionMaxPages, 10) || 10

      await dispatchCollection({
        keyword: collectionKeyword.trim(),
        location: collectionLocation.trim(),
        limit,
        maxPages,
      })
      toast.success('Collection task dispatched')
      setCollectionKeyword('')
    } catch (error) {
      console.error('Failed to dispatch collection', error)
      toast.error('Failed to start collection')
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t('debugConfig.settingsNavOperations', { defaultValue: 'Operations' })}</h2>
        <p className="text-sm text-muted-foreground">
          {t('debugConfig.operationsPageDescription', {
            defaultValue: 'Live diagnostics and manual collection controls.',
          })}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <SystemSummary />
        <SchedulerStatus apiBaseUrl={apiBaseUrl} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('debugConfig.resumeDataCollection')}</CardTitle>
          <CardDescription>{t('debugConfig.resumeDataCollectionDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="col-keyword" className="text-sm font-medium">{t('debugConfig.keyword')}</label>
              <Input
                id="col-keyword"
                data-testid="ops-collection-keyword"
                placeholder={t('debugConfig.keywordPlaceholder')}
                value={collectionKeyword}
                onChange={(event) => setCollectionKeyword(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="col-location" className="text-sm font-medium">{t('debugConfig.location')}</label>
              <Input
                id="col-location"
                data-testid="ops-collection-location"
                placeholder={t('debugConfig.locationPlaceholder')}
                value={collectionLocation}
                onChange={(event) => setCollectionLocation(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="col-limit" className="text-sm font-medium">{t('debugConfig.limitResumes')}</label>
              <Input
                id="col-limit"
                data-testid="ops-collection-limit"
                type="number"
                placeholder="200"
                value={collectionLimit}
                onChange={(event) => setCollectionLimit(event.target.value)}
                onFocus={(event) => event.target.select()}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="col-max-pages" className="text-sm font-medium">{t('debugConfig.maxPages')}</label>
              <Input
                id="col-max-pages"
                data-testid="ops-collection-max-pages"
                type="number"
                placeholder="10"
                value={collectionMaxPages}
                onChange={(event) => setCollectionMaxPages(event.target.value)}
                onFocus={(event) => event.target.select()}
              />
            </div>
          </div>
          <Button
            data-testid="ops-start-collection"
            onClick={() => {
              handleStartCollection().catch((error) => {
                console.error('Unexpected handleStartCollection failure', error)
              })
            }}
            className="w-full sm:w-auto"
          >
            {t('debugConfig.startCollection')}
          </Button>

          <div className="mt-6">
            <TaskMonitor />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
