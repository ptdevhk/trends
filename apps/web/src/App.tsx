import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Header } from '@/components/Header'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ResumesPage } from '@/pages/ResumesPage'
import { ReviewPacketsPage } from '@/pages/ReviewPacketsPage'
import SettingsLayout from '@/layouts/SettingsLayout'
import SystemLayout from '@/layouts/SystemLayout'
import SystemSettingsLayout from '@/layouts/SystemSettingsLayout'
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext'
import { ResumeFieldUsagePolicyProvider } from '@/contexts/ResumeFieldUsagePolicyContext'
import { isReviewPacketsEnabled } from '@/lib/feature-flags'

const LazyDebugPage = lazy(async () => {
  const module = await import('@/pages/DebugPage')
  return { default: module.DebugPage }
})

const LazyDebugJDs = lazy(() => import('@/pages/DebugJDs'))
const LazyDebugAI = lazy(() => import('@/pages/DebugAI'))
const LazyDebugConfig = lazy(() => import('@/pages/DebugConfig'))
const LazyDebugIngest = lazy(() => import('@/pages/DebugIngest'))
const LazyArchivedResumes = lazy(() => import('@/pages/ArchivedResumes'))
const LazyDebugAiTaggingResults = lazy(() => import('@/pages/DebugAiTaggingResults'))

const LazyBlacklistPage = lazy(async () => {
  const module = await import('@/pages/BlacklistPage')
  return { default: module.BlacklistPage }
})

const LazySearchProfilesPage = lazy(async () => {
  const module = await import('@/pages/SearchProfilesPage')
  return { default: module.SearchProfilesPage }
})

const LazySummaryRunsPage = lazy(async () => {
  const module = await import('@/pages/SummaryRunsPage')
  return { default: module.SummaryRunsPage }
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

const LazySystemSettingsTaxonomyPage = lazy(async () => {
  const module = await import('@/pages/system-settings/SystemSettingsTaxonomyPage')
  return { default: module.SystemSettingsTaxonomyPage }
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

function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/:teamSlug" element={<WorkspaceShell />}>
            <Route index element={<PreserveSearchNavigate pathname="resumes" />} />

            <Route element={<MainShell />}>
              <Route path="resumes" element={<ResumesPage />} />
              {isReviewPacketsEnabled() ? (
                <Route path="review-packets" element={<ReviewPacketsPage />} />
              ) : (
                <Route path="review-packets" element={<PreserveSearchNavigate pathname="resumes" />} />
              )}
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
                  path="taxonomy"
                  element={(
                    <RouteSuspense>
                      <LazySystemSettingsTaxonomyPage />
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
                path="summaries"
                element={(
                  <RouteSuspense>
                    <LazySummaryRunsPage />
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
                path="archived"
                element={(
                  <RouteSuspense>
                    <LazyArchivedResumes />
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
          </Route>

          <Route path="*" element={<PreserveSearchNavigate pathname="/dev/resumes" />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  )
}

export default App
