import { useState } from 'react'
import { Copy, Key } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { createAdminUser } from '@/lib/admin-users'
import type { WorkspaceSlug } from '@trends/shared'
import { WORKSPACE_TEAMS } from '@trends/shared'
import type { WorkspaceRole } from '@/lib/auth'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (temporaryPassword: string) => void
}

export function CreateUserDialog({ open, onOpenChange, onCreated }: Props) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [workspaceSlug, setWorkspaceSlug] = useState<WorkspaceSlug | ''>('')
  const [role, setRole] = useState<WorkspaceRole>('user')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [createdUsername, setCreatedUsername] = useState<string | null>(null)

  const workspaceOptions = Object.keys(WORKSPACE_TEAMS) as WorkspaceSlug[]

  function resetForm() {
    setUsername('')
    setEmail('')
    setDisplayName('')
    setWorkspaceSlug('')
    setRole('user')
    setError(null)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetForm()
      setTempPassword(null)
      setCreatedUsername(null)
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit() {
    if (!username.trim()) {
      setError(t('debugConfig.adminUsersUsernameRequired', { defaultValue: 'Username is required' }))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const result = await createAdminUser({
        username: username.trim(),
        email: email.trim() || undefined,
        displayName: displayName.trim() || undefined,
        initialMembership:
          workspaceSlug !== ''
            ? { workspaceSlug, role }
            : undefined,
      })
      if (result.success === false) {
        setError(result.error)
        return
      }
      setTempPassword(result.temporaryPassword)
      setCreatedUsername(result.user.displayName ?? username.trim())
      toast.success(t('debugConfig.adminUsersCreated', { defaultValue: 'User created' }))
      onCreated(result.temporaryPassword)
    } catch (err) {
      console.error(err)
      setError(t('debugConfig.adminUsersCreateFailed', { defaultValue: 'Failed to create user' }))
    } finally {
      setSubmitting(false)
    }
  }

  if (tempPassword !== null && createdUsername !== null) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent data-testid="temp-password-dialog">
          <DialogHeader>
            <DialogTitle>
              {t('debugConfig.adminUsersTempPasswordTitle', { defaultValue: 'Temporary password' })}
            </DialogTitle>
            <DialogDescription>
              {t('debugConfig.adminUsersTempPasswordFor', {
                defaultValue: 'Password for {{username}}',
              }).replace('{{username}}', createdUsername)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <code className="block w-full rounded bg-muted px-3 py-2 font-mono text-sm break-all">
              {tempPassword}
            </code>
            <Button
              variant="outline"
              className="w-full"
              data-testid="copy-temp-password"
              onClick={() => {
                void navigator.clipboard.writeText(tempPassword)
                toast.success(
                  t('debugConfig.adminUsersTempPasswordCopied', {
                    defaultValue: 'Password copied to clipboard',
                  }),
                )
              }}
            >
              <Copy className="mr-2 h-4 w-4" />
              {t('debugConfig.adminUsersTempPasswordCopy', { defaultValue: 'Copy password' })}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t('debugConfig.adminUsersTempPasswordWarning', {
                defaultValue: 'Copy this now. It will not be shown again after you close this dialog.',
              })}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              data-testid="close-temp-password"
              onClick={() => {
                handleOpenChange(false)
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="create-user-dialog">
        <DialogHeader>
          <DialogTitle>
            {t('debugConfig.adminUsersNew', { defaultValue: '+ New user' })}
          </DialogTitle>
          <DialogDescription>
            {t('debugConfig.adminUsersCreateDescription', {
              defaultValue: 'Create a new local user account.',
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="create-username">
              Username
            </label>
            <Input
              id="create-username"
              data-testid="create-user-username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                setError(null)
              }}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="create-email">
              Email (optional)
            </label>
            <Input
              id="create-email"
              data-testid="create-user-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
              }}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="create-display-name">
              Display name (optional)
            </label>
            <Input
              id="create-display-name"
              data-testid="create-user-display-name"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value)
              }}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="create-workspace">
                Initial workspace (optional)
              </label>
              <select
                id="create-workspace"
                data-testid="create-user-workspace"
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={workspaceSlug}
                onChange={(e) => {
                  setWorkspaceSlug(e.target.value as WorkspaceSlug | '')
                }}
              >
                <option value="">None</option>
                {workspaceOptions.map((slug) => (
                  <option key={slug} value={slug}>
                    {WORKSPACE_TEAMS[slug].name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="create-role">
                Role
              </label>
              <select
                id="create-role"
                data-testid="create-user-role"
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={role}
                disabled={workspaceSlug === ''}
                onChange={(e) => {
                  setRole(e.target.value === 'admin' ? 'admin' : 'user')
                }}
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>
          </div>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              handleOpenChange(false)
            }}
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            data-testid="create-user-submit"
            disabled={submitting}
            onClick={() => {
              void handleSubmit()
            }}
          >
            <Key className="mr-2 h-4 w-4" />
            {submitting
              ? t('common.saving', { defaultValue: 'Saving...' })
              : t('debugConfig.adminUsersCreate', { defaultValue: 'Create user' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
