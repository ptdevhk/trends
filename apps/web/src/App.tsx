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
import { PublicSharePage } from '@/pages/PublicSharePage'
import SettingsLayout from '@/layouts/SettingsLayout'
import SystemLayout from '@/layouts/SystemLayout'
import SystemSettingsLayout from '@/layouts/SystemSettingsLayout'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext'
import { BrandDisplayMapProvider } from '@/contexts/BrandDisplayMapContext'
import { ResumeFieldUsagePolicyProvider } from '@/contexts/ResumeFieldUsagePolicyContext'
import { isReviewPacketsEnabled } from '@/lib/feature-flags'
import {
  canUseExplicitRedirect,
  getFirstAuthorizedWorkspaceSlug,
  getDefaultAuthenticatedPath,
  hasSystemAdminAccess,
  hasWorkspaceMembership,
  PUBLIC_RESUME_WORKSPACE,
  SYSTEM_AUTH_WORKSPACE,
  SYSTEM_ROUTE_PREFIX,
} from '@/lib/workspace-access'

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

const LazySystemSetupPage = lazy(async () => {
  const module = await import('@/pages/system-setup/SystemSetupPage')
  return { default: module.SystemSetupPage }
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

const LazyAccountPage = lazy(async () => {
  const module = await import('@/pages/AccountPage')
  return { default: module.AccountPage }
})

function MainShell({ children }: { children?: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-center" richColors />
      <Header />
      <main className="container py-6">
        <ErrorBoundary>
          {children ?? <Outlet />}
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

function AppProviders({
  children,
  surface,
  workspaceSlug,
  invalidFallback,
}: {
  children: ReactNode
  surface?: 'workspace' | 'system' | 'public'
  workspaceSlug?: typeof SYSTEM_AUTH_WORKSPACE | typeof PUBLIC_RESUME_WORKSPACE
  invalidFallback?: ReactNode
}) {
  return (
    <WorkspaceProvider
      workspaceSlug={workspaceSlug}
      surface={surface}
      invalidFallback={invalidFallback}
    >
      <AuthProvider>
        <ResumeFieldUsagePolicyProvider>
          <BrandDisplayMapProvider>
            {children}
          </BrandDisplayMapProvider>
        </ResumeFieldUsagePolicyProvider>
      </AuthProvider>
    </WorkspaceProvider>
  )
}

function WorkspaceShell() {
  return (
    <AppProviders invalidFallback={<StandaloneNotFoundPage />}>
      <WorkspaceMembershipGate>
        <Outlet />
      </WorkspaceMembershipGate>
    </AppProviders>
  )
}

function PublicResumeRoute() {
  return (
    <AppProviders workspaceSlug={PUBLIC_RESUME_WORKSPACE} surface="public">
      <MainShell>
        <ResumesPage />
      </MainShell>
    </AppProviders>
  )
}

function PublicShareRoute() {
  return (
    <AppProviders workspaceSlug={PUBLIC_RESUME_WORKSPACE} surface="public">
      <MainShell>
        <PublicSharePage />
      </MainShell>
    </AppProviders>
  )
}

function SystemWorkspaceShell() {
  return (
    <AppProviders workspaceSlug={SYSTEM_AUTH_WORKSPACE} surface="system">
      <Outlet />
    </AppProviders>
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

function WorkspaceMembershipGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const { slug } = useWorkspace()
  const location = useLocation()
  if (auth.isLoading) {
    return <div className="py-6 text-sm text-muted-foreground">Loading...</div>
  }
  if (auth.isAuthenticated && !hasWorkspaceMembership(auth.memberships, slug)) {
    const fallbackSlug = getFirstAuthorizedWorkspaceSlug(auth.memberships) ?? SYSTEM_AUTH_WORKSPACE
    return <Navigate to={{ pathname: `/${fallbackSlug}/resumes`, search: location.search }} replace />
  }
  return <>{children}</>
}

function SystemAccessGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const location = useLocation()
  if (auth.isLoading) {
    return <div className="py-6 text-sm text-muted-foreground">Loading...</div>
  }
  if (!auth.isAuthenticated) {
    const redirectTo = `${location.pathname}${location.search}`
    const search = new URLSearchParams({ redirectTo }).toString()
    return <Navigate to={{ pathname: `/${SYSTEM_AUTH_WORKSPACE}/login`, search: `?${search}` }} replace />
  }
  if (!hasSystemAdminAccess(auth.memberships)) {
    const fallbackSlug = getFirstAuthorizedWorkspaceSlug(auth.memberships) ?? SYSTEM_AUTH_WORKSPACE
    return <Navigate to={{ pathname: `/${fallbackSlug}/resumes`, search: location.search }} replace />
  }
  return <>{children}</>
}

function WorkspaceSystemAccessDeniedRoute() {
  const auth = useAuth()
  const location = useLocation()

  if (!auth.isAuthenticated) {
    const redirectTo = `${location.pathname}${location.search}`
    const search = new URLSearchParams({ redirectTo }).toString()
    return <Navigate to={{ pathname: `/${SYSTEM_AUTH_WORKSPACE}/login`, search: `?${search}` }} replace />
  }

  if (hasSystemAdminAccess(auth.memberships)) {
    const suffix = location.pathname.replace(/^\/[^/]+\/system/, '')
    return <Navigate to={{ pathname: `${SYSTEM_ROUTE_PREFIX}${suffix}`, search: location.search }} replace />
  }

  return (
    <MainShell>
      <section className="mx-auto max-w-xl py-12">
        <div className="rounded-md border border-destructive/30 p-6">
          <h1 className="text-xl font-semibold tracking-tight">Admin access required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            System settings require a dev workspace admin account.
          </p>
        </div>
      </section>
    </MainShell>
  )
}

function LegacyDevSystemRedirect() {
  const location = useLocation()
  const suffix = location.pathname.replace(/^\/dev\/system/, '')
  return <Navigate to={{ pathname: `${SYSTEM_ROUTE_PREFIX}${suffix}`, search: location.search }} replace />
}

function LoginRedirect() {
  const auth = useAuth()
  const location = useLocation()
  const redirectTo = new URLSearchParams(location.search).get('redirectTo')

  if (auth.isLoading) {
    return <div className="py-6 text-sm text-muted-foreground">Loading...</div>
  }

  if (auth.isAuthenticated) {
    const currentAuth = auth.user
      ? { success: true as const, user: auth.user, memberships: auth.memberships, workspaceRole: auth.workspaceRole }
      : null
    if (currentAuth) {
      const target = redirectTo && canUseExplicitRedirect(currentAuth, redirectTo)
        ? redirectTo
        : getDefaultAuthenticatedPath(currentAuth, SYSTEM_AUTH_WORKSPACE)
      return <Navigate to={target} replace />
    }
  }

  const search = redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : ''
  return <Navigate to={`/${SYSTEM_AUTH_WORKSPACE}/login${search}`} replace />
}

function WorkspaceResumeRoute() {
  const auth = useAuth()
  const { slug } = useWorkspace()
  if (!auth.isLoading && !auth.isAuthenticated && slug === PUBLIC_RESUME_WORKSPACE) {
    return <PreserveSearchNavigate pathname="/resumes" />
  }
  return <ResumesPage />
}

function WorkspaceDebugPage() {
  const { isSystemSurface, slug } = useWorkspace()
  const basePath = isSystemSurface ? `${SYSTEM_ROUTE_PREFIX}/data` : `/${slug}/system/data`
  return (
    <RouteSuspense>
      <LazyDebugPage basePath={basePath} />
    </RouteSuspense>
  )
}

function App() {
  return (
    <BrowserRouter>
      <LongTaskObserver />
      <ErrorBoundary>
        <Routes>
          <Route path="/resumes" element={<PublicResumeRoute />} />
          <Route path="/s/:token" element={<PublicShareRoute />} />
          <Route path="/dev/system/*" element={<LegacyDevSystemRedirect />} />
          <Route path="/login" element={<AppProviders workspaceSlug="dev"><LoginRedirect /></AppProviders>} />
          <Route path="/admin/system" element={<SystemWorkspaceShell />}>
            <Route
              element={(
                <SystemAccessGate>
                  <SystemLayout />
                </SystemAccessGate>
              )}
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
                path="setup"
                element={(
                  <RouteSuspense>
                    <LazySystemSetupPage />
                  </RouteSuspense>
                )}
              />
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

          <Route path="/:teamSlug" element={<WorkspaceShell />}>
            <Route index element={<PreserveSearchNavigate pathname="resumes" />} />
            <Route path="system/*" element={<WorkspaceSystemAccessDeniedRoute />} />

            <Route element={<MainShell />}>
              <Route path="login" element={<LoginPage />} />
              <Route path="resumes" element={<WorkspaceResumeRoute />} />
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
              <Route
                path="account"
                element={(
                  <RouteSuspense>
                    <LazyAccountPage />
                  </RouteSuspense>
                )}
              />
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

          <Route path="/" element={<PreserveSearchNavigate pathname="/resumes" />} />
          <Route path="*" element={<StandaloneNotFoundPage />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  )
}

export default App
