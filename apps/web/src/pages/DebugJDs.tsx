import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAction, useMutation } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { JobDescriptionEditor } from '../components/JobDescriptionEditor'
import { Trash2, Edit, Plus, FileText, Check, X, Copy, ArrowUpDown, Eye, Download, ChevronUp, ChevronDown, AlertTriangle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Doc, Id } from '../../../../packages/convex/convex/_generated/dataModel'
import { PageHeader } from '@/components/PageHeader'

import { useTranslation } from 'react-i18next'
import { formatInAppTimezone } from '@/lib/timezone'
import { useWorkspace } from '@/contexts/WorkspaceContext'

type SortColumn = 'title' | 'type' | 'lastModified' | 'usageCount'
type SortDirection = 'asc' | 'desc'
type EditorData = {
    id?: Id<"job_descriptions">
    title: string
    content: string
    type: 'system' | 'custom'
    location?: string
    industryTags?: string[]
    customKeywords?: string[]
    minExperience?: number
    maxExperience?: number
    minAge?: number
    maxAge?: number
}

function getUsageCount(value: unknown): number {
    if (typeof value !== 'object' || value === null || !('usageCount' in value)) {
        return 0
    }
    const rawUsageCount = value.usageCount
    return typeof rawUsageCount === 'number' && Number.isFinite(rawUsageCount) ? rawUsageCount : 0
}

