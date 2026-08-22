import { useCallback, useEffect, useState } from 'react'
import { Ban, Key, Lock, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { reportUiError } from '@/lib/ui-error-reporting'
import {
  listAdminUsers,
  disableAdminUser,
  enableAdminUser,
  resetAdminUserPassword,
  unlockAdminUser,
  type AdminUserRecord,
  type AdminUsersError,
} from '@/lib/admin-users'
import { CreateUserDialog } from './CreateUserDialog'
import { MembershipsDrawer } from './MembershipsDrawer'
import { UserAuditDrawer } from './UserAuditDrawer'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Props = {
  operatorId: string | null
  /** Surface one-time passwords at the top of the auth settings page. */
  onTemporaryPassword?: (temporaryPassword: string | null) => void
}

type LoadOptions = {
  showLoading?: boolean
}

function formatApiError(error: AdminUsersError): string {
  return error.status === undefined ? error.error : `${error.error} (${error.status})`
}

export function UsersPanel({ operatorId, onTemporaryPassword }: Props) {
  const { t, i18n } = useTranslation()
  const [users, setUsers] = useState<AdminUserRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [accessError, setAccessError] = useState<AdminUsersError | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [membershipsUser, setMembershipsUser] = useState<AdminUserRecord | null>(null)
  const [auditUser, setAuditUser] = useState<AdminUserRecord | null>(null)
  const [pendingAction, setPendingAction] = useState<{
    type: 'resetPassword' | 'unlock'
    username: string
  } | null>(null)

  function publishTemporaryPassword(temporaryPassword: string | null) {
    onTemporaryPassword?.(temporaryPassword)
  }

  const load = useCallback(async (options: LoadOptions = {}) => {
    const showLoading = options.showLoading ?? true
    if (showLoading) {
      setLoading(true)
    }
    try {
      const result = await listAdminUsers()
      if (result.success === false) {
        setUsers([])
        setAccessError(result)
        setAccessDenied(true)
        return
      }
      setUsers(result.users)
      setAccessError(null)
      setAccessDenied(false)
    } catch (error) {
      reportUiError('Failed to load admin users', error)
      setUsers([])
      setAccessError(null)
      setAccessDenied(true)
    } finally {
      if (showLoading) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleDisable(id: string) {
    const result = await disableAdminUser(id)
    if (result.success === false) {
      toast.error(result.error)
      return
    }
    toast.success(t('debugConfig.adminUsersDisabled', { defaultValue: 'User disabled' }))
    setUsers((prev) =>
      prev.map((u) => (u.id === id ? { ...u, status: 'disabled' as const } : u)),
    )
  }

  async function handleEnable(id: string) {
    const result = await enableAdminUser(id)
    if (result.success === false) {
      toast.error(result.error)
      return
    }
    toast.success(t('debugConfig.adminUsersEnabled', { defaultValue: 'User enabled' }))
    setUsers((prev) =>
      prev.map((u) => (u.id === id ? { ...u, status: 'active' as const } : u)),
    )
  }

  function requestResetPassword(username: string) {
    setPendingAction({ type: 'resetPassword', username })
  }

  function requestUnlock(username: string) {
    setPendingAction({ type: 'unlock', username })
  }

  async function confirmPendingAction() {
    if (!pendingAction) return
    const { type, username } = pendingAction
    setPendingAction(null)
    if (type === 'resetPassword') {
      const result = await resetAdminUserPassword(username)
      if (result.success === false) {
        toast.error(result.error)
        return
      }
      publishTemporaryPassword(result.temporaryPassword)
    } else {
      const result = await unlockAdminUser(username)
      if (result.success === false) {
        toast.error(result.error)
        return
      }
      toast.success(t('debugConfig.adminUsersUnlocked', { defaultValue: 'User unlocked' }))
      // No user-list change needed; unlock clears lockout state server-side.
    }
  }

  function getLocalUsername(user: AdminUserRecord): string {
    const localIdentity = user.identities.find((i) => i.provider === 'local')
    return localIdentity?.providerSubject ?? user.displayName ?? user.id
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          {t('debugConfig.adminUsersLoading', { defaultValue: 'Loading users...' })}
        </CardContent>
      </Card>
    )
  }

  if (accessDenied) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="py-6 text-sm text-destructive">
          {accessError
            ? formatApiError(accessError)
            : t('debugConfig.authAccessAdminRequired', { defaultValue: 'Admin access required' })}
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>
              {t('debugConfig.adminUsersTitle', { defaultValue: 'Users' })}
            </CardTitle>
            <CardDescription>
              {t('debugConfig.adminUsersDescription', {
                defaultValue: 'Manage local user accounts, memberships, and authentication state.',
              })}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="refresh-users"
              disabled={loading}
              onClick={() => {
                void load()
              }}
            >
              <RefreshCw className="mr-1 h-3 w-3" />
              {t('common.refresh', { defaultValue: 'Refresh' })}
            </Button>
            <Button
              size="sm"
              data-testid="create-user-button"
              onClick={() => {
                publishTemporaryPassword(null)
                setCreateDialogOpen(true)
              }}
            >
              <Users className="mr-2 h-4 w-4" />
              {t('debugConfig.adminUsersNew', { defaultValue: '+ New user' })}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="hidden lg:block overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{t('debugConfig.adminUsersColUser', { defaultValue: 'User' })}</th>
                <th className="px-3 py-2">{t('debugConfig.adminUsersColStatus', { defaultValue: 'Status' })}</th>
                <th className="px-3 py-2">{t('debugConfig.adminUsersColWorkspaces', { defaultValue: 'Workspaces' })}</th>
                <th className="px-3 py-2">{t('debugConfig.adminUsersColCreated', { defaultValue: 'Created' })}</th>
                <th className="px-3 py-2 text-right">{t('debugConfig.adminUsersColActions', { defaultValue: 'Actions' })}</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {t('debugConfig.adminUsersEmpty', { defaultValue: 'No users found.' })}
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isSelf = u.id === operatorId
                  return (
                    <tr key={u.id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <div className="font-medium">
                          {u.displayName ?? getLocalUsername(u)}
                          {isSelf && (
                            <Badge variant="outline" className="ml-2 text-xs">
                              {t('debugConfig.adminUsersYou', { defaultValue: 'You' })}
                            </Badge>
                          )}
                        </div>
                        {u.email && (
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={u.status === 'active' ? 'default' : 'destructive'}>
                          {u.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {u.memberships.length === 0 ? (
                            <span className="text-xs text-muted-foreground">{t('debugConfig.adminUsersNone', { defaultValue: 'None' })}</span>
                          ) : (
                            u.memberships.map((m) => (
                              <Badge key={m.workspaceSlug} variant="secondary" className="text-xs">
                                {m.workspaceSlug}/{m.role}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {new Date(u.createdAt).toLocaleDateString(i18n.language)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {u.status === 'active' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              data-testid={`admin-disable-${u.id}`}
                              onClick={() => {
                                void handleDisable(u.id)
                              }}
                            >
                              <Ban className="mr-1 h-3 w-3" />
                              {t('debugConfig.adminUsersDisable', { defaultValue: 'Disable' })}
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              data-testid={`admin-enable-${u.id}`}
                              onClick={() => {
                                void handleEnable(u.id)
                              }}
                            >
                              <RefreshCw className="mr-1 h-3 w-3" />
                              {t('debugConfig.adminUsersEnable', { defaultValue: 'Re-enable' })}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid={`admin-reset-pw-${u.id}`}
                            onClick={() => {
                              requestResetPassword(getLocalUsername(u))
                            }}
                          >
                            <Key className="mr-1 h-3 w-3" />
                            {t('debugConfig.adminUsersResetPassword', { defaultValue: 'Reset password' })}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid={`admin-unlock-${u.id}`}
                            onClick={() => {
                              requestUnlock(getLocalUsername(u))
                            }}
                          >
                            <Lock className="mr-1 h-3 w-3" />
                            {t('debugConfig.adminUsersUnlock', { defaultValue: 'Unlock' })}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid={`admin-view-audit-${u.id}`}
                            onClick={() => {
                              setAuditUser(u)
                            }}
                          >
                            <ShieldCheck className="mr-1 h-3 w-3" />
                            {t('debugConfig.adminUsersViewAudit', { defaultValue: 'View audit' })}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid={`admin-edit-memberships-${u.id}`}
                            onClick={() => {
                              setMembershipsUser(u)
                            }}
                          >
                            {t('debugConfig.adminUsersEditMemberships', { defaultValue: 'Edit memberships' })}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
          </div>

          <div className="space-y-3 lg:hidden" data-testid="admin-users-stacked">
            {users.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {t('debugConfig.adminUsersEmpty', { defaultValue: 'No users found.' })}
              </p>
            ) : (
              users.map((u) => {
                const isSelf = u.id === operatorId
                return (
                  <div key={`stacked-${u.id}`} className="space-y-3 rounded-md border p-3">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {u.displayName ?? getLocalUsername(u)}
                        {isSelf && (
                          <Badge variant="outline" className="ml-2 text-xs">
                            {t('debugConfig.adminUsersYou', { defaultValue: 'You' })}
                          </Badge>
                        )}
                      </div>
                      {u.email && (
                        <div className="break-all text-xs text-muted-foreground">{u.email}</div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={u.status === 'active' ? 'default' : 'destructive'}>
                        {u.status}
                      </Badge>
                      {u.memberships.length === 0 ? (
                        <span className="text-xs text-muted-foreground">{t('debugConfig.adminUsersNone', { defaultValue: 'None' })}</span>
                      ) : (
                        u.memberships.map((m) => (
                          <Badge key={m.workspaceSlug} variant="secondary" className="text-xs">
                            {m.workspaceSlug}/{m.role}
                          </Badge>
                        ))
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString(i18n.language)}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {u.status === 'active' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid={`admin-disable-${u.id}`}
                          onClick={() => {
                            void handleDisable(u.id)
                          }}
                        >
                          <Ban className="mr-1 h-3 w-3" />
                          {t('debugConfig.adminUsersDisable', { defaultValue: 'Disable' })}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid={`admin-enable-${u.id}`}
                          onClick={() => {
                            void handleEnable(u.id)
                          }}
                        >
                          <RefreshCw className="mr-1 h-3 w-3" />
                          {t('debugConfig.adminUsersEnable', { defaultValue: 'Re-enable' })}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`admin-reset-pw-${u.id}`}
                        onClick={() => {
                          requestResetPassword(getLocalUsername(u))
                        }}
                      >
                        <Key className="mr-1 h-3 w-3" />
                        {t('debugConfig.adminUsersResetPassword', { defaultValue: 'Reset password' })}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`admin-unlock-${u.id}`}
                        onClick={() => {
                          requestUnlock(getLocalUsername(u))
                        }}
                      >
                        <Lock className="mr-1 h-3 w-3" />
                        {t('debugConfig.adminUsersUnlock', { defaultValue: 'Unlock' })}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`admin-view-audit-${u.id}`}
                        onClick={() => {
                          setAuditUser(u)
                        }}
                      >
                        <ShieldCheck className="mr-1 h-3 w-3" />
                        {t('debugConfig.adminUsersViewAudit', { defaultValue: 'View audit' })}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`admin-edit-memberships-${u.id}`}
                        onClick={() => {
                          setMembershipsUser(u)
                        }}
                      >
                        {t('debugConfig.adminUsersEditMemberships', { defaultValue: 'Edit memberships' })}
                      </Button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </CardContent>
      </Card>

      <CreateUserDialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open)
        }}
        onCreated={() => {
          // Create flow shows the password inside CreateUserDialog; page banner is for reset.
          void load({ showLoading: false })
        }}
      />

      <MembershipsDrawer
        open={membershipsUser !== null}
        onOpenChange={(open) => {
          if (!open) setMembershipsUser(null)
        }}
        user={membershipsUser}
        onChanged={() => {
          void load()
        }}
      />

      <UserAuditDrawer
        open={auditUser !== null}
        onOpenChange={(open) => {
          if (!open) setAuditUser(null)
        }}
        user={auditUser}
      />

      <Dialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null)
        }}
      >
        <DialogContent data-testid="admin-user-confirm-dialog">
          <DialogHeader>
            <DialogTitle>
              {pendingAction?.type === 'resetPassword'
                ? t('debugConfig.adminUsersResetPasswordTitle', {
                    defaultValue: 'Reset User Password',
                  })
                : t('debugConfig.adminUsersUnlockTitle', {
                    defaultValue: 'Unlock User Account',
                  })}
            </DialogTitle>
            <DialogDescription>
              {pendingAction?.type === 'resetPassword'
                ? t('debugConfig.adminUsersResetPasswordConfirm', {
                    defaultValue: 'Reset the password for this user?',
                  })
                : t('debugConfig.adminUsersUnlockConfirm', {
                    defaultValue: 'Unlock this user account?',
                  })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              data-testid="admin-user-confirm-cancel"
              onClick={() => {
                setPendingAction(null)
              }}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant={pendingAction?.type === 'resetPassword' ? 'destructive' : 'default'}
              data-testid="admin-user-confirm-button"
              onClick={() => {
                void confirmPendingAction()
              }}
            >
              {pendingAction?.type === 'resetPassword'
                ? t('debugConfig.adminUsersResetPassword', { defaultValue: 'Reset password' })
                : t('debugConfig.adminUsersUnlock', { defaultValue: 'Unlock' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
