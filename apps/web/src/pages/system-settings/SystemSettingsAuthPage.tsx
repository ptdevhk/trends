import { useCallback, useEffect, useState } from 'react'
import { Ban, RefreshCw, ShieldCheck } from 'lucide-react'
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
  type HrDemoSilentLoginInfo,
  type ProviderMembershipApiError,
  type ProviderMembershipPreapproval,
  type ProviderMembershipsResponse,
} from '@/lib/auth'
import { formatAuthUserLabel } from '@/lib/auth-user-label'
import { reportUiError } from '@/lib/ui-error-reporting'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { UsersPanel } from './admin-users/UsersPanel'
import {
  createInitialForm,
  formatProviderMembershipError,
  toActionId,
  type FormState,
} from './auth-access-model'
import { Pill, ResponsiveTable, StackedRecord, StatusPill } from './AuthAccessTables'
import { HrDemoSilentLoginPanel } from './HrDemoSilentLoginPanel'
import { TemporaryPasswordBanner } from './TemporaryPasswordBanner'

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
    ? t('debugConfig.authRoleWorkspaceAdmin', { defaultValue: 'Workspace admin' })
    : auth.workspaceRole === 'user'
      ? t('debugConfig.authRoleWorkspaceUser', { defaultValue: 'Workspace user' })
      : t('debugConfig.authRoleNone', { defaultValue: 'No workspace role' })
  const currentUserLabel = auth.user ? formatAuthUserLabel(auth.user) : t('debugConfig.authSignedOut', { defaultValue: 'Signed out' })

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
    return <div className="py-6 text-sm text-muted-foreground">{t('debugConfig.loading', { defaultValue: 'Loading...' })}</div>
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
      principal: t('debugConfig.authPolicyPrincipalAnonymous', { defaultValue: 'Everyone / anonymous' }),
      role: 'public-search',
      search: anonymousResumeSearchEnabled ? <Pill>resume:search</Pill> : <Pill active={false}>{t('debugConfig.authPolicyNotGranted', { defaultValue: 'not granted' })}</Pill>,
      operational: <span className="text-muted-foreground">{t('debugConfig.authPolicyLoginRequired', { defaultValue: 'login required' })}</span>,
      writes: <span className="text-muted-foreground">{t('debugConfig.authPolicyLoginRequired', { defaultValue: 'login required' })}</span>,
    },
    {
      principal: t('debugConfig.authPolicyPrincipalUsers', { defaultValue: 'Workspace users' }),
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
      principal: t('debugConfig.authPolicyPrincipalAdmins', { defaultValue: 'Workspace admins' }),
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
        <HrDemoSilentLoginPanel info={hrDemoSilent} />
      ) : null}

      {temporaryPasswordBanner !== null && (
        <TemporaryPasswordBanner
          password={temporaryPasswordBanner}
          onDismiss={() => setTemporaryPasswordBanner(null)}
        />
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
              headers={[
                t('debugConfig.authPolicyColumnPrincipal', { defaultValue: 'Principal' }),
                t('debugConfig.authPolicyColumnRole', { defaultValue: 'Role' }),
                t('debugConfig.authPolicyColumnSearch', { defaultValue: 'Search' }),
                t('debugConfig.authPolicyColumnOperational', { defaultValue: 'Operational HR data' }),
                t('debugConfig.authPolicyColumnWrites', { defaultValue: 'Writes' }),
              ]}
              emptyLabel={t('debugConfig.authPolicyEmpty', { defaultValue: 'No policy rows' })}
              isEmpty={false}
              minWidthClassName="min-w-[640px]"
              stacked={policyRows.map((row) => (
                <StackedRecord
                  key={row.principal}
                  title={row.principal}
                  fields={[
                    { label: t('debugConfig.authPolicyColumnRole', { defaultValue: 'Role' }), value: row.role },
                    { label: t('debugConfig.authPolicyColumnSearch', { defaultValue: 'Search' }), value: row.search },
                    { label: t('debugConfig.authPolicyColumnOperational', { defaultValue: 'Operational HR data' }), value: row.operational },
                    { label: t('debugConfig.authPolicyColumnWrites', { defaultValue: 'Writes' }), value: row.writes },
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
              <label className="text-sm font-medium" htmlFor="auth-provider-subject">{t('debugConfig.authPolicyProviderSubject', { defaultValue: 'Provider subject' })}</label>
              <Input
                id="auth-provider-subject"
                data-testid="auth-provider-subject-input"
                value={form.providerSubject}
                onChange={(event) => setForm((current) => ({ ...current, providerSubject: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="auth-provider-tenant">{t('debugConfig.authPolicyTenant', { defaultValue: 'Tenant' })}</label>
              <Input
                id="auth-provider-tenant"
                data-testid="auth-provider-tenant-input"
                value={form.providerTenant}
                onChange={(event) => setForm((current) => ({ ...current, providerTenant: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="auth-workspace">{t('debugConfig.authPolicyWorkspace', { defaultValue: 'Workspace' })}</label>
              <Input
                id="auth-workspace"
                data-testid="auth-workspace-input"
                value={form.workspaceSlug}
                onChange={(event) => setForm((current) => ({ ...current, workspaceSlug: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="auth-role">{t('debugConfig.authPolicyColumnRole', { defaultValue: 'Role' })}</label>
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
                {t('debugConfig.authPolicyGrant', { defaultValue: 'Grant' })}
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
              headers={[
                t('debugConfig.authColumnUser', { defaultValue: 'User' }),
                t('debugConfig.authColumnProvider', { defaultValue: 'Provider' }),
                t('debugConfig.authColumnSubject', { defaultValue: 'Subject' }),
                t('debugConfig.authPolicyTenant', { defaultValue: 'Tenant' }),
              ]}
              emptyLabel={t('debugConfig.authEmptyIdentities', { defaultValue: 'No provider identities' })}
              isEmpty={providerIdentities.length === 0}
              minWidthClassName="min-w-[560px]"
              stacked={providerIdentities.map((identity) => (
                <StackedRecord
                  key={`${identity.provider}:${identity.providerTenant}:${identity.providerSubject}`}
                  title={identity.displayName ?? identity.userId}
                  fields={[
                    { label: t('debugConfig.authColumnEmail', { defaultValue: 'Email' }), value: identity.email ?? '-' },
                    { label: t('debugConfig.authColumnProvider', { defaultValue: 'Provider' }), value: identity.provider },
                    { label: t('debugConfig.authColumnSubject', { defaultValue: 'Subject' }), value: <span className="break-all">{identity.providerSubject}</span> },
                    { label: t('debugConfig.authPolicyTenant', { defaultValue: 'Tenant' }), value: identity.providerTenant ?? '-' },
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
              headers={[
                t('debugConfig.authColumnSubject', { defaultValue: 'Subject' }),
                t('debugConfig.authPolicyTenant', { defaultValue: 'Tenant' }),
                t('debugConfig.authPolicyWorkspace', { defaultValue: 'Workspace' }),
                t('debugConfig.authPolicyColumnRole', { defaultValue: 'Role' }),
                t('debugConfig.authColumnStatus', { defaultValue: 'Status' }),
                '',
              ]}
              emptyLabel={t('debugConfig.authEmptyPreapprovals', { defaultValue: 'No preapprovals' })}
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
                      {t('debugConfig.authPolicyRevoke', { defaultValue: 'Revoke' })}
                    </Button>
                  ) : undefined}
                  fields={[
                    { label: t('debugConfig.authPolicyTenant', { defaultValue: 'Tenant' }), value: preapproval.providerTenant },
                    { label: t('debugConfig.authPolicyWorkspace', { defaultValue: 'Workspace' }), value: preapproval.workspaceSlug },
                    { label: t('debugConfig.authPolicyColumnRole', { defaultValue: 'Role' }), value: preapproval.role },
                    { label: t('debugConfig.authColumnStatus', { defaultValue: 'Status' }), value: <StatusPill active={preapproval.active} /> },
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
              headers={[
                t('debugConfig.authColumnSubject', { defaultValue: 'Subject' }),
                t('debugConfig.authColumnUserId', { defaultValue: 'User ID' }),
                t('debugConfig.authPolicyWorkspace', { defaultValue: 'Workspace' }),
                t('debugConfig.authPolicyColumnRole', { defaultValue: 'Role' }),
                t('debugConfig.authColumnStatus', { defaultValue: 'Status' }),
              ]}
              emptyLabel={t('debugConfig.authEmptyGrants', { defaultValue: 'No provider-derived grants' })}
              isEmpty={state.grants.length === 0}
              minWidthClassName="min-w-[560px]"
              stacked={state.grants.map((grant) => (
                <StackedRecord
                  key={`${grant.provider}:${grant.providerTenant}:${grant.providerSubject}:${grant.workspaceSlug}:${grant.userId}`}
                  title={<span className="break-all">{grant.providerSubject}</span>}
                  fields={[
                    { label: t('debugConfig.authColumnUserId', { defaultValue: 'User ID' }), value: <span className="break-all">{grant.userId}</span> },
                    { label: t('debugConfig.authPolicyWorkspace', { defaultValue: 'Workspace' }), value: grant.workspaceSlug },
                    { label: t('debugConfig.authPolicyColumnRole', { defaultValue: 'Role' }), value: grant.role },
                    { label: t('debugConfig.authColumnStatus', { defaultValue: 'Status' }), value: <StatusPill active={grant.active} /> },
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
              {t('debugConfig.authPolicyRefresh', { defaultValue: 'Refresh' })}
            </Button>
          </CardHeader>
          <CardContent className="min-w-0">
            <ResponsiveTable
              headers={[
                t('debugConfig.authColumnType', { defaultValue: 'Type' }),
                t('debugConfig.authColumnProvider', { defaultValue: 'Provider' }),
                t('debugConfig.authColumnUser', { defaultValue: 'User' }),
                t('debugConfig.authColumnCreated', { defaultValue: 'Created' }),
              ]}
              emptyLabel={t('debugConfig.authEmptyEvents', { defaultValue: 'No auth events' })}
              isEmpty={state.events.length === 0}
              minWidthClassName="min-w-[480px]"
              stacked={state.events.map((event) => (
                <StackedRecord
                  key={event.id}
                  title={event.type}
                  fields={[
                    { label: t('debugConfig.authColumnProvider', { defaultValue: 'Provider' }), value: event.provider ?? '-' },
                    { label: t('debugConfig.authColumnUser', { defaultValue: 'User' }), value: <span className="break-all">{event.userId ?? '-'}</span> },
                    { label: t('debugConfig.authColumnCreated', { defaultValue: 'Created' }), value: event.createdAt },
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
