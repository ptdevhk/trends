/**
 * BulkActionBar - Batch operations for resume screening
 * 
 * Enables quick bulk actions on filtered/scored resumes
 */

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { CheckCircle, XCircle, Download, Users, Star, Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { ResumeExportFormat } from '@/types/resume'

interface BulkActionBarProps {
    totalCount: number
    selectedCount: number
    highScoreCount: number
    exportFormat?: ResumeExportFormat
    onExportFormatChange?: (format: ResumeExportFormat) => void
    onSelectAll?: () => void
    onSelectHighScore?: () => void
    onClearSelection?: () => void
    onBulkAction?: (action: 'shortlist' | 'reject' | 'star' | 'block' | 'export', format?: ResumeExportFormat) => void
    blockedCount?: number
    blocksSettingsPath?: string
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
    blockedCount = 0,
    blocksSettingsPath,
    disabled = false,
}: BulkActionBarProps) {
    const { t } = useTranslation()
    const [loading, setLoading] = useState<string | null>(null)

    const handleAction = useCallback(async (action: 'shortlist' | 'reject' | 'star' | 'block' | 'export') => {
        setLoading(action)
        try {
            if (action === 'export') {
                await onBulkAction?.('export', exportFormat)
            } else {
                await onBulkAction?.(action)
            }
        } finally {
            setLoading(null)
        }
    }, [onBulkAction, exportFormat])

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

            {blockedCount > 0 && (
                <>
                    <div className="h-6 w-px bg-border" />
                    <div className="flex items-center gap-1 text-sm">
                        <Ban className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-muted-foreground">
                            {t('bulkActions.blocked', '屏蔽')}:
                        </span>
                        <span className="font-medium text-red-600">{blockedCount}</span>
                        {blocksSettingsPath && (
                            <Link
                                to={blocksSettingsPath}
                                className="ml-1 text-xs text-muted-foreground underline-offset-4 hover:underline hover:text-foreground"
                            >
                                {t('bulkActions.manageBlocked', '管理')}
                            </Link>
                        )}
                    </div>
                </>
            )}

            {/* Divider */}
            <div className="h-6 w-px bg-border" />

            {/* Quick Select Buttons */}
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="sm"
                    data-testid="bulk-select-all"
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
                        data-testid="bulk-clear-selection"
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
                    data-testid="bulk-shortlist"
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
                    onClick={() => handleAction('block')}
                    disabled={disabled || selectedCount === 0 || loading !== null}
                    className="text-red-600 border-red-200 hover:bg-red-50"
                >
                    <Ban className={cn('mr-1 h-4 w-4', loading === 'block' && 'animate-spin')} />
                    {t('bulkActions.block', '批量屏蔽')}
                </Button>
                <div className="flex items-center gap-1">
                    <Select
                        value={exportFormat}
                        aria-label={t('bulkActions.exportFormat')}
                        onChange={(e) => {
                            const val = e.target.value
                            const format = val === 'xlsx' ? 'xlsx' : 'csv'
                            onExportFormatChange?.(format)
                        }}
                        options={[
                            { value: 'csv', label: 'CSV' },
                            { value: 'xlsx', label: 'XLSX' },
                        ]}
                        className="h-8 w-[100px] text-xs border-r-0 rounded-r-none focus:ring-0"
                    />
                    <Button
                        variant="outline"
                        size="sm"
                        data-testid="bulk-export"
                        aria-label={t('bulkActions.export')}
                        onClick={() => handleAction('export')}
                        disabled={disabled || selectedCount === 0 || loading !== null}
                        className="rounded-l-none border-l-0 px-2.5"
                    >
                        <Download className={cn('h-4 w-4', loading === 'export' && 'animate-spin')} />
                    </Button>
                </div>
            </div>
        </div>
    )
}
