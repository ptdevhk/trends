import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { HrDemoSilentLoginInfo } from '@/lib/auth'
import { Pill } from './AuthAccessTables'

export function HrDemoSilentLoginPanel({ info }: { info: HrDemoSilentLoginInfo }) {
  const { t } = useTranslation()
  return (
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
            <dd className="font-mono">{info.username}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</dt>
            <dd>
              {!info.configured ? (
                <Pill active={false}>not configured</Pill>
              ) : info.revealable ? (
                <Pill>configured · revealable</Pill>
              ) : (
                <Pill active={false}>configured · hash only</Pill>
              )}
            </dd>
          </div>
        </dl>

        {info.configured && info.tokenFingerprint ? (
          <p className="text-xs text-muted-foreground">
            Fingerprint: <code className="font-mono">{info.tokenFingerprint}</code>
          </p>
        ) : null}

        {info.revealable && info.token ? (
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
                  {info.token}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="copy-hr-demo-silent-token"
                  onClick={() => {
                    void navigator.clipboard.writeText(info.token ?? '')
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
            {info.samplePath ? (
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Sample HR path
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <code
                    data-testid="hr-demo-silent-sample-path"
                    className="rounded bg-white px-2 py-1 font-mono text-xs break-all border"
                  >
                    {info.samplePath}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="copy-hr-demo-silent-sample"
                    onClick={() => {
                      const absolute = `${window.location.origin}${info.samplePath}`
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
            {!info.configured
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
  )
}
