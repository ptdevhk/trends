
import { useQuery } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import type { ResumeItem } from './useResumes'

export function useConvexResumes(limit: number = 200) {
    const convexResumes = useQuery(api.resumes.list, { limit })

    const mappedResumes = (convexResumes || []).map((doc: any) => ({
        ...doc.content,
        resumeId: doc._id,
        externalId: doc.externalId,
        crawledAt: doc.crawledAt,
        // Ensure we preserve the analysis if it exists
        analysis: doc.analysis,
        // Add compatibility fields if needed
        source: doc.source,
        tags: doc.tags,
    }))

    return {
        resumes: mappedResumes as ResumeItem[],
        loading: convexResumes === undefined,
    }
}
