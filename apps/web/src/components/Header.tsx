import { useTranslation } from 'react-i18next'
import { NavLink, Link } from 'react-router-dom'
import { LogOut, TrendingUp } from 'lucide-react'
import { LanguageSwitcher } from './LanguageSwitcher'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { RESUME_HOME_RESET_STATE } from '@/lib/resume-home-navigation'
import { isReviewPacketsEnabled } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface HeaderProps {
  leftAction?: React.ReactNode
}

export function Header({ leftAction }: HeaderProps = {}) {
  const { t } = useTranslation()
  const { slug, name, isAdmin } = useWorkspace()
  const resumesPath = `/${slug}/resumes`
  const reviewPacketsPath = `/${slug}/review-packets`
  const showReviewPackets = isReviewPacketsEnabled()
  const settingsPath = `/${slug}/settings`
  const systemPath = `/${slug}/system`

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between gap-4">
        <div className="flex items-center gap-3 sm:gap-6">
          {leftAction}
          <Link to={resumesPath} state={RESUME_HOME_RESET_STATE} className="flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            <div className="flex items-baseline gap-1">
              <span className="font-bold text-lg">{t('app.title')}</span>
              <span className="text-sm text-muted-foreground">{t('app.subtitle')}</span>
            </div>
          </Link>
          <nav className="hidden items-center gap-4 text-sm sm:flex">
            <NavLink
              to={resumesPath}
              state={RESUME_HOME_RESET_STATE}
              className={({ isActive }: { isActive: boolean }) =>
                cn(
                  'transition-colors hover:text-foreground',
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                )
              }
            >
              {t('nav.resumes')}
            </NavLink>
            {showReviewPackets ? (
              <NavLink
                to={reviewPacketsPath}
                className={({ isActive }: { isActive: boolean }) =>
                  cn(
                    'transition-colors hover:text-foreground',
                    isActive ? 'text-foreground' : 'text-muted-foreground'
                  )
                }
              >
                {t('nav.reviewPackets', { defaultValue: 'Review packets' })}
              </NavLink>
            ) : null}
            <NavLink
              to={settingsPath}
              className={({ isActive }: { isActive: boolean }) =>
                cn(
                  'transition-colors hover:text-foreground',
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                )
              }
            >
              {t('nav.settings')}
            </NavLink>
            {isAdmin ? (
              <NavLink
                to={systemPath}
                className={({ isActive }: { isActive: boolean }) =>
                  cn(
                    'transition-colors hover:text-foreground',
                    isActive ? 'text-foreground' : 'text-muted-foreground'
                  )
                }
              >
                {t('nav.system', { defaultValue: 'System' })}
              </NavLink>
            ) : null}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden md:inline-flex items-center rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
            {name}
          </span>
          <WorkspaceSwitcher />
          <nav className="flex items-center gap-3 text-sm sm:hidden">
            <NavLink
              to={resumesPath}
              state={RESUME_HOME_RESET_STATE}
              className={({ isActive }: { isActive: boolean }) =>
                cn(
                  'transition-colors hover:text-foreground',
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                )
              }
            >
              {t('nav.resumes')}
            </NavLink>
            {showReviewPackets ? (
              <NavLink
                to={reviewPacketsPath}
                className={({ isActive }: { isActive: boolean }) =>
                  cn(
                    'transition-colors hover:text-foreground',
                    isActive ? 'text-foreground' : 'text-muted-foreground'
                  )
                }
              >
                {t('nav.reviewPackets', { defaultValue: 'Review packets' })}
              </NavLink>
            ) : null}
            <NavLink
              to={settingsPath}
              className={({ isActive }: { isActive: boolean }) =>
                cn(
                  'transition-colors hover:text-foreground',
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                )
              }
            >
              {t('nav.settings')}
            </NavLink>
            {isAdmin ? (
              <NavLink
                to={systemPath}
                className={({ isActive }: { isActive: boolean }) =>
                  cn(
                    'transition-colors hover:text-foreground',
                    isActive ? 'text-foreground' : 'text-muted-foreground'
                  )
                }
              >
                {t('nav.system', { defaultValue: 'System' })}
              </NavLink>
            ) : null}
          </nav>
          <LanguageSwitcher />
          <AuthChip />
        </div>
      </div>
    </header>
  )
}

function AuthChip() {
  const { t } = useTranslation()
  const { user, isAuthenticated, logout } = useAuth()
  const { slug } = useWorkspace()

  if (!isAuthenticated || !user) {
    return (
      <NavLink
        to={`/${slug}/login`}
        className={({ isActive }: { isActive: boolean }) =>
          cn(
            'transition-colors hover:text-foreground text-sm',
            isActive ? 'text-foreground' : 'text-muted-foreground'
          )
        }
      >
        {t('auth.signIn', { defaultValue: 'Sign in' })}
      </NavLink>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden md:inline-flex items-center rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
        {user.displayName ?? user.email ?? user.id}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void logout()}
        aria-label={t('auth.logout', { defaultValue: 'Sign out' })}
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  )
}
