
import { useState } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { JobDescriptionEditor } from '../components/JobDescriptionEditor'
import { Trash2, Edit, Plus, FileText, Check, X } from 'lucide-react'
import { Id } from '../../../../packages/convex/convex/_generated/dataModel'

export default function DebugJDs() {
    const jds = useQuery(api.job_descriptions.list_all)
    const deleteJD = useMutation(api.job_descriptions.delete_jd)

    const [searchTerm, setSearchTerm] = useState('')
    const [showEditor, setShowEditor] = useState(false)
    const [editorData, setEditorData] = useState<{ id?: string, title: string, content: string, type: 'system' | 'custom' } | undefined>(undefined)

    // Delete Confirmation State
    const [deleteId, setDeleteId] = useState<Id<"job_descriptions"> | null>(null)

    const filteredJDs = jds?.filter(jd =>
        jd.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        jd.type.toLowerCase().includes(searchTerm.toLowerCase())
    ) || []

    const handleDelete = async () => {
        if (deleteId) {
            try {
                await deleteJD({ id: deleteId })
                setDeleteId(null)
            } catch (e) {
                console.error("Failed to delete JD:", e)
                alert("Failed to delete JD. Only custom JDs can be deleted.")
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
            id: jd._id,
            title: jd.title,
            content: jd.content,
            type: jd.type as 'system' | 'custom'
        })
        setShowEditor(true)
    }

    return (
        <div className="container mx-auto p-6 max-w-5xl">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <FileText className="h-6 w-6 text-primary" />
                        Job Description Management
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Manage System and Custom Job Descriptions for AI Analysis.
                    </p>
                </div>
                <Button onClick={handleCreate}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create New JD
                </Button>
            </div>

            {/* Filters */}
            <div className="flex gap-4 mb-6">
                <div className="relative max-w-sm flex-1">
                    <Input
                        placeholder="Search JDs..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            {/* Data Table */}
            <div className="border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Title</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Last Modified</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!jds ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                    Loading...
                                </TableCell>
                            </TableRow>
                        ) : filteredJDs.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                    No Job Descriptions found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredJDs.map((jd) => (
                                <TableRow key={jd._id}>
                                    <TableCell className="font-medium">
                                        {jd.title}
                                        {jd.type === 'custom' && (
                                            <span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                                Custom
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell className="capitalize">{jd.type}</TableCell>
                                    <TableCell>
                                        {new Date(jd.lastModified).toLocaleString()}
                                    </TableCell>
                                    <TableCell>
                                        {jd.enabled !== false ? (
                                            <span className="flex items-center text-green-600 text-xs">
                                                <Check className="h-3 w-3 mr-1" /> Active
                                            </span>
                                        ) : (
                                            <span className="flex items-center text-muted-foreground text-xs">
                                                <X className="h-3 w-3 mr-1" /> Disabled
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
                        <DialogTitle>Confirm Deletion</DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        Are you sure you want to delete this custom Job Description?
                        This action cannot be undone.
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
                        <Button variant="destructive" onClick={handleDelete}>Delete</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
