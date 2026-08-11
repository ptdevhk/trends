import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  JOB51_SAFE_LAUNCH_LIMIT,
  JOB51_SAFE_LAUNCH_MAX_PAGES,
  buildCollectionLaunchUrl,
  normalizeCollectionSource,
  resolveCollectionSource,
  SEARCH_PROFILE_SOURCE_TYPES,
  type CollectionSource,
} from '@/lib/search-profile-sources'
import { reportUiError } from '@/lib/ui-error-reporting'
import { fetchExtensionMetaJson } from '@/lib/external-fetch'
const EXTENSION_ZIP_URL = '/extension/trends-resume-collector-latest.zip'

type ExtensionMeta = {
  version: string
}

interface CollectResumesButtonProps {
  location: string
  keywords: string[]
  collectionSource?: CollectionSource
  onCollectionSourceChange?: (source: CollectionSource) => void
  collectLimit?: number
  minAge?: number
  maxAge?: number
  initialCollectLimit?: number
  initialMaxPages?: number
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

export function CollectResumesButton({
  location,
  keywords,
  collectionSource,
  onCollectionSourceChange,
  collectLimit,
  minAge,
  maxAge,
  initialCollectLimit,
  initialMaxPages,
}: CollectResumesButtonProps) {
  const { t } = useTranslation()
  const [extensionVersion, setExtensionVersion] = useState<string | null>(null)
  const [collectLimitInput, setCollectLimitInput] = useState(() =>
    typeof initialCollectLimit === 'number' && initialCollectLimit > 0 ? String(initialCollectLimit) : '',
  )
  const [maxPagesInput, setMaxPagesInput] = useState(() =>
    typeof initialMaxPages === 'number' && initialMaxPages > 0 ? String(initialMaxPages) : '',
  )

  const normalizedLocation = useMemo(() => location.trim(), [location])
  const normalizedKeywords = useMemo(
    () => keywords.map((keyword) => keyword.trim()).filter((keyword) => keyword.length > 0),
    [keywords]
  )
  const propCollectLimit = useMemo(() => normalizeCollectLimit(collectLimit), [collectLimit])
  const inputCollectLimit = useMemo(
    () => normalizeCollectLimit(collectLimitInput.trim().length > 0 ? Number(collectLimitInput) : undefined),
    [collectLimitInput]
  )
  const normalizedCollectLimit = inputCollectLimit > 0 ? inputCollectLimit : propCollectLimit
  const inputCollectMaxPages = useMemo(
    () => normalizeCollectLimit(maxPagesInput.trim().length > 0 ? Number(maxPagesInput) : undefined),
    [maxPagesInput]
  )
  const normalizedCollectMaxPages = inputCollectMaxPages
  const normalizedMinAge = useMemo(() => normalizeAgeBound(minAge), [minAge])
  const normalizedMaxAge = useMemo(() => normalizeAgeBound(maxAge), [maxAge])
  const normalizedCollectionSource = useMemo(
    () => normalizeCollectionSource(collectionSource),
    [collectionSource]
  )
  const normalizedSelection = useMemo(
    () => resolveCollectionSource(normalizedCollectionSource) ?? { type: SEARCH_PROFILE_SOURCE_TYPES.job5156 },
    [normalizedCollectionSource]
  )
  const selectedSourceType = normalizedSelection.type
  const isJob51Selected = selectedSourceType === SEARCH_PROFILE_SOURCE_TYPES.job51
  const seekExactUrlRef = useRef<string | undefined>(undefined)
  const seekSource = useMemo(() => {
    const currentSeekExactUrl = normalizedCollectionSource?.type === SEARCH_PROFILE_SOURCE_TYPES.seek
      ? normalizedCollectionSource.exactUrl
      : undefined
    if (currentSeekExactUrl) {
      seekExactUrlRef.current = currentSeekExactUrl
    }
    return resolveCollectionSource(
      {
        type: SEARCH_PROFILE_SOURCE_TYPES.seek,
        exactUrl: currentSeekExactUrl ?? seekExactUrlRef.current,
      },
    )
  }, [normalizedCollectionSource])

  const disabled = selectedSourceType === SEARCH_PROFILE_SOURCE_TYPES.seek
    ? !seekSource?.exactUrl && normalizedKeywords.length === 0
    : normalizedKeywords.length === 0

  const job51SourceLevelLimit = isJob51Selected && inputCollectLimit > 0 ? inputCollectLimit : undefined
  const job51SourceLevelMaxPages = isJob51Selected && inputCollectMaxPages > 0 ? inputCollectMaxPages : undefined

  const launchUrl = useMemo(() => {
    if (disabled) {
      return null
    }

    return buildCollectionLaunchUrl({
      source: selectedSourceType === SEARCH_PROFILE_SOURCE_TYPES.seek
        ? {
            type: SEARCH_PROFILE_SOURCE_TYPES.seek,
            exactUrl: seekSource?.exactUrl,
            ...(collectionSource?.type === 'seek' && typeof collectionSource.collectLimit === 'number'
              ? { collectLimit: collectionSource.collectLimit }
              : {}),
            ...(collectionSource?.type === 'seek' && typeof collectionSource.maxPages === 'number'
              ? { maxPages: collectionSource.maxPages }
              : {}),
          }
        : {
            type: selectedSourceType,
            ...(isJob51Selected ? {
              job51CollectLimit: job51SourceLevelLimit,
              job51MaxPages: job51SourceLevelMaxPages,
            } : {}),
            ...(selectedSourceType === SEARCH_PROFILE_SOURCE_TYPES.job5156 && collectionSource?.type === 'job5156'
              ? {
                  ...(typeof collectionSource.collectLimit === 'number' ? { collectLimit: collectionSource.collectLimit } : {}),
                  ...(typeof collectionSource.maxPages === 'number' ? { maxPages: collectionSource.maxPages } : {}),
                }
              : {}),
          },
      location: normalizedLocation,
      keywords: normalizedKeywords,
      collectLimit: normalizedCollectLimit,
      maxPages: normalizedCollectMaxPages,
      minAge: normalizedMinAge,
      maxAge: normalizedMaxAge,
    })
  }, [
    collectionSource?.collectLimit,
    collectionSource?.maxPages,
    collectionSource?.type,
    disabled,
    isJob51Selected,
    job51SourceLevelLimit,
    job51SourceLevelMaxPages,
    normalizedCollectLimit,
    normalizedCollectMaxPages,
    normalizedKeywords,
    normalizedLocation,
    normalizedMinAge,
    normalizedMaxAge,
    seekSource?.exactUrl,
    selectedSourceType,
  ])

  useEffect(() => {
    let cancelled = false

    const loadExtensionMeta = async () => {
      try {
        const payload: unknown = await fetchExtensionMetaJson()
        if (!cancelled && isExtensionMeta(payload)) {
          setExtensionVersion(payload.version)
        }
      } catch (error) {
        reportUiError('Failed to load extension metadata', error)
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
  const sourceLabel = t('quickStart.collectSourceLabel', 'Source')
  const sourceOptions = useMemo(() => ([
    {
      value: SEARCH_PROFILE_SOURCE_TYPES.job5156,
      label: t('quickStart.collectSourceJob5156', 'China · Job5156'),
    },
    {
      value: SEARCH_PROFILE_SOURCE_TYPES.job51,
      label: t('quickStart.collectSourceJob51', 'China · 51job eHire'),
    },
    {
      value: SEARCH_PROFILE_SOURCE_TYPES.seek,
      label: t('quickStart.collectSourceSeek', 'Malaysia · SEEK'),
    },
  ]), [t])
  const maxPagesLabel = t('quickStart.collectMaxPagesLabel', 'Collect page limit')
  const maxPagesPlaceholder = t('quickStart.collectMaxPagesPlaceholder', 'Pages')
  const collectLimitPlaceholder = t('quickStart.collectLimitPlaceholder', 'Limit')
  const effectiveLimit = isJob51Selected && inputCollectLimit > 0 ? inputCollectLimit : JOB51_SAFE_LAUNCH_LIMIT
  const effectiveMaxPages = isJob51Selected && inputCollectMaxPages > 0 ? inputCollectMaxPages : JOB51_SAFE_LAUNCH_MAX_PAGES
  const job51Hint = t(
    'quickStart.collectJob51Hint',
    `Collecting up to ${effectiveLimit} resumes across ${effectiveMaxPages} page(s).`,
  )

  const handleClick = () => {
    if (!launchUrl) {
      return
    }

    window.open(launchUrl, `trends-collect-${selectedSourceType}`, 'noopener,noreferrer')
  }

  const handleMaxPagesChange = (event: ChangeEvent<HTMLInputElement>) => {
    setMaxPagesInput(event.target.value)
  }

  const handleCollectLimitChange = (event: ChangeEvent<HTMLInputElement>) => {
    setCollectLimitInput(event.target.value)
  }

  const handleSourceChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const rawValue = event.target.value
    const nextType = rawValue === SEARCH_PROFILE_SOURCE_TYPES.seek
      ? SEARCH_PROFILE_SOURCE_TYPES.seek
      : rawValue === SEARCH_PROFILE_SOURCE_TYPES.job51
        ? SEARCH_PROFILE_SOURCE_TYPES.job51
        : SEARCH_PROFILE_SOURCE_TYPES.job5156

    if (nextType === SEARCH_PROFILE_SOURCE_TYPES.seek) {
      onCollectionSourceChange?.({
        type: SEARCH_PROFILE_SOURCE_TYPES.seek,
        ...(seekSource?.exactUrl ? { exactUrl: seekSource.exactUrl } : {}),
      })
      return
    }

    onCollectionSourceChange?.({
      type: nextType,
    })
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <label htmlFor="collect-source" className="sr-only">
          {sourceLabel}
        </label>
        <Select
          id="collect-source"
          name="collect-source"
          value={selectedSourceType}
          onChange={handleSourceChange}
          options={sourceOptions}
          aria-label={sourceLabel}
          className="h-9 w-40"
        />
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
        <label htmlFor="collect-limit" className="sr-only">
          {collectLimitPlaceholder}
        </label>
        <Input
          id="collect-limit"
          name="collect-limit"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={collectLimitInput}
          onChange={handleCollectLimitChange}
          placeholder={collectLimitPlaceholder}
          aria-label={collectLimitPlaceholder}
          className="h-9 w-24"
        />
        <label htmlFor="collect-max-pages" className="sr-only">
          {maxPagesLabel}
        </label>
        <Input
          id="collect-max-pages"
          name="collect-max-pages"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={maxPagesInput}
          onChange={handleMaxPagesChange}
          placeholder={maxPagesPlaceholder}
          aria-label={maxPagesLabel}
          className="h-9 w-24"
        />
      </div>
      {isJob51Selected ? (
        <p className="text-xs text-muted-foreground">
          {job51Hint}
        </p>
      ) : null}
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
