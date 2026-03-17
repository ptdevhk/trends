import { useMemo } from 'react'
import {
  APP_SURFACE_IDENTITY,
  SYSTEM_NAV_ITEMS,
  type SurfaceNavDefinition,
} from '@trends/shared'
import { Link, useLocation } from 'react-router-dom'
import {
  Home,
  LayoutDashboard,
  Settings,
  FileText,
  Brain,
  Database,
  BarChart3,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useSystemMetadata } from '@/hooks/useSystemMetadata'
import { RESUME_HOME_RESET_STATE } from '@/lib/resume-home-navigation'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

type NavItem = SurfaceNavDefinition & {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  matches: string[]
}

const NAV_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  home: Home,
  settings: Settings,
  jds: FileText,
  profiles: FileText,
  'ai-debugger': Brain,
  'ai-tagging': Brain,
  ingest: Database,
  'search-analytics': BarChart3,
  'data-inspector': LayoutDashboard,
}

interface SystemSidebarProps {
  onClose?: () => void
}

export function SystemSidebar({ onClose }: SystemSidebarProps) {
  const location = useLocation()
  const { slug } = useWorkspace()
  const { t } = useTranslation()
  const identity = useSystemMetadata()
  const appVersion = identity?.appVersion ?? 'unknown'

  const navItems = useMemo<NavItem[]>(() => {
    return SYSTEM_NAV_ITEMS.map((item) => ({
      ...item,
      title: t(item.titleKey, { defaultValue: item.defaultTitle }),
      href: `/${slug}${item.hrefSuffix}`,
      matches: item.matchesSuffixes.map((suffix) => `/${slug}${suffix}`),
      icon: NAV_ICONS[item.id] ?? FileText,
    }))
  }, [slug, t])

  return (
    <div className="flex flex-col h-full bg-muted/30">
      <div className="flex-1 overflow-y-auto py-4">
        <div className="px-5 mb-6 flex items-center justify-between">
          <Link to={`/${slug}/resumes`} state={RESUME_HOME_RESET_STATE} className="flex items-center gap-2">
            <span className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded font-medium">
              {APP_SURFACE_IDENTITY.adminBadgeLabel}
            </span>
            <div className="flex items-baseline gap-1">
              <span className="font-bold text-base truncate">{APP_SURFACE_IDENTITY.appName}</span>
            </div>
          </Link>
          {onClose && (
            <Button variant="ghost" size="icon" className="md:hidden -mr-2" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          )}
        </div>
        <div className="px-3 space-y-1">
          {navItems.map((item) => {
            const isActive = item.matches.some((match) => location.pathname.startsWith(match))
            return (
              <Link
                key={item.href}
                to={item.href}
                state={item.id === 'home' ? RESUME_HOME_RESET_STATE : undefined}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.title}</span>
              </Link>
            )
          })}
        </div>
      </div>
      <div className="px-5 mt-auto pt-4">
        <div className="text-xs text-muted-foreground truncate">
          v{appVersion} {APP_SURFACE_IDENTITY.systemTitle}
        </div>
      </div>
    </div>
  )
}
