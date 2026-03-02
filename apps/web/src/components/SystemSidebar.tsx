import { Link, useLocation } from 'react-router-dom'
import {
    Home,
    LayoutDashboard,
    Settings,
    FileText,
    Brain,
    Database,
    BarChart3,
    X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { cn } from '@/lib/utils'

interface NavItem {
    title: string
    href: string
    icon: React.ComponentType<{ className?: string }>
    matches: string[]
}

interface SystemSidebarProps {
    onClose?: () => void
}

export function SystemSidebar({ onClose }: SystemSidebarProps) {
    const location = useLocation()
    const { slug } = useWorkspace()

    const navItems: NavItem[] = [
        {
            title: 'Home',
            href: `/${slug}/resumes`,
            icon: Home,
            matches: [`/${slug}/resumes`]
        },
        {
            title: 'System Settings',
            href: `/${slug}/system/settings`,
            icon: Settings,
            matches: [`/${slug}/system/settings`]
        },
        {
            title: 'Job Descriptions',
            href: `/${slug}/system/jds`,
            icon: FileText,
            matches: [`/${slug}/system/jds`]
        },
        {
            title: 'Search Profiles',
            href: `/${slug}/system/profiles`,
            icon: FileText,
            matches: [`/${slug}/system/profiles`]
        },
        {
            title: 'AI Debugger',
            href: `/${slug}/system/ai-debugger`,
            icon: Brain,
            matches: [`/${slug}/system/ai-debugger`]
        },
        {
            title: 'Ingest Debug',
            href: `/${slug}/system/ingest`,
            icon: Database,
            matches: [`/${slug}/system/ingest`]
        },
        {
            title: 'Search Analytics',
            href: `/${slug}/system/search-analytics`,
            icon: BarChart3,
            matches: [`/${slug}/system/search-analytics`]
        },
        {
            title: 'Data Inspector',
            href: `/${slug}/system/data`,
            icon: LayoutDashboard,
            matches: [`/${slug}/system/data`]
        }
    ]

    return (
        <div className="flex flex-col h-full bg-muted/30">
            {/* Navigation */}
            <div className="flex-1 overflow-y-auto py-4">
                <div className="px-5 mb-6 flex items-center justify-between">
                    <Link to={`/${slug}/resumes`} className="flex items-center gap-2">
                        <span className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded font-medium">ADMIN</span>
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
                        const isActive = item.matches.some(match => location.pathname.startsWith(match))
                        return (
                            <Link
                                key={item.href}
                                to={item.href}
                                onClick={onClose}
                                className={cn(
                                    "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                                    isActive
                                        ? "bg-primary/10 text-primary"
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
                    v0.9.0 System Admin
                </div>
            </div>
        </div>
    )
}
