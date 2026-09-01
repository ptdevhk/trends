import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { canUseExplicitRedirect, getDefaultAuthenticatedPath } from '@/lib/workspace-access'

export function LoginPage() {
  const { t } = useTranslation()
  const { login, lastLoginError } = useAuth()
  const { slug } = useWorkspace()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const explicitRedirectTo = searchParams.get('redirectTo')
  const showLocalDevAuthHint = import.meta.env.DEV && slug === 'dev'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    const result = await login(username, password)
    if (result) {
      const redirectTo = explicitRedirectTo && canUseExplicitRedirect(result, explicitRedirectTo)
        ? explicitRedirectTo
        : getDefaultAuthenticatedPath(result, slug)
      navigate(redirectTo, { replace: true })
    } else {
      const locked = lastLoginError?.status === 429
      setError(locked ? t('auth.loginLocked', { defaultValue: 'Account locked' }) : t('auth.loginFailed', { defaultValue: 'Invalid username or password' }))
    }

    setIsSubmitting(false)
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">{t('auth.loginTitle', { defaultValue: 'Sign in' })}</h1>
          <p className="text-sm text-muted-foreground">
            {t('auth.loginSubtitle', { defaultValue: 'Enter your credentials to continue' })}
          </p>
        </div>

        {showLocalDevAuthHint ? (
          <div className="rounded-md border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            {t('auth.localDevBootstrap', {
              defaultValue:
                'Local dev auth: run bun run auth:bootstrap-demo, then sign in as demo-admin with AUTH_BOOTSTRAP_PASSWORD (default .env.example: demo-admin).',
            })}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="username" className="text-sm font-medium">
              {t('auth.username', { defaultValue: 'Username' })}
            </label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              {t('auth.password', { defaultValue: 'Password' })}
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={isSubmitting}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting
              ? t('auth.signingIn', { defaultValue: 'Signing in...' })
              : t('auth.signIn', { defaultValue: 'Sign in' })}
          </Button>
        </form>
      </div>
    </div>
  )
}
