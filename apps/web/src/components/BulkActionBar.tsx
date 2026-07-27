/**
 * BulkActionBar - Batch operations for resume screening
 * 
 * Enables quick bulk actions on filtered/scored resumes
 */

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { CheckCircle, XCircle, Download, Users, Ban } from 'lucide-react'
import { CANDIDATE_STATUS_VALUES, type CandidateStatus } from '@/types/resume'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { CompanyPolicyHiddenToggle } from '@/components/CompanyPolicyHiddenToggle'
import { cn } from '@/lib/utils'
import type { ResumeExportFormat } from '@/types/resume'

const PRIMARY_STATUS_FILTERS: CandidateStatus[] = ['new', 'shortlisted', 'rejected']
const PRIMARY_STATUS_SET: ReadonlySet<CandidateStatus> = new Set(PRIMARY_STATUS_FILTERS)
const ALL_STATUS_FILTERS: CandidateStatus[] = [...CANDIDATE_STATUS_VALUES]

interface BulkActionBarProps {
    totalCount: number
    totalCountIsLowerBound?: boolean
    selectedCount: number
    highScoreCount: number
    exportFormat?: ResumeExportFormat
    onExportFormatChange?: (format: ResumeExportFormat) => void
    onSelectAll?: () => void
    onSelectHighScore?: () => void
    onClearSelection?: () => void
    // 'shortlist' and 'reject' also sync Convex candidate_status
    onBulkAction?: (action: 'shortlist' | 'reject' | 'block' | 'export', format?: ResumeExportFormat) => void
    blockedCount?: number
    blocksSettingsPath?: string
    disabled?: boolean
    /** Current active status filter (empty/undefined = default "new only") */
    statusFilter?: CandidateStatus[]
    /** Toggle a status in the filter */
    onStatusToggle?: (status: CandidateStatus) => void
    /** Replace the status filter. Undefined restores the default new-only view. */
    onStatusFilterChange?: (statuses: CandidateStatus[] | undefined) => void
    /** Facet counts by status for chip labels */
    statusFacetCounts?: Record<string, number>
    /** Company-policy hide: count of resumes omitted by visibility=hide */
    companyPolicyHiddenCount?: number
    /** Whether hidden company-policy rows are currently shown */
    showCompanyPolicyHidden?: boolean
    /** Toggle recovery of company-policy-hidden resumes */
    onShowCompanyPolicyHiddenChange?: (show: boolean) => void
}

export function BulkActionBar({
    totalCount,
    totalCountIsLowerBound = false,
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
    statusFilter,
    onStatusToggle,
    onStatusFilterChange,
    statusFacetCounts,
    companyPolicyHiddenCount = 0,
    showCompanyPolicyHidden = false,
    onShowCompanyPolicyHiddenChange,
}: BulkActionBarProps) {
    const { t } = useTranslation()
    const [loading, setLoading] = useState<string | null>(null)
    const showCompanyPolicyControl =
        typeof onShowCompanyPolicyHiddenChange === 'function' &&
        (companyPolicyHiddenCount > 0 || showCompanyPolicyHidden)
    const totalCountLabel = `${totalCount}${totalCountIsLowerBound ? '+' : ''}`
    const allStatusActive = statusFilter?.length === ALL_STATUS_FILTERS.length
        && ALL_STATUS_FILTERS.every((status) => statusFilter.includes(status))
    const allStatusCount = statusFacetCounts
        ? ALL_STATUS_FILTERS.reduce((sum, status) => sum + (statusFacetCounts[status] ?? 0), 0)
        : undefined
    const statusChips = [
        ...PRIMARY_STATUS_FILTERS,
        ...ALL_STATUS_FILTERS.filter((status) => {
            if (PRIMARY_STATUS_SET.has(status)) {
                return false
            }
            return (statusFacetCounts?.[status] ?? 0) > 0 || statusFilter?.includes(status) === true
        }),
    ]

    const handleAction = useCallback(async (action: 'shortlist' | 'reject' | 'block' | 'export') => {
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
        <div
            className="rounded-lg border bg-muted/50"
            data-testid="bulk-action-bar"
        >
            <div className="flex flex-wrap items-center gap-2 p-3">
            {/* Selection Info */}
            <div className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">
                    {t('bulkActions.selected', '已选择')}:
                </span>
                <span className="font-medium">
                    {selectedCount} / {totalCountLabel}
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

            {/* Company-policy hide — same row as selection / status chips */}
            {showCompanyPolicyControl ? (
                <>
                    <div className="h-6 w-px bg-border" />
                    <CompanyPolicyHiddenToggle
                        variant="bar"
                        hiddenCount={companyPolicyHiddenCount}
                        showHidden={showCompanyPolicyHidden}
                        onShowHiddenChange={onShowCompanyPolicyHiddenChange!}
                    />
                </>
            ) : null}

            {/* Divider */}
            <div className="h-6 w-px bg-border" />

            {/* Status Filter Chips */}
            {onStatusToggle && (
                <div className="flex items-center gap-1">
                    {onStatusFilterChange && (
                        <button
                            type="button"
                            onClick={() => {
                                onStatusFilterChange(allStatusActive ? undefined : ALL_STATUS_FILTERS)
                            }}
                            className={cn(
                                'px-2 py-0.5 rounded-full text-xs border transition-colors',
                                allStatusActive
                                    ? 'bg-primary/10 border-primary text-primary font-medium'
                                    : 'border-border text-muted-foreground hover:bg-muted',
                            )}
                        >
                            {t('bulkActions.statusAll', '全部状态')}
                            {typeof allStatusCount === 'number' && (
                                <span className="ml-1 text-slate-700">
                                    {allStatusCount}
                                </span>
                            )}
                        </button>
                    )}
                    {statusChips.map((status) => {
                        const isActive = statusFilter && statusFilter.length > 0
                            ? statusFilter.includes(status)
                            : status === 'new'
                        const count = statusFacetCounts?.[status]
                        return (
                            <button
                                key={status}
                                type="button"
                                onClick={() => onStatusToggle(status)}
                                className={cn(
                                    'px-2 py-0.5 rounded-full text-xs border transition-colors',
                                    isActive
                                        ? 'bg-primary/10 border-primary text-primary font-medium'
                                        : 'border-border text-muted-foreground hover:bg-muted',
                                )}
                            >
                                {t(`resumes.status.options.${status}`, status)}
                                {typeof count === 'number' && count > 0 && (
                                    <span className="ml-1 text-slate-700">{count}</span>
                                )}
                            </button>
                        )
                    })}
                </div>
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
                    className={cn(highScoreCount > 0 && 'text-emerald-700 hover:text-emerald-800')}
                >
                    {t('bulkActions.selectHighScore', '选 80+ 分')} ({highScoreCount})
                </Button>
                {selectedCount > 0 && (
                    <Button
                        variant="ghost"
                        size="sm"
                        data-testid="bulk-clear-selection"
                        onClick={onClearSelection}
                        disabled={disabled}
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
                        disabled={disabled}
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
        </div>
    )
}
