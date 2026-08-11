import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getWorkspaceDisplayName, listSystemWorkspaceSlugs, type WorkspaceSlug } from '@trends/shared'
import type { AdminUserRecord, AdminAssignableRole } from '@/lib/admin-users'
import { addAdminUserMembership, removeAdminUserMembership } from '@/lib/admin-users'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: AdminUserRecord | null
  onChanged?: () => void
}

export function MembershipsDrawer({ open, onOpenChange, user, onChanged }: Props) {
  const { t } = useTranslation()
  const [addWorkspaceSlug, setAddWorkspaceSlug] = useState<WorkspaceSlug | ''>('')
  const [addRole, setAddRole] = useState<AdminAssignableRole>('user')
  const [submitting, setSubmitting] = useState(false)

  const workspaceOptions = listSystemWorkspaceSlugs()

  function handleClose() {
    setAddWorkspaceSlug('')
    setAddRole('user')
    setSubmitting(false)
    onOpenChange(false)
  }

  async function handleAdd() {
    if (!user || addWorkspaceSlug === '') return
    setSubmitting(true)
    try {
      const result = await addAdminUserMembership(user.id, {
        workspaceSlug: addWorkspaceSlug,
        role: addRole,
      })
      if (result.success === false) {
        toast.error(result.error)
        return
      }
      toast.success(
        t('debugConfig.adminUsersMembershipAdded', { defaultValue: 'Membership added' }),
      )
      onChanged?.()
      handleClose()
      // Trigger parent reload by re-opening with same user will not work;
      // instead the parent should reload users. Close and let UsersPanel re-fetch.
    } catch (err) {
      console.error(err)
      toast.error(t('debugConfig.adminUsersMembershipAddFailed', { defaultValue: 'Failed to add membership' }))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRemove(workspaceSlug: WorkspaceSlug) {
    if (!user) return
    setSubmitting(true)
    try {
      const result = await removeAdminUserMembership(user.id, workspaceSlug)
      if (result.success === false) {
        toast.error(result.error)
        return
      }
      toast.success(
        t('debugConfig.adminUsersMembershipRemoved', { defaultValue: 'Membership removed' }),
      )
      onChanged?.()
      handleClose()
    } catch (err) {
      console.error(err)
      toast.error(t('debugConfig.adminUsersMembershipRemoveFailed', { defaultValue: 'Failed to remove membership' }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) handleClose()
    }}>
      <DialogContent className="max-w-lg" data-testid="memberships-drawer">
        <DialogHeader>
          <DialogTitle>
            {t('debugConfig.adminUsersEditMemberships', { defaultValue: 'Edit memberships' })}
            {user && (
              <span className="ml-2 text-base font-normal text-muted-foreground">
                {user.displayName ?? user.email ?? user.id}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {t('debugConfig.adminUsersMembershipsDescription', {
              defaultValue: 'Add or remove workspace memberships for this user.',
            })}
          </DialogDescription>
        </DialogHeader>
        {user && (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Workspace</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {user.memberships.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-center text-sm text-muted-foreground">
                        {t('debugConfig.adminUsersNoMemberships', { defaultValue: 'No memberships.' })}
                      </td>
                    </tr>
                  ) : (
                    user.memberships.map((m) => (
                      <tr key={m.workspaceSlug} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium">{m.workspaceSlug}</td>
                        <td className="px-3 py-2">{m.role}</td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`remove-membership-${m.workspaceSlug}`}
                            disabled={submitting}
                            onClick={() => {
                              void handleRemove(m.workspaceSlug as WorkspaceSlug)
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-end gap-3 border-t pt-4">
              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="membership-workspace">
                  Workspace
                </label>
                <select
                  id="membership-workspace"
                  data-testid="membership-workspace-select"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={addWorkspaceSlug}
                  onChange={(e) => {
                    setAddWorkspaceSlug(e.target.value as WorkspaceSlug | '')
                  }}
                >
                  <option value="">Select...</option>
                  {workspaceOptions.map((slug) => (
                    <option key={slug} value={slug}>
                      {getWorkspaceDisplayName(slug)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="membership-role">
                  Role
                </label>
                <select
                  id="membership-role"
                  data-testid="membership-role-select"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={addRole}
                  onChange={(e) => {
                    setAddRole(e.target.value === 'admin' ? 'admin' : 'user')
                  }}
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <Button
                size="sm"
                data-testid="add-membership-submit"
                disabled={submitting || addWorkspaceSlug === ''}
                onClick={() => {
                  void handleAdd()
                }}
              >
                {t('debugConfig.adminUsersMembershipAdd', { defaultValue: 'Add' })}
              </Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t('common.close', { defaultValue: 'Close' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
