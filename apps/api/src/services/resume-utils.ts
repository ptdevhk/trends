import type { ResumeItem } from "../types/resume.js";

export function resolveResumeId(resume: ResumeItem, index: number): string {
  if (resume.resumeId) return String(resume.resumeId);
  if (resume.perUserId) return String(resume.perUserId);
  if (resume.profileUrl && resume.profileUrl !== "javascript:;") return resume.profileUrl;
  if (resume.extractedAt) return `${resume.name || "resume"}-${resume.extractedAt}`;
  return `${resume.name || "resume"}-${index}`;
}

export function extractSkills(jobIntention?: string): string[] | undefined {
  if (!jobIntention) return undefined;
  const parts = jobIntention
    .split(/[，,、/\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  return Array.from(new Set(parts)).slice(0, 24);
}

export function extractCompanies(workHistory: ResumeItem["workHistory"]): string[] | undefined {
  if (!workHistory?.length) return undefined;
  const entries = workHistory
    .map((item) => item.raw)
    .filter(Boolean)
    .map((raw) => raw.replace(/^\d[\d\-~至今()年月日\s]*?/g, "").trim())
    .filter(Boolean);
  if (entries.length === 0) return undefined;
  return Array.from(new Set(entries)).slice(0, 12);
}

