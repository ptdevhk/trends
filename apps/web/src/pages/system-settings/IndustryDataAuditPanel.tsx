import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatTime, type AuditItem } from './industry-data-model'

export function IndustryDataAuditPanel({
  auditItems,
  auditCompanyKey,
  onAuditCompanyKeyChange,
  onFilter,
}: {
  auditItems: AuditItem[]
  auditCompanyKey: string
  onAuditCompanyKeyChange: (value: string) => void
  onFilter: () => void
}) {
  const { t } = useTranslation()
  return (
    <Card data-testid="industry-data-audit">
      <CardHeader>
        <CardTitle>
          {t('debugConfig.industryDataAuditTitle', {
            defaultValue: 'Audit timeline',
          })}
        </CardTitle>
        <CardDescription>
          {t('debugConfig.industryDataAuditDesc', {
            defaultValue: 'Data edits and maintenance ledger, newest first.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            data-testid="industry-data-audit-company-key"
            value={auditCompanyKey}
            onChange={(e) => onAuditCompanyKeyChange(e.target.value)}
            placeholder={t('debugConfig.industryDataFilterPlaceholder', { defaultValue: 'Filter companyKey' })}
          />
          <Button type="button" onClick={onFilter}>
            {t('debugConfig.industryDataFilter', { defaultValue: 'Filter' })}
          </Button>
        </div>
        <div className="space-y-2" data-testid="industry-data-audit-list">
          {auditItems.map((item, index) => (
            <div
              key={`${item.kind}-${item.at}-${index}`}
              className="rounded-md border p-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={item.kind === 'data_edit' ? 'default' : 'secondary'}>
                  {item.kind}
                </Badge>
                {item.action && <Badge variant="outline">{item.action}</Badge>}
                <span className="text-xs text-muted-foreground">{formatTime(item.at)}</span>
              </div>
              <p>{item.summary}</p>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                {item.companyKey && <span>companyKey={item.companyKey}</span>}
                {item.actor && <span>actor={item.actor}</span>}
                {item.runId && <span>runId={item.runId}</span>}
                {item.gitSha && <span className="font-mono">git={item.gitSha.slice(0, 7)}</span>}
              </div>
            </div>
          ))}
          {auditItems.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t('debugConfig.industryDataAuditEmpty', {
                defaultValue: 'No audit events',
              })}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
