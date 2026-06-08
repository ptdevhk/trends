import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Header } from '@/components/Header'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LongTaskObserver } from '@/hooks/useLongTaskObserver'
import { ResumesPage } from '@/pages/ResumesPage'
import { ReviewPacketsPage } from '@/pages/ReviewPacketsPage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import SettingsLayout from '@/layouts/SettingsLayout'
import SystemLayout from '@/layouts/SystemLayout'
import SystemSettingsLayout from '@/layouts/SystemSettingsLayout'
import { AuthProvider } from '@/contexts/AuthContext'
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext'
import { BrandDisplayMapProvider } from '@/contexts/BrandDisplayMapContext'
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

const LazyAuditCompliancePage = lazy(async () => {
  const module = await import('@/pages/AuditCompliancePage')
  return { default: module.AuditCompliancePage }
})

const LazyCandidateExplanationPage = lazy(async () => {
  const module = await import('@/pages/CandidateExplanationPage')
  return { default: module.CandidateExplanationPage }
})

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

const LazySystemSettingsAuthPage = lazy(async () => {
  const module = await import('@/pages/system-settings/SystemSettingsAuthPage')
  return { default: module.SystemSettingsAuthPage }
})

const LazySystemSettingsTaxonomyPage = lazy(async () => {
  const module = await import('@/pages/system-settings/SystemSettingsTaxonomyPage')
  return { default: module.SystemSettingsTaxonomyPage }
})

const LazySystemSettingsExportFieldsPage = lazy(async () => {
  const module = await import('@/pages/system-settings/SystemSettingsExportFieldsPage')
  return { default: module.SystemSettingsExportFieldsPage }
})

function MainShell() {
  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-center" richColors />
      <Header />
      <main className="container py-6">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
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
    <WorkspaceProvider invalidFallback={<StandaloneNotFoundPage />}>
      <AuthProvider>
        <ResumeFieldUsagePolicyProvider>
          <BrandDisplayMapProvider>
            <Outlet />
          </BrandDisplayMapProvider>
        </ResumeFieldUsagePolicyProvider>
      </AuthProvider>
    </WorkspaceProvider>
  )
}

function StandaloneNotFoundPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="container py-6">
        <NotFoundPage />
      </main>
    </div>
  )
}

function WorkspaceNotFoundPage() {
  const { slug } = useWorkspace()
  return <NotFoundPage homePath={`/${slug}/resumes`} />
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
      <LongTaskObserver />
      <ErrorBoundary>
        <Routes>
          <Route path="/:teamSlug" element={<WorkspaceShell />}>
            <Route index element={<PreserveSearchNavigate pathname="resumes" />} />

            <Route element={<MainShell />}>
              <Route path="login" element={<LoginPage />} />
              <Route path="resumes" element={<ResumesPage />} />
              {isReviewPacketsEnabled() ? (
                <Route path="review-packets" element={<ReviewPacketsPage />} />
              ) : (
                <Route path="review-packets" element={<PreserveSearchNavigate pathname="resumes" />} />
              )}
              <Route path="*" element={<WorkspaceNotFoundPage />} />
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
              <Route
                path="profiles"
                element={(
                  <RouteSuspense>
                    <LazySearchProfilesPage />
                  </RouteSuspense>
                )}
              />
              <Route
                path="export-fields"
                element={(
                  <RouteSuspense>
                    <LazySystemSettingsExportFieldsPage />
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
                  path="auth"
                  element={(
                    <RouteSuspense>
                      <LazySystemSettingsAuthPage />
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
                <Route
                  path="export-fields"
                  element={(
                    <RouteSuspense>
                      <LazySystemSettingsExportFieldsPage />
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
              <Route
                path="audit-compliance"
                element={(
                  <RouteSuspense>
                    <LazyAuditCompliancePage />
                  </RouteSuspense>
                )}
              />
              <Route path="data/*" element={<WorkspaceDebugPage />} />
            </Route>
          </Route>

          {/* Public route: candidate explanation (EU AI Act Art. 13) */}
          <Route
            path="/explanation/:resumeId"
            element={
              <ErrorBoundary>
                <RouteSuspense>
                  <LazyCandidateExplanationPage />
                </RouteSuspense>
              </ErrorBoundary>
            }
          />

          <Route path="/" element={<PreserveSearchNavigate pathname="/dev/resumes" />} />
          <Route path="*" element={<StandaloneNotFoundPage />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  )
}

export default App
