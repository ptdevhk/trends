import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CurrentAuth } from '@/lib/auth'

function getDefaultRedirect(auth: CurrentAuth, fallbackWorkspaceSlug: string): string {
  const adminMembership = auth.memberships.find(
    (membership) => membership.workspaceSlug === 'admin' && membership.role === 'admin',
  )
  if (adminMembership) {
    return '/admin/system/settings/auth'
  }

  const firstMembership = auth.memberships[0]
  if (firstMembership) {
    return `/${firstMembership.workspaceSlug}/resumes`
  }

  return `/${fallbackWorkspaceSlug}/resumes`
}

export function LoginPage() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const { slug } = useWorkspace()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const explicitRedirectTo = searchParams.get('redirectTo')

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
      navigate(explicitRedirectTo || getDefaultRedirect(result, slug), { replace: true })
    } else {
      setError(t('auth.loginFailed', { defaultValue: 'Invalid username or password' }))
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
