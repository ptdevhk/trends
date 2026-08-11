import { sanitizeResumeRecordForSurface, selectLatestWorkHistory } from "@trends/shared";
import { useState, useEffect, useCallback, useMemo } from "react";
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
import { apiClient } from "@/lib/api-client";
import { useResumeFieldUsagePolicy } from "@/contexts/ResumeFieldUsagePolicyContext";

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
    const fieldUsagePolicy = useResumeFieldUsagePolicy();
    const [subject, setSubject] = useState("");
    const [body, setBody] = useState("");
    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const outreachResume = useMemo(
        () => sanitizeResumeRecordForSurface(resume, "outreach", fieldUsagePolicy),
        [fieldUsagePolicy, resume],
    );



    const handleGenerateDraft = useCallback(async () => {
        if (!analysis) return;
        setGenerating(true);
        try {
            const res = await apiClient.POST("/api/notifications/draft", {
                body: {
                    resume: {
                        id: resume.resumeId || resume.name,
                        name: outreachResume.name,
                        ...(typeof outreachResume.selfIntro === "string" && outreachResume.selfIntro.trim().length > 0
                            ? { summary: outreachResume.selfIntro }
                            : {}),
                        skills: [],
                        workExperience: parseInt(typeof outreachResume.experience === "string" ? outreachResume.experience : resume.experience) || 0,
                        ...(typeof outreachResume.education === "string" && outreachResume.education.trim().length > 0
                            ? { education: outreachResume.education }
                            : {}),
                        ...(typeof outreachResume.jobIntention === "string" && outreachResume.jobIntention.trim().length > 0
                            ? { jobIntention: outreachResume.jobIntention }
                            : {}),
                        companies: selectLatestWorkHistory(resume.workHistory)
                            .map((work) => work.companyName)
                            .filter((company): company is string => typeof company === "string" && company.length > 0),
                    },
                    jobDescription,
                    analysis,
                },
            });

            const data = (res.response.ok ? res.data : res.error) as
                | { subject?: string; body?: string; error?: string }
                | undefined;
            if (res.response.ok && data) {
                setSubject(data.subject ?? "");
                setBody(data.body ?? "");
            } else {
                throw new Error(data?.error);
            }
        } catch (error) {
            setError(error instanceof Error ? error.message : "Draft generation failed");
        } finally {
            setGenerating(false);
        }
    }, [analysis, jobDescription, outreachResume, resume]);

    // Auto-generate draft when modal opens
    useEffect(() => {
        if (isOpen && analysis && !subject && !body) {
            handleGenerateDraft();
        }
    }, [isOpen, analysis, subject, body, handleGenerateDraft]);

    const handleSend = useCallback(async () => {
        setLoading(true);
        try {
            // For now, we simulate sending to the candidate's email derived from name or use a placeholder
            // In a real app, resume.email would be verified
            const emailMatch = typeof outreachResume.selfIntro === "string"
                ? outreachResume.selfIntro.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi)
                : null;
            const email = emailMatch ? emailMatch[0] : "candidate@example.com";

            const res = await apiClient.POST("/api/notifications/send", {
                body: {
                    to: email,
                    subject,
                    body,
                },
            });

            const data = (res.response.ok ? res.data : res.error) as
                | { success?: boolean; error?: string }
                | undefined;
            if (res.response.ok) {
                onSuccess?.();
                onClose();
            } else {
                throw new Error(data?.error);
            }
        } catch (error) {
            setError(error instanceof Error ? error.message : "Sending failed");
        } finally {
            setLoading(false);
        }
    }, [outreachResume.selfIntro, subject, body, onSuccess, onClose]);

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
