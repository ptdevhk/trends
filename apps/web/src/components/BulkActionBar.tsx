/**
 * BulkActionBar - Batch operations for resume screening
 * 
 * Enables quick bulk actions on filtered/scored resumes
 */

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle, XCircle, Download, Users, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'

type ExportFormat = 'csv' | 'xlsx'

function toExportFormat(value: string): ExportFormat {
    return value === 'xlsx' ? 'xlsx' : 'csv'
}

interface BulkActionBarProps {
    totalCount: number
    selectedCount: number
    highScoreCount: number  // 80+ score count
    exportFormat?: ExportFormat
    onExportFormatChange?: (format: ExportFormat) => void
    onSelectAll?: () => void
    onSelectHighScore?: () => void
    onClearSelection?: () => void
    onBulkAction?: (action: 'shortlist' | 'reject' | 'star' | 'export', format?: ExportFormat) => void
    disabled?: boolean
}

export function BulkActionBar({
    totalCount,
    selectedCount,
    highScoreCount,
    exportFormat = 'csv',
    onExportFormatChange,
    onSelectAll,
    onSelectHighScore,
    onClearSelection,
    onBulkAction,
    disabled = false,
}: BulkActionBarProps) {
    const { t } = useTranslation()
    const [loading, setLoading] = useState<string | null>(null)

    const handleAction = useCallback(async (action: 'shortlist' | 'reject' | 'star' | 'export') => {
        setLoading(action)
        try {
            if (action === 'export') {
                await onBulkAction?.(action, exportFormat)
                return
            }
            await onBulkAction?.(action)
        } finally {
            setLoading(null)
        }
    }, [exportFormat, onBulkAction])

    return (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-muted/50 border">
            {/* Selection Info */}
            <div className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">
                    {t('bulkActions.selected', '已选择')}:
                </span>
                <span className="font-medium">
                    {selectedCount} / {totalCount}
                </span>
            </div>

            {/* Divider */}
            <div className="h-6 w-px bg-border" />

            {/* Quick Select Buttons */}
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onSelectAll}
                    disabled={disabled}
                >
                    {t('bulkActions.selectAll', '全选')}
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onSelectHighScore}
                    disabled={disabled || highScoreCount === 0}
                    className={cn(highScoreCount > 0 && 'text-emerald-600 hover:text-emerald-700')}
                >
                    {t('bulkActions.selectHighScore', '选 80+ 分')} ({highScoreCount})
                </Button>
                {selectedCount > 0 && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onClearSelection}
                    >
                        {t('bulkActions.clearSelection', '取消选择')}
                    </Button>
                )}
            </div>

            {/* Divider */}
            <div className="h-6 w-px bg-border" />

            {/* Bulk Actions */}
            <div className="flex items-center gap-1 ml-auto">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAction('shortlist')}
                    disabled={disabled || selectedCount === 0 || loading !== null}
                    className="text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                >
                    <CheckCircle className={cn('mr-1 h-4 w-4', loading === 'shortlist' && 'animate-spin')} />
                    {t('bulkActions.shortlist', '批量入围')}
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAction('star')}
                    disabled={disabled || selectedCount === 0 || loading !== null}
                    className="text-amber-600 border-amber-200 hover:bg-amber-50"
                >
                    <Star className={cn('mr-1 h-4 w-4', loading === 'star' && 'animate-spin')} />
                    {t('bulkActions.star', '批量标星')}
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAction('reject')}
                    disabled={disabled || selectedCount === 0 || loading !== null}
                    className="text-destructive border-destructive/20 hover:bg-destructive/5"
                >
                    <XCircle className={cn('mr-1 h-4 w-4', loading === 'reject' && 'animate-spin')} />
                    {t('bulkActions.reject', '批量拒绝')}
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAction('export')}
                    disabled={disabled || selectedCount === 0 || loading !== null}
                >
                    <Download className={cn('mr-1 h-4 w-4', loading === 'export' && 'animate-spin')} />
                    {t('bulkActions.export', '导出')}
                </Button>
                <Select
                    value={exportFormat}
                    onChange={(event) => onExportFormatChange?.(toExportFormat(event.target.value))}
                    options={[
                        { value: 'csv', label: 'CSV' },
                        { value: 'xlsx', label: 'XLSX' },
                    ]}
                    disabled={disabled || loading !== null}
                    className="h-9 w-[92px]"
                />
            </div>
        </div>
    )
}
