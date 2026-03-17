import { useMemo } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import { SYSTEM_SETTINGS_SUBPAGES } from '@/pages/system-settings/lib'

export default function SystemSettingsLayout() {
  const { t } = useTranslation()

  const navItems = useMemo(() => {
    return SYSTEM_SETTINGS_SUBPAGES.map((item) => ({
      ...item,
      title: t(item.titleKey, { defaultValue: item.defaultTitle }),
    }))
  }, [t])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('debugConfig.title')}
        description={t('debugConfig.subtitle')}
      />

      <div className="-mx-1 overflow-x-auto pb-1">
        <div className="flex min-w-max items-center gap-2 px-1">
          {navItems.map((item) => (
            <NavLink
              key={item.id}
              to={item.href}
              end={item.id === 'overview'}
              className={({ isActive }) =>
                cn(
                  'rounded-full border px-3 py-1 text-sm transition-colors',
                  isActive ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              {item.title}
            </NavLink>
          ))}
        </div>
      </div>

      <Outlet />
    </div>
  )
}
