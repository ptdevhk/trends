import type { ResumeItem } from "../types/resume.js";

export function resolveResumeId(resume: ResumeItem, index: number): string {
  if (resume.resumeId) return String(resume.resumeId);
  if (resume.perUserId) return String(resume.perUserId);
  if (resume.profileId) return String(resume.profileId);
  if (resume.externalId) return String(resume.externalId);
  if (resume.profileUrl && resume.profileUrl !== "javascript:;") return resume.profileUrl;
  if (resume.extractedAt) return `${resume.name || "resume"}-${resume.extractedAt}`;
  return `${resume.name || "resume"}-${index}`;
}
