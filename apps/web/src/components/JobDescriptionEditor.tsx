
import { useState, useEffect } from "react"
import { useMutation } from "convex/react"
import { api } from "../../../../packages/convex/convex/_generated/api"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

interface JobDescriptionEditorProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    initialData?: {
        id?: string // If editing existing custom JD
        title: string
        content: string
        type: "system" | "custom"
    }
    onSaveSuccess?: (newId: string) => void
}

export function JobDescriptionEditor({ open, onOpenChange, initialData, onSaveSuccess }: JobDescriptionEditorProps) {
    const createJD = useMutation(api.job_descriptions.create);
    const updateJD = useMutation(api.job_descriptions.update);

    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (open && initialData) {
            setTitle(initialData.title + (initialData.type === 'system' ? ' (Custom Copy)' : ''));
            setContent(initialData.content);
        } else if (open) {
            setTitle("");
            setContent("");
        }
    }, [open, initialData]);

    const handleSave = async () => {
        if (!title.trim() || !content.trim()) return;
        setLoading(true);
        try {
            let newId;
            if (initialData?.type === 'custom' && initialData.id) {
                // Update existing
                await updateJD({
                    id: initialData.id as any,
                    title,
                    content
                });
                newId = initialData.id;
            } else {
                // Create new (even if editing system, we create a copy)
                newId = await createJD({
                    title,
                    content,
                    type: "custom"
                });
            }
            onSaveSuccess?.(newId);
            onOpenChange(false);
        } catch (error) {
            console.error("Failed to save JD", error);
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>{initialData?.type === 'custom' ? "Edit Job Description" : "Create Custom Job Description"}</DialogTitle>
                    <DialogDescription>
                        Define the role requirements and matching criteria for better AI analysis.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="title">Job Title</Label>
                        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Senior Backend Engineer" />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="content">Requirements & Responsibilities</Label>
                        <Textarea
                            id="content"
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder="Paste the job description here..."
                            className="min-h-[300px] font-mono text-sm"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSave} disabled={loading}>{loading ? "Saving..." : "Save Configuration"}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
