import { useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { Activity, ArrowRight, Bot, FileText, Map, ShieldAlert, Tags } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSystemMetadata } from '@/hooks/useSystemMetadata'
import { resolveSystemSettingsSubpages, type SystemSettingsSubpageDefinition } from '@/pages/system-settings/lib'

function getSectionIcon(id: SystemSettingsSubpageDefinition['id']) {
  switch (id) {
    case 'operations':
      return Activity
    case 'runtime':
      return Bot
    case 'config-sources':
      return FileText
    case 'keywords':
      return Tags
    case 'locations':
      return Map
    default:
      return FileText
  }
}

export default function DebugConfig() {
  const { t } = useTranslation()
  const metadata = useSystemMetadata()
  const resetDatabase = useMutation(api.resume_tasks.resetDatabase)
  const [resetDatabaseDialogOpen, setResetDatabaseDialogOpen] = useState(false)
  const [resettingDatabase, setResettingDatabase] = useState(false)

  const sectionCards = useMemo(() => {
    return resolveSystemSettingsSubpages(metadata?.navigation.systemSettings)
      .filter((item) => item.id !== 'overview')
      .map((item) => ({
        ...item,
        title: t(item.titleKey, { defaultValue: item.defaultTitle }),
        description: t(item.descriptionKey, { defaultValue: item.defaultDescription }),
        icon: getSectionIcon(item.id),
      }))
  }, [metadata?.navigation.systemSettings, t])

  async function handleResetDatabase() {
    setResettingDatabase(true)
    try {
      await resetDatabase()
      setResetDatabaseDialogOpen(false)
      toast.success('Database has been reset')
    } catch (error) {
      console.error('Failed to reset database', error)
      toast.error('Failed to reset database')
    } finally {
      setResettingDatabase(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-border/60 bg-gradient-to-br from-background via-background to-muted/30">
        <CardContent className="space-y-4 p-6">
          <div className="space-y-2">
            <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
              {t('debugConfig.settingsOverviewLabel', { defaultValue: 'Settings overview' })}
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {t('debugConfig.settingsOverviewTitle', {
                defaultValue: 'Open each system settings area in its own page.',
              })}
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {t('debugConfig.settingsOverviewPageDescription', {
                defaultValue: 'Use the local settings navigation above to move directly to runtime, config, keyword, or location management without scrolling through one giant page.',
              })}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sectionCards.map((item) => (
          <Link key={item.id} to={item.href} className="group block">
            <Card className="h-full border-border/60 transition-colors group-hover:border-primary/40 group-hover:bg-primary/5">
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <div className="space-y-1">
                  <CardTitle className="text-lg">{item.title}</CardTitle>
                  <CardDescription>{item.description}</CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      <section className="space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            <h2 className="text-xl font-semibold tracking-tight text-destructive">{t('debugConfig.dangerZone')}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{t('debugConfig.dangerZoneDescription')}</p>
        </div>

        <Card className="border-destructive/50">
          <CardContent className="p-6">
            <div className="flex flex-col gap-4 rounded-lg border border-destructive/20 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="font-medium text-destructive">{t('debugConfig.resetDatabase')}</p>
                <p className="text-sm text-destructive/80">{t('debugConfig.resetDatabaseDescription')}</p>
              </div>
              <Button
                variant="destructive"
                onClick={() => setResetDatabaseDialogOpen(true)}
                disabled={resettingDatabase}
              >
                {t('debugConfig.resetDatabase')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <Dialog
        open={resetDatabaseDialogOpen}
        onOpenChange={(open) => {
          if (!resettingDatabase) {
            setResetDatabaseDialogOpen(open)
          }
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event) => {
            if (resettingDatabase) {
              event.preventDefault()
            }
          }}
          onPointerDownOutside={(event) => {
            if (resettingDatabase) {
              event.preventDefault()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('debugConfig.resetDatabase')}</DialogTitle>
            <DialogDescription>{t('debugConfig.resetDatabaseConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetDatabaseDialogOpen(false)}
              disabled={resettingDatabase}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                handleResetDatabase().catch((error) => {
                  console.error('Unexpected handleResetDatabase failure', error)
                })
              }}
              disabled={resettingDatabase}
            >
              {t('debugConfig.resetDatabase')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
