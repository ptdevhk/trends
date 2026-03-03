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

function PreserveSearchNavigate({ pathname }: { pathname: string }) {
  const location = useLocation()
  return <Navigate to={{ pathname, search: location.search }} replace />
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
  const location = useLocation()
  if (!isAdmin) {
    return <Navigate to={{ pathname: `/${slug}/resumes`, search: location.search }} replace />
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
          <Route path="/" element={<PreserveSearchNavigate pathname="/dev/resumes" />} />
          <Route path="/resumes" element={<PreserveSearchNavigate pathname="/dev/resumes" />} />
          <Route path="/profiles" element={<ProfilesLegacyRedirect />} />
          <Route path="/system/*" element={<LegacySystemRedirect />} />
          <Route path="/config/jds" element={<PreserveSearchNavigate pathname="/dev/system/jds" />} />
          <Route path="/debug/jds" element={<PreserveSearchNavigate pathname="/dev/system/jds" />} />
          <Route path="/debug/config" element={<PreserveSearchNavigate pathname="/dev/system/settings" />} />
          <Route path="/debug/ai" element={<PreserveSearchNavigate pathname="/dev/system/ai-debugger" />} />
          <Route path="/debug/*" element={<PreserveSearchNavigate pathname="/dev/system/data" />} />

          <Route path="/:teamSlug" element={<WorkspaceShell />}>
            <Route index element={<PreserveSearchNavigate pathname="resumes" />} />

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

            <Route path="config/jds" element={<PreserveSearchNavigate pathname="../system/jds" />} />
            <Route path="debug/jds" element={<PreserveSearchNavigate pathname="../system/jds" />} />
            <Route path="debug/config" element={<PreserveSearchNavigate pathname="../system/settings" />} />
            <Route path="debug/ai" element={<PreserveSearchNavigate pathname="../system/ai-debugger" />} />
            <Route path="debug/*" element={<PreserveSearchNavigate pathname="../system/data" />} />
          </Route>

          <Route path="*" element={<PreserveSearchNavigate pathname="/dev/resumes" />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  )
}

export default App
