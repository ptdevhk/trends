import { useTranslation } from 'react-i18next'
import { NavLink, Link } from 'react-router-dom'
import { TrendingUp } from 'lucide-react'
import { LanguageSwitcher } from './LanguageSwitcher'
import { cn } from '@/lib/utils'

export function Header() {
  const { t } = useTranslation()

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link to="/resumes" className="flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            <div className="flex items-baseline gap-1">
              <span className="font-bold text-lg">{t('app.title')}</span>
              <span className="text-sm text-muted-foreground">{t('app.subtitle')}</span>
            </div>
          </Link>
          <nav className="hidden items-center gap-4 text-sm sm:flex">
            <NavLink
              to="/resumes"
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
              to="/debug"
              className={({ isActive }) =>
                cn(
                  'transition-colors hover:text-foreground',
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                )
              }
            >
              {t('nav.debug')}
            </NavLink>
            <NavLink
              to="/config/jds"
              className={({ isActive }) =>
                cn(
                  'transition-colors hover:text-foreground',
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                )
              }
            >
              {t('nav.jds')}
            </NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-3 text-sm sm:hidden">
            <NavLink
              to="/resumes"
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
              to="/debug"
              className={({ isActive }) =>
                cn(
                  'transition-colors hover:text-foreground',
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                )
              }
            >
              {t('nav.debug')}
            </NavLink>
            <NavLink
              to="/config/jds"
              className={({ isActive }) =>
                cn(
                  'transition-colors hover:text-foreground',
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                )
              }
            >
              {t('nav.jds')}
            </NavLink>
          </nav>
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  )
}
