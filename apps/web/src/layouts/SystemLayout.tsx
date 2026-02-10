
import { Link, Outlet, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  Home,
  LayoutDashboard,
  Settings,
  FileText,
  Bot,
  Menu,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'

interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  matches: string[]
}

export default function SystemLayout() {
  const { t } = useTranslation()
  const location = useLocation()
  const [open, setOpen] = useState(false)

  const navItems: NavItem[] = [
    {
      title: t('nav.home', { defaultValue: 'Home' }),
      href: '/resumes',
      icon: Home,
      matches: ['/resumes']
    },
    {
      title: t('debug.navConfig', { defaultValue: 'System Settings' }),
      href: '/system/settings',
      icon: Settings,
      matches: ['/system/settings']
    },
    {
      title: t('jdManagement.title', { defaultValue: 'Job Descriptions' }),
      href: '/system/jds',
      icon: FileText,
      matches: ['/system/jds']
    },
    {
      title: t('debugAi.title', { defaultValue: 'AI Debugger' }),
      href: '/system/ai-debugger',
      icon: Bot,
      matches: ['/system/ai-debugger']
    },
    {
      title: t('debug.title', { defaultValue: 'Data Inspector' }),
      href: '/system/data',
      icon: LayoutDashboard,
      matches: ['/system/data']
    }
  ]

  const NavContent = () => (
    <div className="flex flex-col h-full py-4 bg-background border-r">
      <div className="px-6 mb-6 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded">ADMIN</span>
          <div className="flex items-baseline gap-1">
            <span className="font-bold text-lg">{t('app.title')}</span>
            <span className="text-sm text-muted-foreground">{t('app.subtitle')}</span>
          </div>
        </Link>
        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(false)}>
          <X className="h-5 w-5" />
        </Button>
      </div>
      <div className="flex-1 px-4 space-y-1">
        {navItems.map((item) => {
          const isActive = item.matches.some(match => location.pathname.startsWith(match))
          return (
            <Link
              key={item.href}
              to={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.title}
            </Link>
          )
        })}
      </div>
      <div className="px-6 mt-auto space-y-4">
        <div className="flex items-center justify-between">
          <LanguageSwitcher />
        </div>
        <div className="text-xs text-muted-foreground">
          v0.9.0 System Admin
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex w-64 flex-col fixed inset-y-0 left-0 z-50">
        <NavContent />
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen md:pl-64 transition-all">
        <header className="md:hidden flex h-14 items-center gap-4 border-b bg-background px-6 sticky top-0 z-40">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle menu</span>
          </Button>
          <div className="font-semibold">System Administration</div>
        </header>

        {/* Mobile Menu Overlay */}
        {open && (
          <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm md:hidden">
            <div className="fixed inset-y-0 left-0 w-64 bg-background shadow-lg border-r">
              <NavContent />
            </div>
            <div className="flex-1" onClick={() => setOpen(false)} />
          </div>
        )}

        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
