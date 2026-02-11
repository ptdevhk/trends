
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Send, Wand2 } from "lucide-react";
import type { ResumeItem } from "@/hooks/useResumes";
import type { MatchingResult } from "@/types/resume";

interface OutreachModalProps {
    isOpen: boolean;
    onClose: () => void;
    resume: ResumeItem;
    jobDescription: {
        id: string;
        title: string;
        company?: string;
        requirements: string;
    };
    analysis?: MatchingResult;
    onSuccess?: () => void;
}

export function OutreachModal({
    isOpen,
    onClose,
    resume,
    jobDescription,
    analysis,
    onSuccess,
}: OutreachModalProps) {
    const [subject, setSubject] = useState("");
    const [body, setBody] = useState("");
    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Auto-generate draft when modal opens
    useEffect(() => {
        if (isOpen && analysis && !subject && !body) {
            handleGenerateDraft();
        }
    }, [isOpen, analysis]);

    const handleGenerateDraft = async () => {
        if (!analysis) return;
        setGenerating(true);
        try {
            const res = await fetch("/api/notifications/draft", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    resume: {
                        id: resume.resumeId || resume.name,
                        name: resume.name,
                        summary: resume.selfIntro,
                        skills: [],
                        workExperience: parseInt(resume.experience) || 0,
                        education: resume.education,
                        jobIntention: resume.jobIntention,
                        companies: resume.workHistory?.map(w => w.raw) ?? [],
                    },
                    jobDescription,
                    analysis,
                }),
            });

            const data = await res.json();
            if (res.ok) {
                setSubject(data.subject);
                setBody(data.body);
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            setError(error instanceof Error ? error.message : "Draft generation failed");
        } finally {
            setGenerating(false);
        }
    };

    const handleSend = async () => {
        setLoading(true);
        try {
            // For now, we simulate sending to the candidate's email derived from name or use a placeholder
            // In a real app, resume.email would be verified
            const emailMatch = resume.selfIntro?.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi);
            const email = emailMatch ? emailMatch[0] : "candidate@example.com";

            const res = await fetch("/api/notifications/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    to: email,
                    subject,
                    body,
                }),
            });

            const data = await res.json();
            if (res.ok) {
                onSuccess?.();
                onClose();
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            setError(error instanceof Error ? error.message : "Sending failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>Contact {resume.name}</DialogTitle>
                    <DialogDescription>
                        Draft an outreach email for {jobDescription.title}.
                    </DialogDescription>
                    {error && (
                        <div className="mt-2 text-sm text-destructive bg-destructive/10 p-2 rounded">
                            {error}
                        </div>
                    )}
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="subject">Subject</Label>
                        <div className="flex gap-2">
                            <Input
                                id="subject"
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                placeholder="Email subject..."
                                className="flex-1"
                            />
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={handleGenerateDraft}
                                disabled={generating}
                                title="Regenerate Draft"
                            >
                                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                            </Button>
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="body">Message Body</Label>
                        <Textarea
                            id="body"
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            placeholder="Write your message here..."
                            className="h-[300px]"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={handleSend} disabled={loading || generating || !subject || !body}>
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Sending...
                            </>
                        ) : (
                            <>
                                <Send className="mr-2 h-4 w-4" />
                                Send Email
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
