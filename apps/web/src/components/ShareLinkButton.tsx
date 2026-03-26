import { useCallback } from 'react'
import { Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { EnsureApiSessionOptions, ResumeSearchShareState } from '@/hooks/useSession'

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

  if (state.collectionSource || state.collectUrl) {
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
      console.error('Clipboard API copy failed, falling back to execCommand', error)
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
  const handleCopy = useCallback(async () => {
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

      await copyText(shareUrl)
      onCopyState?.({
        shareUrl,
        sessionId: copiedSessionId,
        usedSessionLink,
      })
      toast.success(usedSessionLink ? '已复制会话链接' : '已复制分享链接')
    } catch (error) {
      console.error('Failed to copy share URL', error)
      toast.error('复制链接失败，请手动复制地址栏 URL')
    }
  }, [ensureApiSession, onCopyState, shareTitle, state])

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-10 gap-1.5 px-3"
      onClick={() => {
        void handleCopy()
      }}
    >
      <Link2 className="h-3.5 w-3.5" />
      分享
    </Button>
  )
}
