import { type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Header } from '@/components/Header'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ResumesPage } from '@/pages/ResumesPage'
import { DebugPage } from '@/pages/DebugPage'
import DebugJDs from '@/pages/DebugJDs'
import DebugAI from '@/pages/DebugAI'
import DebugConfig from '@/pages/DebugConfig'
import DebugIngest from '@/pages/DebugIngest'
import { SearchProfilesPage } from '@/pages/SearchProfilesPage'
import SearchAnalyticsPage from '@/pages/SearchAnalyticsPage'
import SystemLayout from '@/layouts/SystemLayout'
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext'

function MainShell() {
  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-center" richColors />
      <Header />
      <main className="container py-6">
        <Outlet />
      </main>
      <footer className="border-t py-6 mt-8" />
    </div>
  )
}

function WorkspaceShell() {
  return (
    <WorkspaceProvider>
      <Outlet />
    </WorkspaceProvider>
  )
}

function AdminGate({ children }: { children: ReactNode }) {
  const { isAdmin, slug } = useWorkspace()
  if (!isAdmin) {
    return <Navigate to={`/${slug}/resumes`} replace />
  }
  return <>{children}</>
}

function WorkspaceDebugPage() {
  const { slug } = useWorkspace()
  return <DebugPage basePath={`/${slug}/system/data`} />
}

function ProfilesLegacyRedirect() {
  const location = useLocation()
  return <Navigate to={{ pathname: '/dev/system/profiles', search: location.search }} replace />
}

function LegacySystemRedirect() {
  const location = useLocation()
  const suffix = location.pathname.replace(/^\/system\/?/, '')
  const pathname = suffix.length > 0 ? `/dev/system/${suffix}` : '/dev/system'
  return <Navigate to={{ pathname, search: location.search }} replace />
}

function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Navigate to="/dev/resumes" replace />} />
          <Route path="/resumes" element={<Navigate to="/dev/resumes" replace />} />
          <Route path="/profiles" element={<ProfilesLegacyRedirect />} />
          <Route path="/system/*" element={<LegacySystemRedirect />} />
          <Route path="/config/jds" element={<Navigate to="/dev/system/jds" replace />} />
          <Route path="/debug/jds" element={<Navigate to="/dev/system/jds" replace />} />
          <Route path="/debug/config" element={<Navigate to="/dev/system/settings" replace />} />
          <Route path="/debug/ai" element={<Navigate to="/dev/system/ai-debugger" replace />} />
          <Route path="/debug/*" element={<Navigate to="/dev/system/data" replace />} />

          <Route path="/:teamSlug" element={<WorkspaceShell />}>
            <Route index element={<Navigate to="resumes" replace />} />

            <Route element={<MainShell />}>
              <Route path="resumes" element={<ResumesPage />} />
            </Route>

            <Route
              path="system"
              element={
                <AdminGate>
                  <SystemLayout />
                </AdminGate>
              }
            >
              <Route index element={<Navigate to="settings" replace />} />
              <Route path="settings" element={<DebugConfig />} />
              <Route path="jds" element={<DebugJDs />} />
              <Route path="profiles" element={<SearchProfilesPage />} />
              <Route path="ai-debugger" element={<DebugAI />} />
              <Route path="ingest" element={<DebugIngest />} />
              <Route path="search-analytics" element={<SearchAnalyticsPage />} />
              <Route path="data/*" element={<WorkspaceDebugPage />} />
            </Route>

            <Route path="config/jds" element={<Navigate to="../system/jds" replace />} />
            <Route path="debug/jds" element={<Navigate to="../system/jds" replace />} />
            <Route path="debug/config" element={<Navigate to="../system/settings" replace />} />
            <Route path="debug/ai" element={<Navigate to="../system/ai-debugger" replace />} />
            <Route path="debug/*" element={<Navigate to="../system/data" replace />} />
          </Route>

          <Route path="*" element={<Navigate to="/dev/resumes" replace />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  )
}

export default App
