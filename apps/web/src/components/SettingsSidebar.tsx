import { Link, useLocation } from 'react-router-dom'
import { Ban, Home, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { cn } from '@/lib/utils'

interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  matches: string[]
}

interface SettingsSidebarProps {
  onClose?: () => void
}

export function SettingsSidebar({ onClose }: SettingsSidebarProps) {
  const location = useLocation()
  const { slug } = useWorkspace()
  const { t } = useTranslation()

  const navItems: NavItem[] = [
    {
      title: t('nav.home', { defaultValue: 'Home' }),
      href: `/${slug}/resumes`,
      icon: Home,
      matches: [`/${slug}/resumes`],
    },
    {
      title: t('settings.blocks.nav', { defaultValue: 'Blacklist' }),
      href: `/${slug}/settings/blocks`,
      icon: Ban,
      matches: [`/${slug}/settings/blocks`],
    },
  ]

  return (
    <div className="flex flex-col h-full bg-muted/30">
      <div className="flex-1 overflow-y-auto py-4">
        <div className="px-5 mb-6 flex items-center justify-between">
          <Link to={`/${slug}/resumes`} className="flex items-center gap-2">
            <span className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded font-medium">SETTINGS</span>
            <div className="flex items-baseline gap-1">
              <span className="font-bold text-base truncate">App Title</span>
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
          v0.9.0 Workspace Settings
        </div>
      </div>
    </div>
  )
}
