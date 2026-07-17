import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Ban, Copy, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  fetchHrDemoSilentLoginInfo,
  fetchProviderMemberships,
  preapproveProviderMembership,
  revokeProviderMembership,
  type AuthProvider,
  type HrDemoSilentLoginInfo,
  type ProviderMembershipApiError,
  type ProviderMembershipPreapproval,
  type ProviderMembershipsResponse,
  type WorkspaceRole,
} from '@/lib/auth'
import { formatAuthUserLabel } from '@/lib/auth-user-label'
import { reportUiError } from '@/lib/ui-error-reporting'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { UsersPanel } from './admin-users/UsersPanel'

type FormState = {
  provider: AuthProvider
  providerSubject: string
  providerTenant: string
  workspaceSlug: string
  role: WorkspaceRole
}

function createInitialForm(workspaceSlug: string): FormState {
  return {
    provider: 'casdoor',
    providerSubject: '',
    providerTenant: '',
    workspaceSlug,
    role: 'user',
  }
}

function toActionId(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]+/g, '-')
}

function formatProviderMembershipError(error: ProviderMembershipApiError): string {
  return error.status === undefined ? error.error : `${error.error} (${error.status})`
}

function Pill({ children, active = true }: { children: string; active?: boolean }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
      {children}
    </span>
  )
}

function StatusPill({ active }: { active: boolean }) {
  return <Pill active={active}>{active ? 'Active' : 'Revoked'}</Pill>
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-6 text-center text-sm text-muted-foreground">
        {label}
      </td>
    </tr>
  )
}

function FieldLabel({ children }: { children: string }) {
  return <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</dt>
}

function PolicyField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <FieldLabel>{label}</FieldLabel>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

function StackedRecord({
  title,
  fields,
  action,
}: {
  title: ReactNode
  fields: Array<{ label: string; value: ReactNode }>
  action?: ReactNode
}) {
  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-sm font-medium">{title}</div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <PolicyField key={field.label} label={field.label}>
            {field.value}
          </PolicyField>
        ))}
      </dl>
    </div>
  )
}

