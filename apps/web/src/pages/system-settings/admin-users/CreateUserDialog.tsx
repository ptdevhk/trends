import { useMemo, useState } from 'react'
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
import { createAdminUser, type AdminAssignableRole } from '@/lib/admin-users'
import {
  getWorkspaceDisplayName,
  isReservedWorkspaceSlug,
  listSystemWorkspaceSlugs,
  slugifyUsernameForWorkspace,
  type SystemWorkspaceSlug,
} from '@trends/shared'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (temporaryPassword: string) => void
}

type SystemJoin = {
  workspaceSlug: SystemWorkspaceSlug
  role: AdminAssignableRole
  enabled: boolean
}

function createDefaultSystemJoins(): SystemJoin[] {
  return listSystemWorkspaceSlugs().map((workspaceSlug) => ({
    workspaceSlug,
    role: 'user',
    enabled: false,
  }))
}

export function CreateUserDialog({ open, onOpenChange, onCreated }: Props) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [showSystemTeams, setShowSystemTeams] = useState(false)
  const [systemJoins, setSystemJoins] = useState<SystemJoin[]>(() => createDefaultSystemJoins())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [createdUsername, setCreatedUsername] = useState<string | null>(null)

  const personalSlugPreview = useMemo(
    () => (username.trim() ? slugifyUsernameForWorkspace(username) : ''),
    [username],
  )

  function resetForm() {
    setUsername('')
    setEmail('')
    setDisplayName('')
    setShowSystemTeams(false)
    setSystemJoins(createDefaultSystemJoins())
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
    const trimmed = username.trim()
    if (!trimmed) {
      setError(t('debugConfig.adminUsersUsernameRequired', { defaultValue: 'Username is required' }))
      return
    }
    const personalSlug = slugifyUsernameForWorkspace(trimmed)
    if (!personalSlug || isReservedWorkspaceSlug(trimmed) || isReservedWorkspaceSlug(personalSlug)) {
      setError(t('debugConfig.adminUsersUsernameReserved', {
        defaultValue: 'Username is reserved or cannot form a personal workspace slug',
      }))
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const systemMemberships = showSystemTeams
        ? systemJoins
          .filter((join) => join.enabled)
          .map((join) => ({ workspaceSlug: join.workspaceSlug, role: join.role }))
        : []

      const result = await createAdminUser({
        username: trimmed,
        email: email.trim() || undefined,
        displayName: displayName.trim() || undefined,
        systemMemberships: systemMemberships.length > 0 ? systemMemberships : undefined,
      })
      if (result.success === false) {
        setError(result.error)
        return
      }
      setTempPassword(result.temporaryPassword)
      setCreatedUsername(result.user.displayName ?? trimmed)
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
              defaultValue: 'Create a local account with a personal workspace seat (member desk).',
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

          <div className="rounded-md border bg-muted/30 px-3 py-3 space-y-1" data-testid="create-user-personal-seat">
            <div className="text-sm font-medium">
              {t('debugConfig.adminUsersPersonalSeat', { defaultValue: 'Personal workspace' })}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('debugConfig.adminUsersPersonalSeatHelp', {
                defaultValue: 'Always created. Full member desk on a private seat; same shared resume pool. Role: user.',
              })}
            </p>
            <div className="text-sm font-mono" data-testid="create-user-personal-slug">
              {personalSlugPreview || '—'}
            </div>
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                data-testid="create-user-show-system-teams"
                checked={showSystemTeams}
                onChange={(e) => {
                  setShowSystemTeams(e.target.checked)
                }}
              />
              {t('debugConfig.adminUsersShowSystemTeams', { defaultValue: 'Show system teams' })}
            </label>
            {showSystemTeams ? (
              <div className="space-y-2 rounded-md border p-3" data-testid="create-user-system-teams">
                {systemJoins.map((join) => (
                  <div key={join.workspaceSlug} className="flex flex-wrap items-center gap-3 text-sm">
                    <label className="flex min-w-[8rem] items-center gap-2">
                      <input
                        type="checkbox"
                        data-testid={`create-user-system-${join.workspaceSlug}`}
                        checked={join.enabled}
                        onChange={(e) => {
                          const enabled = e.target.checked
                          setSystemJoins((current) =>
                            current.map((row) =>
                              row.workspaceSlug === join.workspaceSlug
                                ? { ...row, enabled }
                                : row,
                            ),
                          )
                        }}
                      />
                      {getWorkspaceDisplayName(join.workspaceSlug)}
                    </label>
                    <select
                      data-testid={`create-user-system-role-${join.workspaceSlug}`}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      value={join.role}
                      disabled={!join.enabled}
                      onChange={(e) => {
                        const role: AdminAssignableRole = e.target.value === 'admin' ? 'admin' : 'user'
                        setSystemJoins((current) =>
                          current.map((row) =>
                            row.workspaceSlug === join.workspaceSlug
                              ? { ...row, role }
                              : row,
                          ),
                        )
                      }}
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </div>
                ))}
              </div>
            ) : null}
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
