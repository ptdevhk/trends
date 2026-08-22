import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Menu } from 'lucide-react'
import { Header } from '@/components/Header'
import { SettingsSidebar } from '@/components/SettingsSidebar'
import { Button } from '@/components/ui/button'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useTranslation } from 'react-i18next'

export default function SettingsLayout() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <Toaster position="top-center" richColors />
      <Header
        leftAction={
          <Button variant="ghost" size="icon" className="xl:hidden shrink-0 -ml-2" onClick={() => setOpen((prev) => !prev)}>
            <Menu className="h-5 w-5" />
            <span className="sr-only">{t('common.toggleMenu', { defaultValue: 'Toggle menu' })}</span>
          </Button>
        }
      />

      <div className="flex flex-1">
        <aside className="hidden xl:flex w-56 flex-col fixed top-14 bottom-0 left-0 z-40 bg-background border-r">
          <SettingsSidebar />
        </aside>

        <div className="flex-1 flex flex-col xl:pl-56 transition-all min-w-0">
          {open && (
            <div className="fixed inset-0 top-14 z-50 xl:hidden">
              <div
                className="absolute inset-0 bg-background/80 backdrop-blur-sm"
                onClick={() => setOpen(false)}
              />
              <div className="absolute top-0 bottom-0 left-0 w-64 bg-background shadow-lg border-r">
                <SettingsSidebar onClose={() => setOpen(false)} />
              </div>
            </div>
          )}

          <main className="flex-1 p-6 space-y-6">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </div>
  )
}
