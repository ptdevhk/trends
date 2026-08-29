import { useTranslation } from 'react-i18next'
import { listActiveScoreCapRules, type ScoreCapRule } from '@trends/shared'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function ScoreCapRulesList({ rules }: { rules: ScoreCapRule[] }) {
  const { t } = useTranslation()

  return (
    <div className="space-y-6" data-testid="score-caps-page">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">
          {t('debugConfig.settingsNavScoreCaps', { defaultValue: 'Score caps' })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('debugConfig.scoreCapsPageDescription', {
            defaultValue: 'Every active score-cap rule in one place. The scoring formula and this list read the same registry.',
          })}
        </p>
      </div>

      <Card data-testid="score-caps-section">
        <CardHeader>
          <CardTitle className="text-base">
            {t('debugConfig.scoreCapsTitle', { defaultValue: 'Score caps' })}
          </CardTitle>
          <CardDescription>
            {t('debugConfig.scoreCapsSectionDescription', {
              defaultValue: 'Read-only view of the shared scoring registry.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <div
              className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground"
              data-testid="score-caps-empty"
            >
              {t('debugConfig.scoreCapsEmpty', { defaultValue: 'No active score-cap rules.' })}
            </div>
          ) : (
            <Table data-testid="score-caps-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('debugConfig.scoreCapsColId', { defaultValue: 'Id' })}</TableHead>
                  <TableHead>{t('debugConfig.scoreCapsColMatch', { defaultValue: 'Match' })}</TableHead>
                  <TableHead>{t('debugConfig.scoreCapsColExclude', { defaultValue: 'Exclude' })}</TableHead>
                  <TableHead>{t('debugConfig.scoreCapsColCaps', { defaultValue: 'Component caps' })}</TableHead>
                  <TableHead>{t('debugConfig.scoreCapsColMarket', { defaultValue: 'Market' })}</TableHead>
                  <TableHead>{t('debugConfig.scoreCapsColActive', { defaultValue: 'Active' })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id} data-testid="score-caps-rule-row" data-rule-id={rule.id}>
                    <TableCell className="align-top">
                      <div className="font-mono text-xs">{rule.id}</div>
                      <div className="text-sm font-medium">{rule.title}</div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-wrap gap-1">
                        {rule.matchKeywords.map((keyword) => (
                          <Badge key={keyword} variant="outline">
                            {keyword}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="space-y-1">
                        <div className="text-sm">{rule.excludeLabel}</div>
                        <div className="flex flex-wrap gap-1">
                          {rule.excludeKeywords.map((keyword) => (
                            <Badge key={keyword} variant="secondary">
                              {keyword}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      <div>{`related_exp ${rule.relatedExpCap}`}</div>
                      <div>{`industry_db ${rule.industryDbCap}`}</div>
                    </TableCell>
                    <TableCell className="align-top">{rule.market}</TableCell>
                    <TableCell className="align-top">
                      <Badge variant={rule.active ? 'default' : 'secondary'}>
                        {rule.active
                          ? t('debugConfig.scoreCapsActiveYes', { defaultValue: 'Active' })
                          : t('debugConfig.scoreCapsInactive', { defaultValue: 'Inactive' })}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function SystemSettingsScoreCapsPage() {
  return <ScoreCapRulesList rules={listActiveScoreCapRules()} />
}
