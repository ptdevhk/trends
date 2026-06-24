import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Download, Puzzle, Search, Play } from 'lucide-react'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button, buttonVariants } from '@/components/ui/button'
import { reportUiError } from '@/lib/ui-error-reporting'

const STORAGE_KEY_PREFIX = 'setup-step-'

function useStepDone(step: number): [boolean, () => void] {
  const key = `${STORAGE_KEY_PREFIX}${step}`
  const [done, setDone] = useState(() => localStorage.getItem(key) === 'done')

  const markDone = () => {
    localStorage.setItem(key, 'done')
    setDone(true)
  }

  return [done, markDone]
}

const EXTENSION_META_URL = '/extension/extension-meta.json'

type ExtensionMeta = { version: string }

function isExtensionMeta(value: unknown): value is ExtensionMeta {
  if (typeof value !== 'object' || value === null || !('version' in value)) return false
  return typeof (value as ExtensionMeta).version === 'string' && (value as ExtensionMeta).version.trim().length > 0
}

function useExtensionVersion() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch(EXTENSION_META_URL)
        if (!response.ok) return
        const payload: unknown = await response.json()
        if (!cancelled && isExtensionMeta(payload)) {
          setVersion(payload.version)
        }
      } catch (error) {
        reportUiError('Failed to load extension metadata', error)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  return version
}

export function SystemSetupPage() {
  const { t } = useTranslation()
  const { slug } = useWorkspace()
  const extensionVersion = useExtensionVersion()
  const [step1Done, markStep1] = useStepDone(1)
  const [step2Done, markStep2] = useStepDone(2)
  const [step3Done, markStep3] = useStepDone(3)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{t('setup.title', { defaultValue: 'Setup Wizard' })}</h1>
        <p className="text-sm text-muted-foreground">
          {t('setup.description', { defaultValue: 'Get started in 3 steps: install the extension, configure search, and run your first crawl.' })}
        </p>
      </div>

      {/* Step 1: Install Extension */}
      <Card className={step1Done ? 'border-green-200 bg-green-50/30' : ''}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">1</div>
            <div className="flex-1">
              <CardTitle className="text-base flex items-center gap-2">
                <Puzzle className="h-4 w-4" />
                {t('setup.step1Title', { defaultValue: 'Install Extension' })}
              </CardTitle>
              <CardDescription>{t('setup.step1Description', { defaultValue: 'Install the browser extension to collect resumes from job boards.' })}</CardDescription>
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
              {t('setup.step1InstallHint', { defaultValue: 'Install the browser extension to begin collecting resumes. Download link will appear once the extension is built.' })}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {t('setup.step1Instructions', { defaultValue: 'After downloading, open chrome://extensions, enable Developer mode, and drag the zip file to install.' })}
          </p>
          {!step1Done && (
            <Button variant="outline" size="sm" onClick={markStep1}>
              {t('setup.markDone', { defaultValue: 'Mark as done' })}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Configure Search */}
      <Card className={step2Done ? 'border-green-200 bg-green-50/30' : ''}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">2</div>
            <div className="flex-1">
              <CardTitle className="text-base flex items-center gap-2">
                <Search className="h-4 w-4" />
                {t('setup.step2Title', { defaultValue: 'Configure Search' })}
              </CardTitle>
              <CardDescription>{t('setup.step2Description', { defaultValue: 'Set up keywords and locations to target the right candidates.' })}</CardDescription>
            </div>
            {step2Done && <CheckCircle2 className="h-5 w-5 text-green-600" data-testid="check-icon" />}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t('setup.step2Hint', { defaultValue: 'Add keywords related to the positions you\'re hiring for, and set the target location.' })}
          </p>
          <div className="flex gap-2">
            <Link to={`/${slug}/system/settings/keywords`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {t('setup.goToKeywords', { defaultValue: 'Go to Keywords' })}
            </Link>
            {!step2Done && (
              <Button variant="outline" size="sm" onClick={markStep2}>
                {t('setup.markDone', { defaultValue: 'Mark as done' })}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Step 3: First Crawl */}
      <Card className={step3Done ? 'border-green-200 bg-green-50/30' : ''}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">3</div>
            <div className="flex-1">
              <CardTitle className="text-base flex items-center gap-2">
                <Play className="h-4 w-4" />
                {t('setup.step3Title', { defaultValue: 'First Crawl' })}
              </CardTitle>
              <CardDescription>{t('setup.step3Description', { defaultValue: 'Trigger your first resume collection and verify the results.' })}</CardDescription>
            </div>
            {step3Done && <CheckCircle2 className="h-5 w-5 text-green-600" data-testid="check-icon" />}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t('setup.step3Hint', { defaultValue: 'Go to the Operations page to start a crawl with your configured keywords. Check the resumes page after collection completes.' })}
          </p>
          <div className="flex gap-2">
            <Link to={`/${slug}/system/settings/operations`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {t('setup.goToOperations', { defaultValue: 'Go to Operations' })}
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
