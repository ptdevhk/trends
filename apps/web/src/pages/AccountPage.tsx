import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { changePassword } from '@/lib/auth'
import { Key } from 'lucide-react'

export function AccountPage() {
  const { t } = useTranslation()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [currentPasswordError, setCurrentPasswordError] = useState<string | null>(null)

  const mismatch = newPassword.length > 0 && confirmPassword.length > 0 && newPassword !== confirmPassword
  const tooShort = newPassword.length > 0 && newPassword.length < 6
  const canSubmit = currentPassword.length > 0 && newPassword.length >= 6 && newPassword === confirmPassword && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setCurrentPasswordError(null)
    setSubmitting(true)
    try {
      const result = await changePassword(currentPassword, newPassword)
      if (result.success) {
        toast.success(t('settings.account.passwordChanged', { defaultValue: 'Password changed successfully' }))
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        if (result.status === 403) {
          setCurrentPasswordError(t('settings.account.currentPasswordIncorrect', { defaultValue: 'Current password is incorrect' }))
        } else {
          toast.error(result.error)
        }
      }
    } catch {
      toast.error(t('settings.account.changeFailed', { defaultValue: 'Failed to change password' }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">
          {t('settings.account.title', { defaultValue: 'Account' })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('settings.account.description', { defaultValue: 'Manage your account settings and change your password.' })}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.account.changePassword', { defaultValue: 'Change password' })}</CardTitle>
          <CardDescription>
            {t('settings.account.changePasswordDescription', { defaultValue: 'Update your password. You will stay logged in after changing it.' })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => { void handleSubmit(e) }} className="space-y-4 max-w-sm">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="current-password">
                {t('settings.account.currentPassword', { defaultValue: 'Current password' })}
              </label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value)
                  setCurrentPasswordError(null)
                }}
                aria-invalid={currentPasswordError !== null}
              />
              {currentPasswordError && (
                <p className="text-sm text-destructive">{currentPasswordError}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="new-password">
                {t('settings.account.newPassword', { defaultValue: 'New password' })}
              </label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                aria-invalid={tooShort}
              />
              {tooShort && (
                <p className="text-sm text-destructive">
                  {t('settings.account.passwordTooShort', { defaultValue: 'Password must be at least 6 characters' })}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="confirm-password">
                {t('settings.account.confirmPassword', { defaultValue: 'Confirm new password' })}
              </label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                aria-invalid={mismatch}
              />
              {mismatch && (
                <p className="text-sm text-destructive">
                  {t('settings.account.passwordsDoNotMatch', { defaultValue: 'Passwords do not match' })}
                </p>
              )}
            </div>

            <Button type="submit" disabled={!canSubmit}>
              <Key className="mr-2 h-4 w-4" />
              {submitting
                ? t('settings.account.changing', { defaultValue: 'Changing...' })
                : t('settings.account.changePasswordButton', { defaultValue: 'Change password' })}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
