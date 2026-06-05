import { Outlet } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { SystemSidebar } from '@/components/SystemSidebar'
import { Header } from '@/components/Header'
import { ErrorBoundary } from '@/components/ErrorBoundary'

export default function SystemLayout() {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <Toaster position="top-center" richColors />
      <Header
        leftAction={
          <Button variant="ghost" size="icon" className="xl:hidden shrink-0 -ml-2" onClick={() => setOpen((prev) => !prev)}>
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle menu</span>
          </Button>
        }
      />

      <div className="flex flex-1">
        {/* Sidebar Desktop - Reduced width to w-56 (224px) from w-64 */}
        <aside className="hidden xl:flex w-56 flex-col fixed top-14 bottom-0 left-0 z-40 bg-background border-r">
          <SystemSidebar />
        </aside>

        {/* Main Content - Added min-w-0 to fix flexbox overflow bug */}
        <div className="flex-1 flex flex-col xl:pl-56 transition-all min-w-0">
          {/* Mobile Menu Overlay */}
          {open && (
            <div className="fixed inset-0 top-14 z-50 xl:hidden">
              <div
                className="absolute inset-0 bg-background/80 backdrop-blur-sm"
                onClick={() => setOpen(false)}
              />
              <div className="absolute top-0 bottom-0 left-0 w-64 bg-background shadow-lg border-r">
                <SystemSidebar onClose={() => setOpen(false)} />
              </div>
            </div>
          )}

          {/* Main padding and overflow handling */}
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
