type ResumeIdentityLike = {
  resumeId?: string | null
  perUserId?: string | null
  profileId?: string | null
  externalId?: string | null
  profileUrl?: string | null
  extractedAt?: string | null
  name?: string | null
}

export function resolveResumeId(resume: ResumeIdentityLike, index: number): string {
  if (resume.resumeId) return String(resume.resumeId)
  if (resume.perUserId) return String(resume.perUserId)
  if (resume.profileId) return String(resume.profileId)
  if (resume.externalId) return String(resume.externalId)
  if (resume.profileUrl && resume.profileUrl !== 'javascript:;') return resume.profileUrl
  if (resume.extractedAt) return `${resume.name || 'resume'}-${resume.extractedAt}`
  return `${resume.name || 'resume'}-${index}`
}