export default function DebugJDs() {
    const { t } = useTranslation()
    const { slug } = useWorkspace()
    const loadJdsWithUsage = useAction(api.job_descriptions.list_with_usage_action)
    const deleteJD = useMutation(api.job_descriptions.delete_jd)
    const deleteBatch = useMutation(api.job_descriptions.delete_batch)
    const [jds, setJds] = useState<Array<Doc<"job_descriptions"> & { usageCount?: number }> | undefined>(undefined)

    const [searchTerm, setSearchTerm] = useState('')
    const [typeFilter, setTypeFilter] = useState<string>('all')
    const [showEditor, setShowEditor] = useState(false)
    const [editorData, setEditorData] = useState<EditorData | undefined>(undefined)
    const [deleteError, setDeleteError] = useState<string | null>(null)
    const [sortColumn, setSortColumn] = useState<SortColumn>('lastModified')
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
    const [previewJd, setPreviewJd] = useState<Doc<"job_descriptions"> | null>(null)

    // Selection State
    const [selectedIds, setSelectedIds] = useState<Set<Id<"job_descriptions">>>(new Set())

    // Delete Confirmation State
    const [deleteId, setDeleteId] = useState<Id<"job_descriptions"> | null>(null)
    const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)

    const refreshJds = useCallback(async () => {
        try {
            const result = await loadJdsWithUsage({ workspaceSlug: slug })
            setJds(result)
        } catch (error) {
            console.error('Failed to load job descriptions with usage', error)
            setDeleteError((previous) => previous ?? t('jdManagement.errors.deleteFailed'))
        }
    }, [loadJdsWithUsage, slug, t])

    useEffect(() => {
        void refreshJds()
    }, [refreshJds])

    const filteredJDs = useMemo(() => {
        if (!jds) return []

        return jds.filter(jd => {
            const matchesSearch = jd.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                jd.type.toLowerCase().includes(searchTerm.toLowerCase())
            const matchesType = typeFilter === 'all' || jd.type === typeFilter
            return matchesSearch && matchesType
        })
    }, [jds, searchTerm, typeFilter])
    const sortedJDs = useMemo(() => {
        return [...filteredJDs].sort((a, b) => {
            const direction = sortDirection === 'asc' ? 1 : -1

            if (sortColumn === 'lastModified') {
                return (a.lastModified - b.lastModified) * direction
            }

            if (sortColumn === 'title') {
                return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) * direction
            }

            if (sortColumn === 'usageCount') {
                return (getUsageCount(a) - getUsageCount(b)) * direction
            }

            return a.type.localeCompare(b.type, undefined, { sensitivity: 'base' }) * direction
        })
    }, [filteredJDs, sortColumn, sortDirection])
    const selectableJDs = filteredJDs.filter(jd => jd.type === 'custom')
    const selectedCustomCount = selectableJDs.filter(jd => selectedIds.has(jd._id)).length
    const allCustomSelected = selectableJDs.length > 0 && selectedCustomCount === selectableJDs.length

    const handleDelete = async () => {
        if (deleteId) {
            try {
                await deleteJD({ id: deleteId, workspaceSlug: slug })
                await refreshJds()
                setDeleteId(null)
                setDeleteError(null)
            } catch (error) {
                console.error("Failed to delete JD:", error)
                const message = error instanceof Error ? error.message : t('jdManagement.errors.deleteFailed')
                setDeleteError(message || t('jdManagement.errors.deleteFailed'))
                setDeleteId(null) // Close dialog so they can see the error
            }
        }
    }

    const handleCreate = () => {
        setEditorData(undefined)
        setShowEditor(true)
    }

    const handleEdit = (jd: Doc<"job_descriptions">) => {
        setEditorData({
            id: jd._id,
            title: jd.title,
            content: jd.content,
            type: jd.type === 'system' ? 'system' : 'custom',
            location: jd.location,
            industryTags: jd.industryTags,
            customKeywords: jd.customKeywords,
            minExperience: jd.minExperience,
            maxExperience: jd.maxExperience,
            minAge: jd.minAge,
            maxAge: jd.maxAge,
        })
        setShowEditor(true)
    }

    const handleDuplicate = (jd: Doc<"job_descriptions">) => {
        setEditorData({
            title: `${jd.title} (${t('jdManagement.duplicate')})`,
            content: jd.content,
            type: 'custom', // Always duplicate as custom
            location: jd.location,
            industryTags: jd.industryTags,
            customKeywords: jd.customKeywords,
            minExperience: jd.minExperience,
            maxExperience: jd.maxExperience,
            minAge: jd.minAge,
            maxAge: jd.maxAge,
        })
        setShowEditor(true)
    }

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return

        try {
            await deleteBatch({ ids: Array.from(selectedIds), workspaceSlug: slug })
            await refreshJds()
            setSelectedIds(new Set())
            setShowBulkDeleteConfirm(false)
            setDeleteError(null)
        } catch (error) {
            console.error("Failed to batch delete JDs:", error)
            const message = error instanceof Error ? error.message : t('jdManagement.errors.deleteFailed')
            setDeleteError(message || t('jdManagement.errors.deleteFailed'))
            setShowBulkDeleteConfirm(false)
        }
    }

    const toggleSelectAll = () => {
        if (allCustomSelected) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(selectableJDs.map(jd => jd._id)))
        }
    }

    const toggleSelect = (id: Id<"job_descriptions">) => {
        const newSelected = new Set(selectedIds)
        if (newSelected.has(id)) {
            newSelected.delete(id)
        } else {
            newSelected.add(id)
        }
        setSelectedIds(newSelected)
    }

    const handleSort = (column: SortColumn) => {
        if (sortColumn === column) {
            setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'))
            return
        }

        setSortColumn(column)
        setSortDirection('asc')
    }

    const getSortTitle = (column: SortColumn) => {
        const nextDirection = sortColumn === column && sortDirection === 'asc' ? 'desc' : 'asc'
        return nextDirection === 'asc'
            ? t('jdManagement.sortAsc', { defaultValue: 'Sort ascending' })
            : t('jdManagement.sortDesc', { defaultValue: 'Sort descending' })
    }

    const handleExportMarkdown = (jd: Doc<"job_descriptions">) => {
        try {
            const markdown = `# ${jd.title}\n\n${jd.content}`
            const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
            const url = window.URL.createObjectURL(blob)
            const link = document.createElement('a')
            const safeTitle = jd.title.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-')
            link.href = url
            link.download = `${safeTitle || 'job-description'}.md`
            document.body.appendChild(link)
            link.click()
            link.remove()
            window.URL.revokeObjectURL(url)
        } catch (error) {
            console.error('Failed to export JD markdown:', error)
        }
    }

    const handleBulkExport = () => {
        if (selectedIds.size === 0) return
        try {
            const selectedJDs = jds?.filter(jd => selectedIds.has(jd._id)) || []
            const content = selectedJDs.map(jd => `# ${jd.title}\n\n${jd.content}`).join('\n\n---\n\n')
            const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
            const url = window.URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = `bulk-export-${new Date().toISOString().split('T')[0]}.md`
            document.body.appendChild(link)
            link.click()
            link.remove()
            window.URL.revokeObjectURL(url)
        } catch (error) {
            console.error('Failed to export bulk JDs:', error)
        }
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title={
                    <>
                        <FileText className="h-6 w-6 text-primary" />
                        {t('jdManagement.title')}
                    </>
                }
                description={t('jdManagement.subtitle')}
                actions={
                    <>
                        {selectedIds.size > 0 && (
                            <>
                                <Button variant="outline" onClick={handleBulkExport}>
                                    <Download className="h-4 w-4 mr-2" />
                                    {t('jdManagement.exportSelected', { count: selectedIds.size, defaultValue: 'Export selected' })}
                                </Button>
                                <Button variant="destructive" onClick={() => setShowBulkDeleteConfirm(true)}>
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    {t('jdManagement.deleteSelected', { count: selectedIds.size })}
                                </Button>
                            </>
                        )}
                        <Button onClick={handleCreate}>
                            <Plus className="h-4 w-4 mr-2" />
                            {t('jdManagement.createNew')}
                        </Button>
                    </>
                }
            />

            {/* Filters */}
            <div className="flex gap-4 mb-6">
                <div className="relative max-w-sm flex-1">
                    <Input
                        placeholder={t('jdManagement.searchPlaceholder')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="w-[180px]">
                    <Select
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)}
                        options={[
                            { value: 'all', label: t('jdManagement.filterAll') },
                            { value: 'system', label: t('jdManagement.filterSystem') },
                            { value: 'custom', label: t('jdManagement.filterCustom') }
                        ]}
                    />
                </div>
            </div>

            {deleteError && (
                <div className="mb-6 p-4 bg-destructive/10 text-destructive rounded-md border border-destructive/20 text-sm">
                    {deleteError}
                </div>
            )}

            {/* Data Table */}
            <div className="border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[50px]">
                                <input
                                    type="checkbox"
                                    checked={allCustomSelected}
                                    onChange={toggleSelectAll}
                                    className="rounded border-gray-300 text-primary focus:ring-primary"
                                    disabled={selectableJDs.length === 0}
                                />
                            </TableHead>
                            <TableHead>
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-1 hover:text-foreground"
                                    onClick={() => handleSort('title')}
                                    title={getSortTitle('title')}
                                >
                                    {t('jdManagement.table.title')}
                                    {sortColumn === 'title' ? (
                                        sortDirection === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
                                    ) : <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />}
                                </button>
                            </TableHead>
                            <TableHead>
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-1 hover:text-foreground"
                                    onClick={() => handleSort('type')}
                                    title={getSortTitle('type')}
                                >
                                    {t('jdManagement.table.type')}
                                    {sortColumn === 'type' ? (
                                        sortDirection === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
                                    ) : <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />}
                                </button>
                            </TableHead>
                            <TableHead>
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-1 hover:text-foreground"
                                    onClick={() => handleSort('usageCount')}
                                    title={getSortTitle('usageCount')}
                                >
                                    {t('jdManagement.table.usageCount', { defaultValue: 'Used By' })}
                                    {sortColumn === 'usageCount' ? (
                                        sortDirection === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
                                    ) : <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />}
                                </button>
                            </TableHead>
                            <TableHead>{t('jdManagement.table.location', { defaultValue: 'Location' })}</TableHead>
                            <TableHead>{t('jdManagement.table.industry', { defaultValue: 'Industry' })}</TableHead>
                            <TableHead>{t('jdManagement.table.exp', { defaultValue: 'Exp' })}</TableHead>
                            <TableHead>{t('jdManagement.table.age', { defaultValue: 'Age' })}</TableHead>
                            <TableHead>
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-1 hover:text-foreground"
                                    onClick={() => handleSort('lastModified')}
                                    title={getSortTitle('lastModified')}
                                >
                                    {t('jdManagement.table.lastModified')}
                                    {sortColumn === 'lastModified' ? (
                                        sortDirection === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
                                    ) : <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />}
                                </button>
                            </TableHead>
                            <TableHead>{t('jdManagement.table.status')}</TableHead>
                            <TableHead className="text-right">{t('jdManagement.table.actions')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!jds ? (
                            <TableRow>
                                <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                                    {t('trends.loading')}
                                </TableCell>
                            </TableRow>
                        ) : sortedJDs.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                                    {t('search.noResults')}
                                </TableCell>
                            </TableRow>
                        ) : (
                            sortedJDs.map((jd) => (
                                <TableRow key={jd._id}>
                                    <TableCell>
                                        {jd.type === 'custom' && (
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(jd._id)}
                                                onChange={() => toggleSelect(jd._id)}
                                                className="rounded border-gray-300 text-primary focus:ring-primary"
                                            />
                                        )}
                                    </TableCell>
                                    <TableCell className="font-medium">
                                        {jd.title}
                                        {jd.type === 'custom' && (
                                            <span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                                {t('jdManagement.types.custom')}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell className="capitalize">
                                        {jd.type === 'system' ? t('jdManagement.types.system') : t('jdManagement.types.custom')}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className="bg-muted text-xs">
                                            {getUsageCount(jd)} {t('jdManagement.usageSuffix', { defaultValue: 'Analysis' })}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {jd.location || '—'}
                                    </TableCell>
                                    <TableCell>
                                        {jd.industryTags && jd.industryTags.length > 0 ? (
                                            <div className="flex flex-wrap gap-1">
                                                {jd.industryTags.map((tag) => (
                                                    <Badge key={`${jd._id}-${tag}`} variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                                                        {tag}
                                                    </Badge>
                                                ))}
                                            </div>
                                        ) : '—'}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {typeof jd.minExperience === 'number' ? `${jd.minExperience}${t('jdEditor.years', { defaultValue: '年' })}` : '—'}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {(typeof jd.minAge === 'number' || typeof jd.maxAge === 'number')
                                            ? `${typeof jd.minAge === 'number' ? jd.minAge : '—'}-${typeof jd.maxAge === 'number' ? jd.maxAge : '—'}${t('quickStart.ageUnit', { defaultValue: '岁' })}`
                                            : '—'}
                                    </TableCell>
                                    <TableCell>
                                        {formatInAppTimezone(jd.lastModified, { includeDate: true, includeSeconds: true })}
                                    </TableCell>
                                    <TableCell>
                                        {jd.enabled !== false ? (
                                            <span className="flex items-center text-green-600 text-xs">
                                                <Check className="h-3 w-3 mr-1" /> {t('jdManagement.status.active')}
                                            </span>
                                        ) : (
                                            <span className="flex items-center text-muted-foreground text-xs">
                                                <X className="h-3 w-3 mr-1" /> {t('jdManagement.status.disabled')}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setPreviewJd(jd)}
                                                title={t('jdManagement.preview', { defaultValue: 'Preview' })}
                                            >
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleExportMarkdown(jd)}
                                                title={t('jdManagement.exportMarkdown', { defaultValue: 'Export Markdown' })}
                                            >
                                                <Download className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleEdit(jd)}
                                            >
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleDuplicate(jd)}
                                                title={t('jdManagement.duplicate')}
                                            >
                                                <Copy className="h-4 w-4" />
                                            </Button>

                                            {jd.type === 'custom' && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                                    onClick={() => setDeleteId(jd._id)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Editor Dialog */}
            <JobDescriptionEditor
                open={showEditor}
                onOpenChange={setShowEditor}
                initialData={editorData}
                onSaveSuccess={() => {
                    void refreshJds()
                    setShowEditor(false)
                }}
            />

            {/* Preview Dialog */}
            <Dialog open={!!previewJd} onOpenChange={(open) => !open && setPreviewJd(null)}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader className="flex flex-row items-center justify-between">
                        <DialogTitle>{previewJd?.title || t('jdManagement.preview', { defaultValue: 'Preview' })}</DialogTitle>
                        {previewJd && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="mr-6"
                                onClick={() => {
                                    handleEdit(previewJd)
                                    setPreviewJd(null)
                                }}
                            >
                                <Edit className="h-4 w-4 mr-2" />
                                {t('jdManagement.edit', { defaultValue: 'Edit' })}
                            </Button>
                        )}
                    </DialogHeader>
                    <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-sm leading-6">
                        {previewJd?.content}
                    </pre>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('jdManagement.deleteConfirmTitle')}</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-3">
                        <div>{t('jdManagement.deleteConfirm')}</div>
                        {deleteId && (() => {
                            const jd = jds?.find(j => j._id === deleteId)
                            const count = getUsageCount(jd)
                            if (count > 0) {
                                return (
                                    <div className="flex items-start gap-2 p-3 bg-warning/10 text-orange-600 rounded-md border border-warning/20 text-sm">
                                        <AlertTriangle className="h-4 w-4 mt-0.5" />
                                        <div>
                                            {t('jdManagement.usageWarning', {
                                                count,
                                                defaultValue: 'This JD has been used for {{count}} analysis. Deleting it will leave those resumes without a JD link.'
                                            })}
                                        </div>
                                    </div>
                                )
                            }
                            return null
                        })()}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteId(null)}>{t('jdManagement.cancel')}</Button>
                        <Button variant="destructive" onClick={handleDelete}>{t('jdManagement.delete')}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Bulk Delete Confirmation Dialog */}
            <Dialog open={showBulkDeleteConfirm} onOpenChange={setShowBulkDeleteConfirm}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('jdManagement.deleteConfirmTitle')}</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-3">
                        <div>{t('jdManagement.confirmBulkDelete', { count: selectedIds.size })}</div>
                        {(() => {
                            const selectedJDs = jds?.filter(jd => selectedIds.has(jd._id)) || []
                            const totalUsage = selectedJDs.reduce((acc, jd) => acc + getUsageCount(jd), 0)
                            if (totalUsage > 0) {
                                return (
                                    <div className="flex items-start gap-2 p-3 bg-warning/10 text-orange-600 rounded-md border border-warning/20 text-sm">
                                        <AlertTriangle className="h-4 w-4 mt-0.5" />
                                        <div>
                                            {t('jdManagement.bulkUsageWarning', {
                                                count: totalUsage,
                                                defaultValue: 'These JDs have been used for total {{count}} analysis. Deleting them will affect these records.'
                                            })}
                                        </div>
                                    </div>
                                )
                            }
                            return null
                        })()}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowBulkDeleteConfirm(false)}>{t('jdManagement.cancel')}</Button>
                        <Button variant="destructive" onClick={handleBulkDelete}>{t('jdManagement.delete')}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
