import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const JOB_BOARD_BASE_URL = 'https://hr.job5156.com/search'
const EXTENSION_META_URL = '/extension/extension-meta.json'
const EXTENSION_ZIP_URL = '/extension/trends-resume-collector-latest.zip'

type ExtensionMeta = {
  version: string
}

interface CollectResumesButtonProps {
  location: string
  keywords: string[]
  collectLimit?: number
  minAge?: number
  maxAge?: number
}

function isExtensionMeta(value: unknown): value is ExtensionMeta {
  if (typeof value !== 'object' || value === null || !('version' in value)) {
    return false
  }

  return typeof value.version === 'string' && value.version.trim().length > 0
}

function normalizeCollectLimit(value: number | undefined): number {
  const parsed = Number.isFinite(value) ? Math.floor(value || 0) : 0
  return parsed > 0 ? parsed : 0
}

function normalizeAgeBound(value: number | undefined): number | undefined {
  const parsed = Number.isFinite(value) ? Math.floor(value || 0) : 0
  return parsed > 0 ? parsed : undefined
}

export function CollectResumesButton({ location, keywords, collectLimit, minAge, maxAge }: CollectResumesButtonProps) {
  const { t } = useTranslation()
  const [extensionVersion, setExtensionVersion] = useState<string | null>(null)

  const normalizedLocation = location.trim()
  const normalizedKeywords = useMemo(
    () => keywords.map((keyword) => keyword.trim()).filter((keyword) => keyword.length > 0),
    [keywords]
  )
  const normalizedCollectLimit = useMemo(() => normalizeCollectLimit(collectLimit), [collectLimit])
  const normalizedMinAge = useMemo(() => normalizeAgeBound(minAge), [minAge])
  const normalizedMaxAge = useMemo(() => normalizeAgeBound(maxAge), [maxAge])

  const disabled = normalizedKeywords.length === 0

  const collectUrl = useMemo(() => {
    if (disabled) {
      return null
    }

    const query = new URLSearchParams({
      keyword: normalizedKeywords.join(' '),
      tr_auto_sync: 'true',
    })

    if (normalizedLocation.length > 0) {
      query.set('location', normalizedLocation) // will be parsed by extension
    }

    if (normalizedCollectLimit > 0) {
      query.set('tr_limit', String(normalizedCollectLimit))
    }

    if (typeof normalizedMinAge === 'number') {
      query.set('tr_min_age', String(normalizedMinAge))
    }

    if (typeof normalizedMaxAge === 'number') {
      query.set('tr_max_age', String(normalizedMaxAge))
    }

    return `${JOB_BOARD_BASE_URL}?${query.toString()}`
  }, [disabled, normalizedCollectLimit, normalizedKeywords, normalizedLocation, normalizedMinAge, normalizedMaxAge])

  useEffect(() => {
    let cancelled = false

    const loadExtensionMeta = async () => {
      try {
        const response = await fetch(EXTENSION_META_URL)
        if (!response.ok) {
          return
        }

        const payload: unknown = await response.json()
        if (!cancelled && isExtensionMeta(payload)) {
          setExtensionVersion(payload.version)
        }
      } catch (error) {
        console.error('Failed to load extension metadata', error)
      }
    }

    void loadExtensionMeta()
    return () => {
      cancelled = true
    }
  }, [])

  const tooltipText = disabled
    ? t('quickStart.collectDisabledHint', 'Enter keywords first')
    : t('quickStart.collectTooltip', 'Opens job board with auto-sync. Requires extension + login.')

  const handleClick = () => {
    if (!collectUrl) {
      return
    }

    window.open(collectUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={disabled}
                onClick={handleClick}
              >
                <ExternalLink className="h-4 w-4" />
                {t('quickStart.collectResumes', 'Collect')}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {tooltipText}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {extensionVersion ? (
        <a
          href={EXTENSION_ZIP_URL}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          <Download className="h-3 w-3" />
          {t('quickStart.downloadExtension', { version: extensionVersion })}
        </a>
      ) : null}
    </div>
  )
}
