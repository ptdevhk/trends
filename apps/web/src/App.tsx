import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Header } from '@/components/Header'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ResumesPage } from '@/pages/ResumesPage'
import SettingsLayout from '@/layouts/SettingsLayout'
import SystemLayout from '@/layouts/SystemLayout'
import SystemSettingsLayout from '@/layouts/SystemSettingsLayout'
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext'
import { ResumeFieldUsagePolicyProvider } from '@/contexts/ResumeFieldUsagePolicyContext'

const LazyDebugPage = lazy(async () => {
  const module = await import('@/pages/DebugPage')
  return { default: module.DebugPage }
})

const LazyDebugJDs = lazy(() => import('@/pages/DebugJDs'))
const LazyDebugAI = lazy(() => import('@/pages/DebugAI'))
const LazyDebugConfig = lazy(() => import('@/pages/DebugConfig'))
const LazyDebugIngest = lazy(() => import('@/pages/DebugIngest'))
const LazyDebugAiTaggingResults = lazy(() => import('@/pages/DebugAiTaggingResults'))

const LazyBlacklistPage = lazy(async () => {
  const module = await import('@/pages/BlacklistPage')
  return { default: module.BlacklistPage }
})

const LazySearchProfilesPage = lazy(async () => {
  const module = await import('@/pages/SearchProfilesPage')
  return { default: module.SearchProfilesPage }
})

const LazySearchAnalyticsPage = lazy(() => import('@/pages/SearchAnalyticsPage'))

const LazySystemSettingsConfigSourcesPage = lazy(async () => {
  const module = await import('@/pages/system-settings/SystemSettingsConfigSourcesPage')
  return { default: module.SystemSettingsConfigSourcesPage }
})

const LazySystemSettingsKeywordsPage = lazy(async () => {
  const module = await import('@/pages/system-settings/SystemSettingsKeywordsPage')
  return { default: module.SystemSettingsKeywordsPage }
})

const LazySystemSettingsLocationsPage = lazy(async () => {
  const module = await import('@/pages/system-settings/SystemSettingsLocationsPage')
  return { default: module.SystemSettingsLocationsPage }
})

const LazySystemSettingsOperationsPage = lazy(async () => {
  const module = await import('@/pages/system-settings/SystemSettingsOperationsPage')
  return { default: module.SystemSettingsOperationsPage }
})

const LazySystemSettingsRuntimePage = lazy(async () => {
  const module = await import('@/pages/system-settings/SystemSettingsRuntimePage')
  return { default: module.SystemSettingsRuntimePage }
})

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

function RouteSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="py-6 text-sm text-muted-foreground">Loading...</div>}>
      {children}
    </Suspense>
  )
}

function PreserveSearchNavigate({ pathname }: { pathname: string }) {
  const location = useLocation()
  return <Navigate to={{ pathname, search: location.search }} replace />
}

function WorkspaceShell() {
  return (
    <WorkspaceProvider>
      <ResumeFieldUsagePolicyProvider>
        <Outlet />
      </ResumeFieldUsagePolicyProvider>
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
  return (
    <RouteSuspense>
      <LazyDebugPage basePath={`/${slug}/system/data`} />
    </RouteSuspense>
  )
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

            <Route path="settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="blocks" replace />} />
              <Route
                path="blocks"
                element={(
                  <RouteSuspense>
                    <LazyBlacklistPage />
                  </RouteSuspense>
                )}
              />
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
              <Route path="settings" element={<SystemSettingsLayout />}>
                <Route
                  index
                  element={(
                    <RouteSuspense>
                      <LazyDebugConfig />
                    </RouteSuspense>
                  )}
                />
                <Route
                  path="operations"
                  element={(
                    <RouteSuspense>
                      <LazySystemSettingsOperationsPage />
                    </RouteSuspense>
                  )}
                />
                <Route
                  path="runtime"
                  element={(
                    <RouteSuspense>
                      <LazySystemSettingsRuntimePage />
                    </RouteSuspense>
                  )}
                />
                <Route
                  path="config-sources"
                  element={(
                    <RouteSuspense>
                      <LazySystemSettingsConfigSourcesPage />
                    </RouteSuspense>
                  )}
                />
                <Route
                  path="keywords"
                  element={(
                    <RouteSuspense>
                      <LazySystemSettingsKeywordsPage />
                    </RouteSuspense>
                  )}
                />
                <Route
                  path="locations"
                  element={(
                    <RouteSuspense>
                      <LazySystemSettingsLocationsPage />
                    </RouteSuspense>
                  )}
                />
              </Route>
              <Route
                path="jds"
                element={(
                  <RouteSuspense>
                    <LazyDebugJDs />
                  </RouteSuspense>
                )}
              />
              <Route
                path="profiles"
                element={(
                  <RouteSuspense>
                    <LazySearchProfilesPage />
                  </RouteSuspense>
                )}
              />
              <Route
                path="ai-debugger"
                element={(
                  <RouteSuspense>
                    <LazyDebugAI />
                  </RouteSuspense>
                )}
              />
              <Route
                path="ai-tagging"
                element={(
                  <RouteSuspense>
                    <LazyDebugAiTaggingResults />
                  </RouteSuspense>
                )}
              />
              <Route
                path="ingest"
                element={(
                  <RouteSuspense>
                    <LazyDebugIngest />
                  </RouteSuspense>
                )}
              />
              <Route
                path="search-analytics"
                element={(
                  <RouteSuspense>
                    <LazySearchAnalyticsPage />
                  </RouteSuspense>
                )}
              />
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
