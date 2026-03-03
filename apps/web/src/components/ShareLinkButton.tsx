import { useCallback } from 'react'
import { Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export function ShareLinkButton() {
  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(window.location.href)
      } else {
        throw new Error('Clipboard API unavailable')
      }
      toast.success('已复制分享链接')
    } catch (error) {
      console.error('Failed to copy share URL', error)
      toast.error('复制链接失败，请手动复制地址栏 URL')
    }
  }, [])

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-8 gap-1.5 px-2"
      onClick={() => {
        void handleCopy()
      }}
    >
      <Link2 className="h-3.5 w-3.5" />
      分享
    </Button>
  )
}
