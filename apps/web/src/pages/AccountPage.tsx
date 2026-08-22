import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { changePassword } from '@/lib/auth'
import { Eye, EyeOff, Key } from 'lucide-react'

const MIN_PASSWORD_LENGTH = 8

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  showPassword,
  onToggleShow,
  ariaInvalid,
  error,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  showPassword: boolean
  onToggleShow: () => void
  ariaInvalid?: boolean
  error?: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={showPassword ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={ariaInvalid}
          className="pr-10"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
          aria-label={
            showPassword
              ? t('settings.account.hidePassword', { defaultValue: 'Hide password' })
              : t('settings.account.showPassword', { defaultValue: 'Show password' })
          }
          onClick={onToggleShow}
        >
          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
      {error}
    </div>
  )
}

export function AccountPage() {
  const { t } = useTranslation()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [currentPasswordError, setCurrentPasswordError] = useState<string | null>(null)

  const mismatch = newPassword.length > 0 && confirmPassword.length > 0 && newPassword !== confirmPassword
  const tooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH
  const canSubmit = currentPassword.length > 0 && newPassword.length >= MIN_PASSWORD_LENGTH && newPassword === confirmPassword && !submitting

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
            <PasswordField
              id="current-password"
              label={t('settings.account.currentPassword', { defaultValue: 'Current password' })}
              value={currentPassword}
              onChange={(value) => {
                setCurrentPassword(value)
                setCurrentPasswordError(null)
              }}
              autoComplete="current-password"
              showPassword={showCurrentPassword}
              onToggleShow={() => setShowCurrentPassword((v) => !v)}
              ariaInvalid={currentPasswordError !== null}
              error={currentPasswordError && <p className="text-sm text-destructive">{currentPasswordError}</p>}
            />

            <PasswordField
              id="new-password"
              label={t('settings.account.newPassword', { defaultValue: 'New password' })}
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              showPassword={showNewPassword}
              onToggleShow={() => setShowNewPassword((v) => !v)}
              ariaInvalid={tooShort}
              error={tooShort && (
                <p className="text-sm text-destructive">
                  {t('settings.account.passwordTooShort', { defaultValue: 'Password must be at least 8 characters' })}
                </p>
              )}
            />

            <PasswordField
              id="confirm-password"
              label={t('settings.account.confirmPassword', { defaultValue: 'Confirm new password' })}
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              showPassword={showConfirmPassword}
              onToggleShow={() => setShowConfirmPassword((v) => !v)}
              ariaInvalid={mismatch}
              error={mismatch && (
                <p className="text-sm text-destructive">
                  {t('settings.account.passwordsDoNotMatch', { defaultValue: 'Passwords do not match' })}
                </p>
              )}
            />

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
