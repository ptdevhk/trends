import { lazy, Suspense, type ReactNode } from 'react'
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom'
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
import { AnalysisTasksProvider } from '@/contexts/AnalysisTasksContext'
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext'
import { BrandDisplayMapProvider } from '@/contexts/BrandDisplayMapContext'
import { ResumeFieldUsagePolicyProvider } from '@/contexts/ResumeFieldUsagePolicyContext'
import { ResumeWorkHistoryLimitProvider } from '@/contexts/ResumeWorkHistoryLimitContext'
import { isReviewPacketsEnabled } from '@/lib/feature-flags'
import {
  canUseExplicitRedirect,
  getFirstAuthorizedWorkspaceSlug,
  getDefaultAuthenticatedPath,
  hasSystemAdminAccess,
  hasWorkspaceAdminAccess,
  hasWorkspaceIndustryReviewAccess,
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

const LazyPoliciesPage = lazy(async () => {
  const module = await import('@/pages/PoliciesPage')
  return { default: module.PoliciesPage }
})

const LazyResearchCompanyPage = lazy(async () => {
  const module = await import('@/pages/ResearchCompanyPage')
  return { default: module.ResearchCompanyPage }
})

const LazyResearchIndexPage = lazy(async () => {
  const module = await import('@/pages/ResearchIndexPage')
  return { default: module.ResearchIndexPage }
})

const LazySearchProfilesPage = lazy(async () => {
  const module = await import('@/pages/SearchProfilesPage')
  return { default: module.SearchProfilesPage }
})

const LazySettingsKeywordsPage = lazy(async () => {
  const module = await import('@/pages/SettingsKeywordsPage')
  return { default: module.SettingsKeywordsPage }
})

const LazySettingsSetupPage = lazy(async () => {
  const module = await import('@/pages/SettingsSetupPage')
  return { default: module.SettingsSetupPage }
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

const LazySystemSettingsIndustryVerificationPage = lazy(async () => {
  const module = await import('@/pages/system-settings/SystemSettingsIndustryVerificationPage')
  return { default: module.SystemSettingsIndustryVerificationPage }
})

const LazySystemSettingsIndustryDataPage = lazy(async () => {
  const module = await import('@/pages/system-settings/SystemSettingsIndustryDataPage')
  return { default: module.SystemSettingsIndustryDataPage }
})

const LazySystemSettingsIndustryAuditPage = lazy(async () => {
  const module = await import('@/pages/system-settings/SystemSettingsIndustryAuditPage')
  return { default: module.default }
})

const LazySystemSettingsExportFieldsPage = lazy(async () => {
  const module = await import('@/pages/system-settings/SystemSettingsExportFieldsPage')
  return { default: module.SystemSettingsExportFieldsPage }
})

const LazySystemSettingsWorkspacePage = lazy(async () => {
  const module = await import('@/pages/system-settings/SystemSettingsWorkspacePage')
  return { default: module.SystemSettingsWorkspacePage }
})

const LazySystemSettingsResumeDedupReviewPage = lazy(async () => {
  const module = await import('@/pages/system-settings/ResumeDedupReviewPage')
  return { default: module.default }
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
        <AnalysisTasksProvider>
          <ResumeWorkHistoryLimitProvider>
            <ResumeFieldUsagePolicyProvider>
              <BrandDisplayMapProvider>
                {children}
              </BrandDisplayMapProvider>
            </ResumeFieldUsagePolicyProvider>
          </ResumeWorkHistoryLimitProvider>
        </AnalysisTasksProvider>
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
      <PublicResumeSurface />
    </AppProviders>
  )
}

function PublicResumeSurface() {
  const auth = useAuth()
  const location = useLocation()

  if (
    !auth.isLoading
    && auth.isAuthenticated
    && hasWorkspaceMembership(auth.memberships, PUBLIC_RESUME_WORKSPACE)
  ) {
    return (
      <Navigate
        to={{ pathname: `/${PUBLIC_RESUME_WORKSPACE}/resumes`, search: location.search }}
        replace
      />
    )
  }

  return (
    <MainShell>
      <ResumesPage />
    </MainShell>
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
  if (!auth.isAuthenticated && slug !== PUBLIC_RESUME_WORKSPACE && location.pathname !== `/${slug}/login`) {
    const redirectTo = `${location.pathname}${location.search}`
    const search = new URLSearchParams({ redirectTo }).toString()
    return <Navigate to={{ pathname: '/login', search: `?${search}` }} replace />
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
    return <Navigate to={{ pathname: '/login', search: `?${search}` }} replace />
  }
  if (!hasSystemAdminAccess(auth.memberships)) {
    const fallbackSlug = getFirstAuthorizedWorkspaceSlug(auth.memberships) ?? SYSTEM_AUTH_WORKSPACE
    return <Navigate to={{ pathname: `/${fallbackSlug}/resumes`, search: location.search }} replace />
  }
  return <>{children}</>
}

/**
 * Workspace system routes (`/:teamSlug/system/*`).
 *
 * - Anonymous: redirect through canonical /login.
 * - Dev-workspace system admins: canonical /admin/system (unchanged).
 * - Everyone else: nested routes decide — the industry review surfaces
 *   (industry-verification / industry-audit) are workspace-scoped and
 *   accept the active workspace's admin or reviewer; the industry ops
 *   surface (industry-data) stays admin-only; every other system route
 *   keeps the dev-admin-only denial.
 */
function WorkspaceSystemRoute() {
  const auth = useAuth()
  const location = useLocation()

  if (!auth.isAuthenticated) {
    const redirectTo = `${location.pathname}${location.search}`
    const search = new URLSearchParams({ redirectTo }).toString()
    return <Navigate to={{ pathname: '/login', search: `?${search}` }} replace />
  }

  if (hasSystemAdminAccess(auth.memberships)) {
    const suffix = location.pathname.replace(/^\/[^/]+\/system/, '')
    return <Navigate to={{ pathname: `${SYSTEM_ROUTE_PREFIX}${suffix}`, search: location.search }} replace />
  }

  return <Outlet />
}

function WorkspaceSystemDeniedPage() {
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

/**
 * Industry review surfaces are workspace-scoped: the active workspace's
 * admin or reviewer may attend its own industry evidence queue (the API
 * already honors X-Workspace-Slug per workspace and grants reviewers the
 * industry:review permission). Users without admin/reviewer membership in
 * the active workspace keep the denial page.
 */
function WorkspaceIndustryAccessGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const { teamSlug } = useParams()
  const location = useLocation()
  const workspaceSlug = teamSlug ?? SYSTEM_AUTH_WORKSPACE

  if (auth.isLoading) {
    return <div className="py-6 text-sm text-muted-foreground">Loading...</div>
  }
  if (!auth.isAuthenticated) {
    const redirectTo = `${location.pathname}${location.search}`
    const search = new URLSearchParams({ redirectTo }).toString()
    return <Navigate to={{ pathname: '/login', search: `?${search}` }} replace />
  }
  if (!hasWorkspaceIndustryReviewAccess(auth.memberships, workspaceSlug)) {
    return (
      <MainShell>
        <section className="mx-auto max-w-xl py-12">
          <div className="rounded-md border border-destructive/30 p-6">
            <h1 className="text-xl font-semibold tracking-tight">Admin access required</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Industry review requires a {workspaceSlug} workspace admin or reviewer account.
            </p>
          </div>
        </section>
      </MainShell>
    )
  }
  return <>{children}</>
}

/**
 * Industry ops surfaces (maintenance runs, coverage, recompute, and the
 * industry-data administration page) stay admin-only: reviewers pass the
 * review gate above but must not reach ops tabs — the API keeps those
 * routes behind requireAdmin.
 */
function WorkspaceIndustryOpsGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const { teamSlug } = useParams()
  const location = useLocation()
  const workspaceSlug = teamSlug ?? SYSTEM_AUTH_WORKSPACE

  if (auth.isLoading) {
    return <div className="py-6 text-sm text-muted-foreground">Loading...</div>
  }
  if (!auth.isAuthenticated) {
    const redirectTo = `${location.pathname}${location.search}`
    const search = new URLSearchParams({ redirectTo }).toString()
    return <Navigate to={{ pathname: '/login', search: `?${search}` }} replace />
  }
  if (!hasWorkspaceAdminAccess(auth.memberships, workspaceSlug)) {
    return (
      <MainShell>
        <section className="mx-auto max-w-xl py-12">
          <div className="rounded-md border border-destructive/30 p-6">
            <h1 className="text-xl font-semibold tracking-tight">Admin access required</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Industry operations require a {workspaceSlug} workspace admin account.
            </p>
          </div>
        </section>
      </MainShell>
    )
  }
  return <>{children}</>
}

function LegacyDevSystemRedirect() {
  const location = useLocation()
  const suffix = location.pathname.replace(/^\/dev\/system/, '')
  return <Navigate to={{ pathname: `${SYSTEM_ROUTE_PREFIX}${suffix}`, search: location.search }} replace />
}

function LegacyAdminWorkspaceRedirect({ pathname }: { pathname: string }) {
  const location = useLocation()
  return <Navigate to={{ pathname, search: location.search }} replace />
}

function LoginRoute() {
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

  // Canonical login page stays at /login (no bounce to /dev/login).
  return (
    <MainShell>
      <LoginPage />
    </MainShell>
  )
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
          <Route
            path="/admin/system/setup"
            element={<LegacyAdminWorkspaceRedirect pathname={`/${SYSTEM_AUTH_WORKSPACE}/settings/setup`} />}
          />
          <Route
            path="/admin/system/settings/keywords"
            element={<LegacyAdminWorkspaceRedirect pathname={`/${SYSTEM_AUTH_WORKSPACE}/settings/keywords`} />}
          />
          <Route
            path="/admin/system/settings/locations"
            element={<LegacyAdminWorkspaceRedirect pathname={`/${SYSTEM_AUTH_WORKSPACE}/settings/keywords`} />}
          />
          <Route path="/login" element={<AppProviders workspaceSlug={SYSTEM_AUTH_WORKSPACE}><LoginRoute /></AppProviders>} />
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
                  path="taxonomy"
                  element={(
                    <RouteSuspense>
                      <LazySystemSettingsTaxonomyPage />
                    </RouteSuspense>
                  )}
                />
                <Route
                  path="industry-verification"
                  element={(
                    <RouteSuspense>
                      <LazySystemSettingsIndustryVerificationPage />
                    </RouteSuspense>
                  )}
                />
                <Route
                  path="industry-verification/proposals/:proposalId"
                  element={(
                    <RouteSuspense>
                      <LazySystemSettingsIndustryVerificationPage />
                    </RouteSuspense>
                  )}
                />
                <Route
                  path="industry-data"
                  element={(
                    <RouteSuspense>
                      <LazySystemSettingsIndustryDataPage />
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
                  path="workspace"
                  element={(
                    <RouteSuspense>
                      <LazySystemSettingsWorkspacePage />
                    </RouteSuspense>
                  )}
                />
                <Route
                  path="resume-dedup"
                  element={(
                    <RouteSuspense>
                      <LazySystemSettingsResumeDedupReviewPage />
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

          <Route path="/:teamSlug" element={<WorkspaceShell />}>
            <Route index element={<PreserveSearchNavigate pathname="resumes" />} />
            <Route path="system/*" element={<WorkspaceSystemRoute />}>
              <Route
                path="settings/industry-verification"
                element={(
                  <WorkspaceIndustryAccessGate>
                    <MainShell>
                      <RouteSuspense>
                        <LazySystemSettingsIndustryVerificationPage />
                      </RouteSuspense>
                    </MainShell>
                  </WorkspaceIndustryAccessGate>
                )}
              />
              <Route
                path="settings/industry-verification/proposals/:proposalId"
                element={(
                  <WorkspaceIndustryAccessGate>
                    <MainShell>
                      <RouteSuspense>
                        <LazySystemSettingsIndustryVerificationPage />
                      </RouteSuspense>
                    </MainShell>
                  </WorkspaceIndustryAccessGate>
                )}
              />
              <Route
                path="settings/industry-data"
                element={(
                  <WorkspaceIndustryOpsGate>
                    <MainShell>
                      <RouteSuspense>
                        <LazySystemSettingsIndustryDataPage />
                      </RouteSuspense>
                    </MainShell>
                  </WorkspaceIndustryOpsGate>
                )}
              />
              <Route
                path="settings/industry-audit"
                element={(
                  <WorkspaceIndustryAccessGate>
                    <MainShell>
                      <RouteSuspense>
                        <LazySystemSettingsIndustryAuditPage />
                      </RouteSuspense>
                    </MainShell>
                  </WorkspaceIndustryAccessGate>
                )}
              />
              <Route path="*" element={<WorkspaceSystemDeniedPage />} />
            </Route>

            <Route element={<MainShell />}>
              <Route path="login" element={<LoginPage />} />
              <Route path="resumes/:resumeId" element={<WorkspaceResumeRoute />} />
              <Route path="resumes" element={<WorkspaceResumeRoute />} />
              {isReviewPacketsEnabled() ? (
                <Route path="review-packets" element={<ReviewPacketsPage />} />
              ) : (
                <Route path="review-packets" element={<PreserveSearchNavigate pathname="resumes" />} />
              )}
              <Route
                path="research"
                element={(
                  <RouteSuspense>
                    <LazyResearchIndexPage />
                  </RouteSuspense>
                )}
              />
              <Route
                path="research/:companyKey"
                element={(
                  <RouteSuspense>
                    <LazyResearchCompanyPage />
                  </RouteSuspense>
                )}
              />
              <Route path="*" element={<WorkspaceNotFoundPage />} />
            </Route>

            <Route path="settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="policies" replace />} />
              <Route
                path="setup"
                element={(
                  <RouteSuspense>
                    <LazySettingsSetupPage />
                  </RouteSuspense>
                )}
              />
              <Route
                path="keywords"
                element={(
                  <RouteSuspense>
                    <LazySettingsKeywordsPage />
                  </RouteSuspense>
                )}
              />
              <Route
                path="policies"
                element={(
                  <RouteSuspense>
                    <LazyPoliciesPage />
                  </RouteSuspense>
                )}
              />
              <Route
                path="blocks"
                element={<Navigate to="../policies" replace />}
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
