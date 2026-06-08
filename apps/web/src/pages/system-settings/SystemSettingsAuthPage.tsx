import { useCallback, useEffect, useState } from 'react'
import { Ban, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  fetchProviderMemberships,
  preapproveProviderMembership,
  revokeProviderMembership,
  type AuthProvider,
  type ProviderMembershipPreapproval,
  type ProviderMembershipsResponse,
  type WorkspaceRole,
} from '@/lib/auth'
import { reportUiError } from '@/lib/ui-error-reporting'
import { useWorkspace } from '@/contexts/WorkspaceContext'

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

function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
      {active ? 'Active' : 'Revoked'}
    </span>
  )
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

export function SystemSettingsAuthPage() {
  const { t } = useTranslation()
  const { slug } = useWorkspace()
  const [state, setState] = useState<ProviderMembershipsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<FormState>(() => createInitialForm(slug))
  const providerIdentities = state?.identities.filter((identity) => identity.provider === form.provider) ?? []

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await fetchProviderMemberships()
      setState(result)
      setAccessDenied(result === null)
    } catch (error) {
      reportUiError('Failed to load provider membership state', error)
      setState(null)
      setAccessDenied(true)
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
      if (!result) {
        toast.error(t('debugConfig.authAccessGrantFailed', { defaultValue: 'Failed to grant provider access' }))
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
      if (!result) {
        toast.error(t('debugConfig.authAccessRevokeFailed', { defaultValue: 'Failed to revoke provider access' }))
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
            {t('debugConfig.authAccessAdminRequired', { defaultValue: 'Admin access required' })}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
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

      <Card>
        <CardHeader>
          <CardTitle>{t('debugConfig.authAccessGrantTitle', { defaultValue: 'Grant provider access' })}</CardTitle>
          <CardDescription>
            {t('debugConfig.authAccessGrantDescription', {
              defaultValue: 'Preapprove a Casdoor provider subject for the current workspace.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-5">
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
            <div className="flex items-end">
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

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('debugConfig.authAccessIdentities', { defaultValue: 'Provider identities' })}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">Subject</th>
                  <th className="px-3 py-2">Tenant</th>
                </tr>
              </thead>
              <tbody>
                {providerIdentities.length === 0 ? (
                  <EmptyRow colSpan={4} label="No provider identities" />
                ) : providerIdentities.map((identity) => (
                  <tr key={`${identity.provider}:${identity.providerTenant}:${identity.providerSubject}`} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{identity.displayName ?? identity.userId}</div>
                      {identity.email && <div className="text-xs text-muted-foreground">{identity.email}</div>}
                    </td>
                    <td className="px-3 py-2">{identity.provider}</td>
                    <td className="px-3 py-2">{identity.providerSubject}</td>
                    <td className="px-3 py-2">{identity.providerTenant ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('debugConfig.authAccessPreapprovals', { defaultValue: 'Preapprovals' })}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Subject</th>
                  <th className="px-3 py-2">Tenant</th>
                  <th className="px-3 py-2">Workspace</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {state.preapprovals.length === 0 ? (
                  <EmptyRow colSpan={6} label="No preapprovals" />
                ) : state.preapprovals.map((preapproval) => (
                  <tr key={`${preapproval.provider}:${preapproval.providerTenant}:${preapproval.providerSubject}:${preapproval.workspaceSlug}`} className="border-b last:border-0">
                    <td className="px-3 py-2">{preapproval.providerSubject}</td>
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
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('debugConfig.authAccessGrants', { defaultValue: 'Provider-derived grants' })}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Subject</th>
                  <th className="px-3 py-2">User ID</th>
                  <th className="px-3 py-2">Workspace</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {state.grants.length === 0 ? (
                  <EmptyRow colSpan={5} label="No provider-derived grants" />
                ) : state.grants.map((grant) => (
                  <tr key={`${grant.provider}:${grant.providerTenant}:${grant.providerSubject}:${grant.workspaceSlug}:${grant.userId}`} className="border-b last:border-0">
                    <td className="px-3 py-2">{grant.providerSubject}</td>
                    <td className="px-3 py-2">{grant.userId}</td>
                    <td className="px-3 py-2">{grant.workspaceSlug}</td>
                    <td className="px-3 py-2">{grant.role}</td>
                    <td className="px-3 py-2"><StatusPill active={grant.active} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>{t('debugConfig.authAccessEvents', { defaultValue: 'Recent auth events' })}</CardTitle>
              <CardDescription>{t('debugConfig.authAccessEventsDescription', { defaultValue: 'Latest events for the current workspace.' })}</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => { void load() }}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {state.events.length === 0 ? (
                  <EmptyRow colSpan={4} label="No auth events" />
                ) : state.events.map((event) => (
                  <tr key={event.id} className="border-b last:border-0">
                    <td className="px-3 py-2">{event.type}</td>
                    <td className="px-3 py-2">{event.provider ?? '-'}</td>
                    <td className="px-3 py-2">{event.userId ?? '-'}</td>
                    <td className="px-3 py-2">{event.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
