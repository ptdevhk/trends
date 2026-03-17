import { useTranslation } from 'react-i18next'
import { NavLink, Link } from 'react-router-dom'
import { TrendingUp } from 'lucide-react'
import { LanguageSwitcher } from './LanguageSwitcher'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { RESUME_HOME_RESET_STATE } from '@/lib/resume-home-navigation'
import { cn } from '@/lib/utils'

interface HeaderProps {
  leftAction?: React.ReactNode
}

export function Header({ leftAction }: HeaderProps = {}) {
  const { t } = useTranslation()
  const { slug, name, isAdmin } = useWorkspace()
  const resumesPath = `/${slug}/resumes`
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
              className={({ isActive }) =>
                cn(
                  'transition-colors hover:text-foreground',
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                )
              }
            >
              {t('nav.resumes')}
            </NavLink>
            <NavLink
              to={settingsPath}
              className={({ isActive }) =>
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
                className={({ isActive }) =>
                  cn(
                    'transition-colors hover:text-foreground',
                    isActive ? 'text-foreground' : 'text-muted-foreground'
                  )
                }
              >
                System
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
              className={({ isActive }) =>
                cn(
                  'transition-colors hover:text-foreground',
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                )
              }
            >
              {t('nav.resumes')}
            </NavLink>
            <NavLink
              to={settingsPath}
              className={({ isActive }) =>
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
                className={({ isActive }) =>
                  cn(
                    'transition-colors hover:text-foreground',
                    isActive ? 'text-foreground' : 'text-muted-foreground'
                  )
                }
              >
                System
              </NavLink>
            ) : null}
          </nav>
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  )
}
