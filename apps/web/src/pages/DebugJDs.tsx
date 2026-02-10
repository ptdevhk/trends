
import { useState } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { JobDescriptionEditor } from '../components/JobDescriptionEditor'
import { Trash2, Edit, Plus, FileText, Check, X, Copy } from 'lucide-react'

import { Select } from '@/components/ui/select'
import { Id } from '../../../../packages/convex/convex/_generated/dataModel'

import { useTranslation } from 'react-i18next'

export default function DebugJDs() {
    const { t } = useTranslation()
    const jds = useQuery(api.job_descriptions.list_all)
    const deleteJD = useMutation(api.job_descriptions.delete_jd)
    const deleteBatch = useMutation(api.job_descriptions.delete_batch)

    const [searchTerm, setSearchTerm] = useState('')
    const [typeFilter, setTypeFilter] = useState<string>('all')
    const [showEditor, setShowEditor] = useState(false)
    const [editorData, setEditorData] = useState<{ id?: Id<"job_descriptions">, title: string, content: string, type: 'system' | 'custom' } | undefined>(undefined)
    const [deleteError, setDeleteError] = useState<string | null>(null)

    // Selection State
    const [selectedIds, setSelectedIds] = useState<Set<Id<"job_descriptions">>>(new Set())

    // Delete Confirmation State
    const [deleteId, setDeleteId] = useState<Id<"job_descriptions"> | null>(null)
    const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)

    const filteredJDs = jds?.filter(jd => {
        const matchesSearch = jd.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            jd.type.toLowerCase().includes(searchTerm.toLowerCase())
        const matchesType = typeFilter === 'all' || jd.type === typeFilter
        return matchesSearch && matchesType
    }) || []

    const handleDelete = async () => {
        if (deleteId) {
            try {
                await deleteJD({ id: deleteId })
                setDeleteId(null)
                setDeleteError(null)
            } catch (e: any) {
                console.error("Failed to delete JD:", e)
                setDeleteError(e.message || t('jdManagement.errors.deleteFailed'))
                setDeleteId(null) // Close dialog so they can see the error
            }
        }
    }

    const handleCreate = () => {
        setEditorData({
            title: 'New Custom JD',
            content: `# Job Requirements
- Education: [e.g. Bachelor's Degree]
- Experience: [e.g. 3+ years in Sales]
- Skills: [e.g. Communication, Negotiation]
- Location: [City]

# Key Responsibilities
- [Responsibility 1]
- [Responsibility 2]

# Preferred Qualifications
- [Nice-to-have skill]`,
            type: 'custom'
        })
        setShowEditor(true)
    }

    const handleEdit = (jd: any) => {
        setEditorData({
            id: jd._id as Id<"job_descriptions">,
            title: jd.title,
            content: jd.content,
            type: jd.type as 'system' | 'custom'
        })
        setShowEditor(true)
    }

    const handleDuplicate = (jd: any) => {
        setEditorData({
            title: `${jd.title} (${t('jdManagement.duplicate')})`,
            content: jd.content,
            type: 'custom' // Always duplicate as custom
        })
        setShowEditor(true)
    }

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return

        try {
            await deleteBatch({ ids: Array.from(selectedIds) })
            setSelectedIds(new Set())
            setShowBulkDeleteConfirm(false)
            setDeleteError(null)
        } catch (e: any) {
            console.error("Failed to batch delete JDs:", e)
            setDeleteError(e.message || t('jdManagement.errors.deleteFailed'))
            setShowBulkDeleteConfirm(false)
        }
    }

    const toggleSelectAll = () => {
        const customJDs = filteredJDs.filter(jd => jd.type === 'custom')
        if (selectedIds.size === customJDs.length && customJDs.length > 0) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(customJDs.map(jd => jd._id)))
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

    return (
        <div className="container mx-auto p-6 max-w-5xl">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <FileText className="h-6 w-6 text-primary" />
                        {t('jdManagement.title')}
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        {t('jdManagement.subtitle')}
                    </p>
                </div>
                <div className="flex gap-2">
                    {selectedIds.size > 0 && (
                        <Button variant="destructive" onClick={() => setShowBulkDeleteConfirm(true)}>
                            <Trash2 className="h-4 w-4 mr-2" />
                            {t('jdManagement.deleteSelected', { count: selectedIds.size })}
                        </Button>
                    )}
                    <Button onClick={handleCreate}>
                        <Plus className="h-4 w-4 mr-2" />
                        {t('jdManagement.createNew')}
                    </Button>
                </div>
            </div>

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
                                    checked={filteredJDs.filter(jd => jd.type === 'custom').length > 0 && selectedIds.size === filteredJDs.filter(jd => jd.type === 'custom').length}
                                    onChange={toggleSelectAll}
                                    className="rounded border-gray-300 text-primary focus:ring-primary"
                                    disabled={filteredJDs.filter(jd => jd.type === 'custom').length === 0}
                                />
                            </TableHead>
                            <TableHead>{t('jdManagement.table.title')}</TableHead>
                            <TableHead>{t('jdManagement.table.type')}</TableHead>
                            <TableHead>{t('jdManagement.table.lastModified')}</TableHead>
                            <TableHead>{t('jdManagement.table.status')}</TableHead>
                            <TableHead className="text-right">{t('jdManagement.table.actions')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!jds ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                    {t('trends.loading')}
                                </TableCell>
                            </TableRow>
                        ) : filteredJDs.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                    {t('search.noResults')}
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredJDs.map((jd) => (
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
                                        {new Date(jd.lastModified).toLocaleString()}
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
                    // Query automatically refreshes
                    setShowEditor(false)
                }}
            />

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('jdManagement.deleteConfirmTitle')}</DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        {t('jdManagement.deleteConfirm')}
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
                    <div className="py-4">
                        {t('jdManagement.confirmBulkDelete', { count: selectedIds.size })}
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
