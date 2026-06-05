import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { EnsureApiSessionOptions, ResumeSearchShareState } from '@/hooks/useSession'
import { reportUiError } from '@/lib/ui-error-reporting'

type ShareLinkButtonProps = {
  shareTitle: string
  state: ResumeSearchShareState
  ensureApiSession: (options?: EnsureApiSessionOptions) => Promise<string | undefined>
  onCopyState?: (payload: {
    shareUrl: string
    sessionId?: string
    usedSessionLink: boolean
  }) => void
}

type ShareLinkPayload = {
  shareUrl: string
  sessionId?: string
  usedSessionLink: boolean
}

function countActiveFilters(filters: ResumeSearchShareState['filters']): number {
  if (!filters) {
    return 0
  }

  return Object.values(filters).reduce<number>((count, value) => {
    if (Array.isArray(value)) {
      return count + (value.length > 0 ? 1 : 0)
    }
    if (typeof value === 'boolean') {
      return count + (value ? 1 : 0)
    }
    return count + (value !== undefined ? 1 : 0)
  }, 0)
}

function shouldPersistShareLink(currentUrl: URL, state: ResumeSearchShareState): boolean {
  if (currentUrl.searchParams.has('sid')) {
    return false
  }

  if (state.referenceNote) {
    return true
  }

  if (state.collectionSource) {
    return true
  }

  const selectionComplexity =
    (state.keywords?.length ?? 0)
    + (state.requiredKeywords?.length ?? 0)
    + (state.selectedTags?.length ?? 0)
    + (state.selectedCompanies?.length ?? 0)
    + countActiveFilters(state.filters)
    + (state.selectedExperienceLevel ? 1 : 0)
    + (state.jobDescriptionId ? 1 : 0)

  return currentUrl.toString().length > 700 || selectionComplexity >= 9
}

function buildSessionShareUrl(sessionId: string): string {
  const shareUrl = new URL(window.location.href)
  shareUrl.search = ''
  shareUrl.hash = ''
  shareUrl.searchParams.set('sid', sessionId)
  return shareUrl.toString()
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (error) {
      reportUiError('Clipboard API copy failed, falling back to execCommand', error)
    }
  }

  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', 'true')
  textArea.style.position = 'fixed'
  textArea.style.top = '0'
  textArea.style.left = '-9999px'
  document.body.appendChild(textArea)
  textArea.select()

  const execCommand = document.execCommand?.bind(document)
  const copied = execCommand ? execCommand('copy') : false
  textArea.remove()

  if (!copied) {
    throw new Error('Clipboard copy unavailable')
  }
}

export function ShareLinkButton({ shareTitle, state, ensureApiSession, onCopyState }: ShareLinkButtonProps) {
  const { t } = useTranslation()
  const [fallbackPayload, setFallbackPayload] = useState<ShareLinkPayload | null>(null)
  const fallbackTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const selectFallbackText = useCallback(() => {
    fallbackTextareaRef.current?.focus()
    fallbackTextareaRef.current?.select()
  }, [])

  useEffect(() => {
    if (!fallbackPayload) {
      return
    }

    const timer = window.setTimeout(() => {
      selectFallbackText()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [fallbackPayload, selectFallbackText])

  const handleCopy = useCallback(async () => {
    let payload: ShareLinkPayload | null = null

    try {
      const currentUrl = new URL(window.location.href)
      let shareUrl = currentUrl.toString()
      let copiedSessionId = currentUrl.searchParams.get('sid')?.trim() || undefined
      let usedSessionLink = Boolean(copiedSessionId)

      if (shouldPersistShareLink(currentUrl, state)) {
        const sessionId = await ensureApiSession({
          shareTitle,
          searchState: state,
        })
        if (sessionId) {
          shareUrl = buildSessionShareUrl(sessionId)
          copiedSessionId = sessionId
          usedSessionLink = true
        }
      }

      payload = {
        shareUrl,
        sessionId: copiedSessionId,
        usedSessionLink,
      }

      await copyText(shareUrl)
      onCopyState?.(payload)
      setFallbackPayload(null)
      toast.success(usedSessionLink
        ? t('shareLink.copiedSession', { defaultValue: 'Session link copied' })
        : t('shareLink.copiedSearch', { defaultValue: 'Share link copied' }))
    } catch (error) {
      reportUiError('Failed to copy share URL', error)
      if (payload) {
        setFallbackPayload(payload)
        toast.error(t('shareLink.copyPreparedFailed', {
          defaultValue: 'Automatic copy failed. Copy the link below manually.',
        }))
        return
      }

      toast.error(t('shareLink.copyUrlFailed', {
        defaultValue: 'Failed to copy link. Copy the URL from the address bar manually.',
      }))
    }
  }, [ensureApiSession, onCopyState, shareTitle, state, t])

  const handleFallbackCopy = useCallback(async () => {
    if (!fallbackPayload) {
      return
    }

    try {
      await copyText(fallbackPayload.shareUrl)
      onCopyState?.(fallbackPayload)
      setFallbackPayload(null)
      toast.success(fallbackPayload.usedSessionLink
        ? t('shareLink.copiedSession', { defaultValue: 'Session link copied' })
        : t('shareLink.copiedSearch', { defaultValue: 'Share link copied' }))
    } catch (error) {
      reportUiError('Retry share copy failed', error)
      selectFallbackText()
      toast.error(t('shareLink.retryCopyFailed', {
        defaultValue: 'Copy still failed. Copy the link below manually.',
      }))
    }
  }, [fallbackPayload, onCopyState, selectFallbackText, t])

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-10 gap-1.5 px-3"
        onClick={() => {
          void handleCopy()
        }}
      >
        <Link2 className="h-3.5 w-3.5" />
        {t('shareLink.button', { defaultValue: 'Share' })}
      </Button>

      <Dialog open={fallbackPayload !== null} onOpenChange={(open: boolean) => {
        if (!open) {
          setFallbackPayload(null)
        }
      }}
      >
        <DialogContent data-testid="share-link-fallback-dialog" className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('shareLink.dialog.title', { defaultValue: 'Copy share link manually' })}</DialogTitle>
            <DialogDescription>
              {t('shareLink.dialog.description', {
                defaultValue: 'Automatic copy did not complete. The link is ready to copy manually.',
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {t('shareLink.dialog.titleLabel', { defaultValue: 'Share title' })}
              </div>
              <div className="mt-1 text-sm font-medium text-foreground">
                {shareTitle}
              </div>
            </div>
            <Textarea
              ref={fallbackTextareaRef}
              aria-label={t('shareLink.dialog.urlLabel', { defaultValue: 'Share link' })}
              readOnly
              value={fallbackPayload?.shareUrl ?? ''}
              rows={3}
              className="font-mono text-xs"
              onFocus={selectFallbackText}
              onClick={selectFallbackText}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFallbackPayload(null)
              }}
            >
              {t('common.close', { defaultValue: 'Close' })}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleFallbackCopy()
              }}
            >
              {t('shareLink.dialog.retryCopy', { defaultValue: 'Try copying again' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