function ResponsiveTable({
  headers,
  emptyLabel,
  isEmpty,
  minWidthClassName,
  children,
  stacked,
}: {
  headers: string[]
  emptyLabel: string
  isEmpty: boolean
  minWidthClassName: string
  children: ReactNode
  stacked: ReactNode
}) {
  return (
    <>
      <div className="hidden lg:block overflow-x-auto">
        <table className={`w-full ${minWidthClassName} text-sm`}>
          <thead className="border-b text-left text-xs uppercase text-muted-foreground">
            <tr>
              {headers.map((header) => (
                <th key={header || 'actions'} className="px-3 py-2">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isEmpty ? <EmptyRow colSpan={headers.length} label={emptyLabel} /> : children}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 lg:hidden" data-testid="auth-stacked-records">
        {isEmpty ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          stacked
        )}
      </div>
    </>
  )
}

export function SystemSettingsAuthPage() {
  const { t } = useTranslation()
  const { slug } = useWorkspace()
  const auth = useAuth()
  const [state, setState] = useState<ProviderMembershipsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [accessError, setAccessError] = useState<ProviderMembershipApiError | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<FormState>(() => createInitialForm(slug))
  const [temporaryPasswordBanner, setTemporaryPasswordBanner] = useState<string | null>(null)
  const [hrDemoSilent, setHrDemoSilent] = useState<HrDemoSilentLoginInfo | null>(null)
  const providerIdentities = state?.identities.filter((identity) => identity.provider === form.provider) ?? []
  const anonymousResumeSearchEnabled = slug === 'hr'
  const currentRoleLabel = auth.workspaceRole === 'admin'
    ? 'Workspace admin'
    : auth.workspaceRole === 'user'
      ? 'Workspace user'
      : 'No workspace role'
  const currentUserLabel = auth.user ? formatAuthUserLabel(auth.user) : 'Signed out'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [result, silentInfo] = await Promise.all([
        fetchProviderMemberships(),
        fetchHrDemoSilentLoginInfo(),
      ])
      if (result.success === false) {
        setState(null)
        setAccessError(result)
        setAccessDenied(true)
        setHrDemoSilent(null)
        return
      }
      setState(result)
      setAccessError(null)
      setAccessDenied(false)
      if (silentInfo.success === true) {
        setHrDemoSilent(silentInfo)
      } else {
        setHrDemoSilent(null)
      }
    } catch (error) {
      reportUiError('Failed to load provider membership state', error)
      setState(null)
      setAccessError(null)
      setAccessDenied(true)
      setHrDemoSilent(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handlePreapprove() {
    if (!form.providerSubject.trim() || !form.providerTenant.trim() || !form.workspaceSlug.trim()) {
      toast.error(t('debugConfig.authAccessRequiredFields', { defaultValue: 'Provider subject, tenant, and workspace are required' }))
      return
    }
    setSubmitting(true)
    try {
      const result = await preapproveProviderMembership({
        provider: form.provider,
        providerSubject: form.providerSubject.trim(),
        providerTenant: form.providerTenant.trim(),
        workspaceSlug: form.workspaceSlug.trim(),
        role: form.role,
      })
      if (result.success === false) {
        toast.error(result.error)
        return
      }
      toast.success(t('debugConfig.authAccessGrantSaved', { defaultValue: 'Provider access saved' }))
      await load()
    } catch (error) {
      reportUiError('Failed to preapprove provider membership', error)
      toast.error(t('debugConfig.authAccessGrantFailed', { defaultValue: 'Failed to grant provider access' }))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRevoke(preapproval: ProviderMembershipPreapproval) {
    const confirmed = window.confirm(t('debugConfig.authAccessRevokeConfirm', {
      defaultValue: 'Revoke this provider-derived workspace access?',
    }))
    if (!confirmed) {
      return
    }

    setSubmitting(true)
    try {
      const result = await revokeProviderMembership({
        provider: preapproval.provider,
        providerSubject: preapproval.providerSubject,
        providerTenant: preapproval.providerTenant,
        workspaceSlug: preapproval.workspaceSlug,
      })
      if (result.success === false) {
        toast.error(result.error)
        return
      }
      toast.success(t('debugConfig.authAccessRevoked', { defaultValue: 'Provider access revoked' }))
      await load()
    } catch (error) {
      reportUiError('Failed to revoke provider membership', error)
      toast.error(t('debugConfig.authAccessRevokeFailed', { defaultValue: 'Failed to revoke provider access' }))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="py-6 text-sm text-muted-foreground">Loading...</div>
  }

  if (accessDenied || !state) {
    return (
      <div className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">
          {t('debugConfig.settingsNavAuth', { defaultValue: 'Auth access' })}
        </h2>
        <Card className="border-destructive/30">
          <CardContent className="py-6 text-sm text-destructive">
            {accessError
              ? formatProviderMembershipError(accessError)
              : t('debugConfig.authAccessAdminRequired', { defaultValue: 'Admin access required' })}
          </CardContent>
        </Card>
      </div>
    )
  }

  const policyRows = [
    {
      principal: 'Everyone / anonymous',
      role: 'public-search',
      search: anonymousResumeSearchEnabled ? <Pill>resume:search</Pill> : <Pill active={false}>not granted</Pill>,
      operational: <span className="text-muted-foreground">login required</span>,
      writes: <span className="text-muted-foreground">login required</span>,
    },
    {
      principal: 'Workspace users',
      role: 'user',
      search: <Pill>resume:search</Pill>,
      operational: (
        <div className="flex flex-wrap gap-1">
          <Pill>candidate:status:read</Pill>
          <Pill>candidate:action:read</Pill>
        </div>
      ),
      writes: <Pill>candidate:mutate</Pill>,
    },
    {
      principal: 'Workspace admins',
      role: 'admin',
      search: <Pill>resume:search</Pill>,
      operational: <Pill>resume:export</Pill>,
      writes: <Pill>workspace:admin</Pill>,
    },
  ]

  return (
    <div className="min-w-0 space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">
          {t('debugConfig.settingsNavAuth', { defaultValue: 'Auth access' })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('debugConfig.authAccessPageDescription', {
            defaultValue: 'Manage provider-derived workspace access and review related auth events.',
          })}
        </p>
      </div>

      {hrDemoSilent ? (
        <Card data-testid="hr-demo-silent-login-panel" className="border-sky-200 bg-sky-50/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {t('debugConfig.hrDemoSilentTitle', { defaultValue: 'HR demo silent login' })}
            </CardTitle>
            <CardDescription>
              {t('debugConfig.hrDemoSilentDescription', {
                defaultValue:
                  'Shared desk bookmark token (AUTH_HR_DEMO_TOKEN). Append as ?auth=… on /hr/resumes deep links for passwordless full member desk access.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Username</dt>
                <dd className="font-mono">{hrDemoSilent.username}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</dt>
                <dd>
                  {!hrDemoSilent.configured ? (
                    <Pill active={false}>not configured</Pill>
                  ) : hrDemoSilent.revealable ? (
                    <Pill>configured · revealable</Pill>
                  ) : (
                    <Pill active={false}>configured · hash only</Pill>
                  )}
                </dd>
              </div>
            </dl>

            {hrDemoSilent.configured && hrDemoSilent.tokenFingerprint ? (
              <p className="text-xs text-muted-foreground">
                Fingerprint: <code className="font-mono">{hrDemoSilent.tokenFingerprint}</code>
              </p>
            ) : null}

            {hrDemoSilent.revealable && hrDemoSilent.token ? (
              <>
                <div className="space-y-1">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    AUTH_HR_DEMO_TOKEN
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <code
                      data-testid="hr-demo-silent-token"
                      className="rounded bg-white px-2 py-1 font-mono text-sm break-all border"
                    >
                      {hrDemoSilent.token}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="copy-hr-demo-silent-token"
                      onClick={() => {
                        void navigator.clipboard.writeText(hrDemoSilent.token ?? '')
                        toast.success(t('debugConfig.hrDemoSilentTokenCopied', {
                          defaultValue: 'Silent login token copied',
                        }))
                      }}
                    >
                      <Copy className="mr-1 h-3 w-3" />
                      {t('debugConfig.hrDemoSilentCopyToken', { defaultValue: 'Copy token' })}
                    </Button>
                  </div>
                </div>
                {hrDemoSilent.samplePath ? (
                  <div className="space-y-1">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Sample HR path
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <code
                        data-testid="hr-demo-silent-sample-path"
                        className="rounded bg-white px-2 py-1 font-mono text-xs break-all border"
                      >
                        {hrDemoSilent.samplePath}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid="copy-hr-demo-silent-sample"
                        onClick={() => {
                          const absolute = `${window.location.origin}${hrDemoSilent.samplePath}`
                          void navigator.clipboard.writeText(absolute)
                          toast.success(t('debugConfig.hrDemoSilentLinkCopied', {
                            defaultValue: 'Silent login link copied',
                          }))
                        }}
                      >
                        <Copy className="mr-1 h-3 w-3" />
                        {t('debugConfig.hrDemoSilentCopyLink', { defaultValue: 'Copy full URL' })}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('debugConfig.hrDemoSilentHint', {
                        defaultValue:
                          'Paste filters after the path if needed, e.g. &location=China&q=CNC. Treat the token like a shared password.',
                      })}
                    </p>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {!hrDemoSilent.configured
                  ? t('debugConfig.hrDemoSilentNotConfigured', {
                      defaultValue:
                        'Set AUTH_HR_DEMO_TOKEN on the API host and restart the service to enable silent login bookmarks.',
                    })
                  : t('debugConfig.hrDemoSilentHashOnly', {
                      defaultValue:
                        'Only AUTH_HR_DEMO_TOKEN_HASH is configured — the plaintext token cannot be revealed from the admin UI. Rotate via env if you need a new shareable link.',
                    })}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {temporaryPasswordBanner !== null && (
        <div
          data-testid="temp-password-panel"
          className="sticky top-16 z-30 rounded-md border border-amber-200 bg-amber-50 p-4 shadow-sm"
        >
          <div className="mb-2 text-sm font-medium text-amber-800">
            {t('debugConfig.adminUsersTempPasswordTitle', { defaultValue: 'Temporary password' })}
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <code className="rounded bg-white px-2 py-1 font-mono text-sm break-all">
              {temporaryPasswordBanner}
            </code>
            <Button
              variant="outline"
              size="sm"
              data-testid="copy-temp-password"
              onClick={() => {
                void navigator.clipboard.writeText(temporaryPasswordBanner)
                toast.success(t('debugConfig.adminUsersTempPasswordCopied', {
                  defaultValue: 'Password copied to clipboard',
                }))
              }}
            >
              <Copy className="mr-1 h-3 w-3" />
              {t('debugConfig.adminUsersTempPasswordCopy', { defaultValue: 'Copy password' })}
            </Button>
          </div>
          <p className="text-xs text-amber-700">
            {t('debugConfig.adminUsersTempPasswordWarning', {
              defaultValue: 'Copy this now. It will not be shown again after you close this dialog.',
            })}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            data-testid="close-temp-password"
            onClick={() => {
              setTemporaryPasswordBanner(null)
            }}
          >
            Dismiss
          </Button>
        </div>
      )}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>{t('debugConfig.authAccessPolicyTitle', { defaultValue: 'Workspace access policy' })}</CardTitle>
            <CardDescription>
              {t('debugConfig.authAccessPolicyDescription', {
                defaultValue: 'Review the effective role and permission defaults for this workspace.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0">
            <ResponsiveTable
              headers={['Principal', 'Role', 'Search', 'Operational HR data', 'Writes']}
              emptyLabel="No policy rows"
              isEmpty={false}
              minWidthClassName="min-w-[640px]"
              stacked={policyRows.map((row) => (
                <StackedRecord
                  key={row.principal}
                  title={row.principal}
                  fields={[
                    { label: 'Role', value: row.role },
                    { label: 'Search', value: row.search },
                    { label: 'Operational HR data', value: row.operational },
                    { label: 'Writes', value: row.writes },
                  ]}
                />
              ))}
            >
              {policyRows.map((row) => (
                <tr key={row.principal} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{row.principal}</td>
                  <td className="px-3 py-2">{row.role}</td>
                  <td className="px-3 py-2">{row.search}</td>
                  <td className="px-3 py-2">{row.operational}</td>
                  <td className="px-3 py-2">{row.writes}</td>
                </tr>
              ))}
            </ResponsiveTable>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>{t('debugConfig.authAccessCurrentRoleTitle', { defaultValue: 'Current user role' })}</CardTitle>
            <CardDescription>
              {t('debugConfig.authAccessCurrentRoleDescription', {
                defaultValue: 'Effective workspace role from the active session.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">{currentUserLabel}</div>
              {auth.user?.email && auth.user.email !== currentUserLabel && (
                <div className="break-all text-sm text-muted-foreground">{auth.user.email}</div>
              )}
              <div className="pt-2">
                <Pill active={auth.workspaceRole !== null}>{currentRoleLabel}</Pill>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <UsersPanel
        operatorId={auth.user?.id ?? null}
        onTemporaryPassword={setTemporaryPasswordBanner}
      />

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{t('debugConfig.authAccessGrantTitle', { defaultValue: 'Grant provider access' })}</CardTitle>
          <CardDescription>
            {t('debugConfig.authAccessGrantDescription', {
              defaultValue: 'Preapprove a Casdoor provider subject for the current workspace.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="auth-provider-subject">Provider subject</label>
              <Input
                id="auth-provider-subject"
                data-testid="auth-provider-subject-input"
                value={form.providerSubject}
                onChange={(event) => setForm((current) => ({ ...current, providerSubject: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="auth-provider-tenant">Tenant</label>
              <Input
                id="auth-provider-tenant"
                data-testid="auth-provider-tenant-input"
                value={form.providerTenant}
                onChange={(event) => setForm((current) => ({ ...current, providerTenant: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="auth-workspace">Workspace</label>
              <Input
                id="auth-workspace"
                data-testid="auth-workspace-input"
                value={form.workspaceSlug}
                onChange={(event) => setForm((current) => ({ ...current, workspaceSlug: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="auth-role">Role</label>
              <select
                id="auth-role"
                data-testid="auth-role-select"
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.role}
                onChange={(event) => setForm((current) => ({ ...current, role: event.target.value === 'admin' ? 'admin' : 'user' }))}
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div className="flex items-end sm:col-span-2 xl:col-span-1">
              <Button
                data-testid="auth-preapprove-submit"
                disabled={submitting}
                onClick={() => { void handlePreapprove() }}
                className="w-full"
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                Grant
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>{t('debugConfig.authAccessIdentities', { defaultValue: 'Provider identities' })}</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0">
            <ResponsiveTable
              headers={['User', 'Provider', 'Subject', 'Tenant']}
              emptyLabel="No provider identities"
              isEmpty={providerIdentities.length === 0}
              minWidthClassName="min-w-[560px]"
              stacked={providerIdentities.map((identity) => (
                <StackedRecord
                  key={`${identity.provider}:${identity.providerTenant}:${identity.providerSubject}`}
                  title={identity.displayName ?? identity.userId}
                  fields={[
                    { label: 'Email', value: identity.email ?? '-' },
                    { label: 'Provider', value: identity.provider },
                    { label: 'Subject', value: <span className="break-all">{identity.providerSubject}</span> },
                    { label: 'Tenant', value: identity.providerTenant ?? '-' },
                  ]}
                />
              ))}
            >
              {providerIdentities.map((identity) => (
                <tr key={`${identity.provider}:${identity.providerTenant}:${identity.providerSubject}`} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-medium">{identity.displayName ?? identity.userId}</div>
                    {identity.email && <div className="text-xs text-muted-foreground">{identity.email}</div>}
                  </td>
                  <td className="px-3 py-2">{identity.provider}</td>
                  <td className="px-3 py-2 break-all">{identity.providerSubject}</td>
                  <td className="px-3 py-2">{identity.providerTenant ?? '-'}</td>
                </tr>
              ))}
            </ResponsiveTable>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>{t('debugConfig.authAccessPreapprovals', { defaultValue: 'Preapprovals' })}</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0">
            <ResponsiveTable
              headers={['Subject', 'Tenant', 'Workspace', 'Role', 'Status', '']}
              emptyLabel="No preapprovals"
              isEmpty={state.preapprovals.length === 0}
              minWidthClassName="min-w-[640px]"
              stacked={state.preapprovals.map((preapproval) => (
                <StackedRecord
                  key={`${preapproval.provider}:${preapproval.providerTenant}:${preapproval.providerSubject}:${preapproval.workspaceSlug}`}
                  title={<span className="break-all">{preapproval.providerSubject}</span>}
                  action={preapproval.active ? (
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`auth-revoke-${toActionId(preapproval.providerSubject)}-${toActionId(preapproval.workspaceSlug)}`}
                      disabled={submitting}
                      onClick={() => { void handleRevoke(preapproval) }}
                    >
                      <Ban className="mr-2 h-4 w-4" />
                      Revoke
                    </Button>
                  ) : undefined}
                  fields={[
                    { label: 'Tenant', value: preapproval.providerTenant },
                    { label: 'Workspace', value: preapproval.workspaceSlug },
                    { label: 'Role', value: preapproval.role },
                    { label: 'Status', value: <StatusPill active={preapproval.active} /> },
                  ]}
                />
              ))}
            >
              {state.preapprovals.map((preapproval) => (
                <tr key={`${preapproval.provider}:${preapproval.providerTenant}:${preapproval.providerSubject}:${preapproval.workspaceSlug}`} className="border-b last:border-0">
                  <td className="px-3 py-2 break-all">{preapproval.providerSubject}</td>
                  <td className="px-3 py-2">{preapproval.providerTenant}</td>
                  <td className="px-3 py-2">{preapproval.workspaceSlug}</td>
                  <td className="px-3 py-2">{preapproval.role}</td>
                  <td className="px-3 py-2"><StatusPill active={preapproval.active} /></td>
                  <td className="px-3 py-2 text-right">
                    {preapproval.active && (
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`auth-revoke-${toActionId(preapproval.providerSubject)}-${toActionId(preapproval.workspaceSlug)}`}
                        disabled={submitting}
                        onClick={() => { void handleRevoke(preapproval) }}
                      >
                        <Ban className="mr-2 h-4 w-4" />
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </ResponsiveTable>
          </CardContent>
        </Card>
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>{t('debugConfig.authAccessGrants', { defaultValue: 'Provider-derived grants' })}</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0">
            <ResponsiveTable
              headers={['Subject', 'User ID', 'Workspace', 'Role', 'Status']}
              emptyLabel="No provider-derived grants"
              isEmpty={state.grants.length === 0}
              minWidthClassName="min-w-[560px]"
              stacked={state.grants.map((grant) => (
                <StackedRecord
                  key={`${grant.provider}:${grant.providerTenant}:${grant.providerSubject}:${grant.workspaceSlug}:${grant.userId}`}
                  title={<span className="break-all">{grant.providerSubject}</span>}
                  fields={[
                    { label: 'User ID', value: <span className="break-all">{grant.userId}</span> },
                    { label: 'Workspace', value: grant.workspaceSlug },
                    { label: 'Role', value: grant.role },
                    { label: 'Status', value: <StatusPill active={grant.active} /> },
                  ]}
                />
              ))}
            >
              {state.grants.map((grant) => (
                <tr key={`${grant.provider}:${grant.providerTenant}:${grant.providerSubject}:${grant.workspaceSlug}:${grant.userId}`} className="border-b last:border-0">
                  <td className="px-3 py-2 break-all">{grant.providerSubject}</td>
                  <td className="px-3 py-2 break-all">{grant.userId}</td>
                  <td className="px-3 py-2">{grant.workspaceSlug}</td>
                  <td className="px-3 py-2">{grant.role}</td>
                  <td className="px-3 py-2"><StatusPill active={grant.active} /></td>
                </tr>
              ))}
            </ResponsiveTable>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>{t('debugConfig.authAccessEvents', { defaultValue: 'Recent auth events' })}</CardTitle>
              <CardDescription>{t('debugConfig.authAccessEventsDescription', { defaultValue: 'Latest events for the current workspace.' })}</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => { void load() }}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </CardHeader>
          <CardContent className="min-w-0">
            <ResponsiveTable
              headers={['Type', 'Provider', 'User', 'Created']}
              emptyLabel="No auth events"
              isEmpty={state.events.length === 0}
              minWidthClassName="min-w-[480px]"
              stacked={state.events.map((event) => (
                <StackedRecord
                  key={event.id}
                  title={event.type}
                  fields={[
                    { label: 'Provider', value: event.provider ?? '-' },
                    { label: 'User', value: <span className="break-all">{event.userId ?? '-'}</span> },
                    { label: 'Created', value: event.createdAt },
                  ]}
                />
              ))}
            >
              {state.events.map((event) => (
                <tr key={event.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{event.type}</td>
                  <td className="px-3 py-2">{event.provider ?? '-'}</td>
                  <td className="px-3 py-2 break-all">{event.userId ?? '-'}</td>
                  <td className="px-3 py-2">{event.createdAt}</td>
                </tr>
              ))}
            </ResponsiveTable>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
