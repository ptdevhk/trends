import { AlertTriangle } from 'lucide-react'

type InlineErrorFallbackProps = {
  message: string
  retryLabel?: string
  onRetry?: () => void
}

export function InlineErrorFallback({ message, retryLabel, onRetry }: InlineErrorFallbackProps) {
  return (
    <div className="rounded-2xl border bg-white/80 p-6 text-center shadow-sm space-y-3">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-5 w-5 text-destructive" />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry && retryLabel ? (
        <button
          onClick={onRetry}
          className="text-sm text-primary underline"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  )
}
