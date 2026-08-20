import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { entryLabel, type EntryType, type IndustryDataEntry } from './industry-data-model'

export function IndustryDataManagePanel({
  entries,
  loading,
  entryType,
  entryTypes,
  onEntryTypeChange,
  onRefresh,
  onSeed,
  onExport,
  onDelete,
  importText,
  onImportTextChange,
  onImport,
}: {
  entries: IndustryDataEntry[]
  loading: boolean
  entryType: EntryType | 'all'
  entryTypes: Array<EntryType | 'all'>
  onEntryTypeChange: (type: EntryType | 'all') => void
  onRefresh: () => void
  onSeed: () => void
  onExport: () => void
  onDelete: (entryId: string) => void
  importText: string
  onImportTextChange: (value: string) => void
  onImport: () => void
}) {
  const { t } = useTranslation()
  return (
    <Card data-testid="industry-data-manage">
      <CardHeader>
        <CardTitle>
          {t('debugConfig.industryDataManageTitle', {
            defaultValue: 'Manage entries',
          })}
        </CardTitle>
        <CardDescription>
          {t('debugConfig.industryDataManageDesc', {
            defaultValue:
              'Convex-canonical entries. Edits regenerate config/industry-data files.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {entryTypes.map((type) => (
            <Button
              key={type}
              type="button"
              size="sm"
              variant={entryType === type ? 'default' : 'outline'}
              data-testid={`industry-data-type-${type}`}
              onClick={() => onEntryTypeChange(type)}
            >
              {type}
            </Button>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={onRefresh}>
            {t('debugConfig.industryDataRefresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="industry-data-seed"
            onClick={onSeed}
          >
            {t('debugConfig.industryDataSeed', { defaultValue: 'Seed from files' })}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={onExport}>
            {t('debugConfig.industryDataExport', { defaultValue: 'Export' })}
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t('resumes.loading', { defaultValue: 'Loading…' })}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border" data-testid="industry-data-entries-table">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th className="p-2">entryId</th>
                  <th className="p-2">type</th>
                  <th className="p-2">label</th>
                  <th className="p-2">actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.entryId} className="border-b" data-testid={`industry-data-row-${entry.entryId}`}>
                    <td className="p-2 font-mono text-xs">{entry.entryId}</td>
                    <td className="p-2">{entry.entryType}</td>
                    <td className="p-2">{entryLabel(entry)}</td>
                    <td className="p-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => onDelete(entry.entryId)}
                      >
                        {t('debugConfig.industryDataDelete', { defaultValue: 'Delete' })}
                      </Button>
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td className="p-3 text-muted-foreground" colSpan={4}>
                      {t('debugConfig.industryDataEmpty', {
                        defaultValue: 'No entries. Seed from files or import JSON.',
                      })}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="industry-data-import">
            {t('debugConfig.industryDataImport', { defaultValue: 'Import JSON' })}
          </label>
          <textarea
            id="industry-data-import"
            data-testid="industry-data-import"
            className="min-h-28 w-full rounded-md border bg-background p-2 font-mono text-xs"
            value={importText}
            onChange={(e) => onImportTextChange(e.target.value)}
            placeholder='[{"entryType":"brand","entryId":"brand-1","data":{...}}]'
          />
          <Button type="button" size="sm" onClick={onImport}>
            {t('debugConfig.industryDataImportSubmit', { defaultValue: 'Import' })}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
