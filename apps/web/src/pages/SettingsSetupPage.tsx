import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Download, Play, Puzzle, Search } from 'lucide-react'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { reportUiError } from '@/lib/ui-error-reporting'
import { fetchExtensionMetaJson } from '@/lib/external-fetch'

type ExtensionMeta = { version: string }

function isExtensionMeta(value: unknown): value is ExtensionMeta {
  if (typeof value !== 'object' || value === null || !('version' in value)) return false
  return typeof (value as ExtensionMeta).version === 'string' && (value as ExtensionMeta).version.trim().length > 0
}

function getSetupStepStorageKey(slug: string, step: number) {
  return `setup-step:${slug}:${step}`
}

function useStepDone(slug: string, step: number): [boolean, () => void] {
  const key = getSetupStepStorageKey(slug, step)
  const [done, setDone] = useState(() => localStorage.getItem(key) === 'done')

  useEffect(() => {
    setDone(localStorage.getItem(key) === 'done')
  }, [key])

  const markDone = () => {
    localStorage.setItem(key, 'done')
    setDone(true)
  }

  return [done, markDone]
}

function useExtensionVersion() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const payload: unknown = await fetchExtensionMetaJson()
        if (!cancelled && isExtensionMeta(payload)) {
          setVersion(payload.version)
        }
      } catch (error) {
        reportUiError('Failed to load extension metadata', error)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return version
}

export function SettingsSetupPage() {
  const { t } = useTranslation()
  const { slug } = useWorkspace()
  const extensionVersion = useExtensionVersion()
  const [step1Done, markStep1] = useStepDone(slug, 1)
  const [step2Done, markStep2] = useStepDone(slug, 2)
  const [step3Done, markStep3] = useStepDone(slug, 3)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {t('settings.setup.title', { defaultValue: 'Setup' })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('settings.setup.description', {
            defaultValue: 'Get started in 3 steps: install the extension, configure search setup, and launch your first collection from the resumes desk.',
          })}
        </p>
      </div>

      <Card className={step1Done ? 'border-green-200 bg-green-50/30' : ''}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">1</div>
            <div className="flex-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Puzzle className="h-4 w-4" />
                {t('setup.step1Title', { defaultValue: 'Install Extension' })}
              </CardTitle>
              <CardDescription>
                {t('setup.step1Description', { defaultValue: 'Install the browser extension to collect resumes from job boards.' })}
              </CardDescription>
            </div>
            {step1Done && <CheckCircle2 className="h-5 w-5 text-green-600" data-testid="check-icon" />}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {extensionVersion ? (
            <div className="flex items-center gap-3">
              <Download className="h-4 w-4 text-muted-foreground" />
              <a
                href="/extension/trends-resume-collector-latest.zip"
                className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
              >
                {t('quickStart.downloadExtension', { version: extensionVersion, defaultValue: `Download Extension v${extensionVersion}` })}
              </a>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('setup.step1InstallHint', {
                defaultValue: 'Install the browser extension to begin collecting resumes. Download link will appear once the extension is built.',
              })}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {t('setup.step1Instructions', {
              defaultValue: 'After downloading, open chrome://extensions, enable Developer mode, and drag the zip file to install.',
            })}
          </p>
          {!step1Done && (
            <Button variant="outline" size="sm" onClick={markStep1}>
              {t('setup.markDone', { defaultValue: 'Mark as done' })}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className={step2Done ? 'border-green-200 bg-green-50/30' : ''}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">2</div>
            <div className="flex-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Search className="h-4 w-4" />
                {t('setup.step2Title', { defaultValue: 'Configure Search' })}
              </CardTitle>
              <CardDescription>
                {t('setup.step2Description', { defaultValue: 'Set up keywords and locations to target the right candidates.' })}
              </CardDescription>
            </div>
            {step2Done && <CheckCircle2 className="h-5 w-5 text-green-600" data-testid="check-icon" />}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t('setup.step2Hint', {
              defaultValue: 'Add keywords related to the positions you’re hiring for and choose which locations should stay visible during search.',
            })}
          </p>
          <div className="flex gap-2">
            <Link to={`/${slug}/settings/keywords`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {t('settings.setup.goToSearchSetup', { defaultValue: 'Go to Search Setup' })}
            </Link>
            {!step2Done && (
              <Button variant="outline" size="sm" onClick={markStep2}>
                {t('setup.markDone', { defaultValue: 'Mark as done' })}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className={step3Done ? 'border-green-200 bg-green-50/30' : ''}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">3</div>
            <div className="flex-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Play className="h-4 w-4" />
                {t('setup.step3Title', { defaultValue: 'First Crawl' })}
              </CardTitle>
              <CardDescription>
                {t('setup.step3Description', { defaultValue: 'Open the resumes desk, start your first collection, and verify the results.' })}
              </CardDescription>
            </div>
            {step3Done && <CheckCircle2 className="h-5 w-5 text-green-600" data-testid="check-icon" />}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t('settings.setup.step3Hint', {
              defaultValue: 'Use the resumes workspace to launch collection from Quick Start and review incoming candidates in the normal desk.',
            })}
          </p>
          <div className="flex gap-2">
            <Link to={`/${slug}/resumes`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {t('settings.setup.goToResumes', { defaultValue: 'Go to Resumes' })}
            </Link>
            {!step3Done && (
              <Button variant="outline" size="sm" onClick={markStep3}>
                {t('setup.markDone', { defaultValue: 'Mark as done' })}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
