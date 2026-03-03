import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../../packages/convex/convex/_generated/api';
import type { ResumeFilters } from '@/types/resume';
import { toast } from 'sonner';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export type ExternalSessionState = {
  location?: string
  keywords?: string[]
  jobDescriptionId?: string
  filters?: Partial<ResumeFilters>
}

export function useSession() {
  const { slug } = useWorkspace()
  const storageKey = `trends.resume.sessionKey.${slug}`
  const [sessionKey, setSessionKey] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) return stored;
    const newKey = Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem(storageKey, newKey);
    return newKey;
  });

  useEffect(() => {
    const stored = localStorage.getItem(storageKey)
    if (stored) {
      setSessionKey(stored)
      return
    }

    const newKey = Math.random().toString(36).substring(2) + Date.now().toString(36)
    localStorage.setItem(storageKey, newKey)
    setSessionKey(newKey)
  }, [storageKey])

  // 2. Convex Sync
  const activeSession = useQuery(
    api.sessions.getActiveSession,
    sessionKey ? { sessionKey, workspaceSlug: slug } : 'skip'
  );
  const saveSession = useMutation(api.sessions.saveSession);
  const addReviewedItem = useMutation(api.sessions.addReviewedItem);

  const [hasRestored, setHasRestored] = useState(false);

  // 3. Local State (Initialized from Convex when available)
  const [location, setLocation] = useState('广东');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [jobDescriptionId, setJobDescriptionId] = useState<string | undefined>(undefined);
  const [filters, setFilters] = useState<ResumeFilters>({});

  useEffect(() => {
    console.debug('[session-reset]', { slug, sessionKey })
    setHasRestored(false)
    setLocation('广东')
    setKeywords([])
    setJobDescriptionId(undefined)
    setFilters({})
  }, [slug, sessionKey])

  // 4. Initialization (Restore from DB)
  useEffect(() => {
    if (activeSession && !hasRestored) {
      console.debug('[session-restore]', {
        location: activeSession.config.location,
        keywords: activeSession.config.keywords,
        jobDescriptionId: activeSession.config.jobDescriptionId,
      })
      setLocation(activeSession.config.location);
      setKeywords(activeSession.config.keywords);
      setJobDescriptionId(activeSession.config.jobDescriptionId);
      setFilters(activeSession.config.filters || {});
      setHasRestored(true);
      toast.info('已恢复之前的筛选会话', {
        description: `${activeSession.config.location} · ${activeSession.config.keywords.join(', ')}`,
      });
    }
  }, [activeSession, hasRestored]);

  // 5. Auto-save (Debounced)
  useEffect(() => {
    if (!sessionKey) return
    if (!hasRestored) return;

    const timer = setTimeout(() => {
      saveSession({
        sessionKey,
        workspaceSlug: slug,
        location,
        keywords,
        jobDescriptionId,
        filters,
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [sessionKey, slug, location, keywords, jobDescriptionId, filters, saveSession, hasRestored]);

  // 6. Helpers
  const trackReviewedResume = useCallback(
    async (resumeId: string) => {
      if (!sessionKey) return
      await addReviewedItem({ sessionKey, workspaceSlug: slug, resumeId });
    },
    [sessionKey, slug, addReviewedItem]
  );

  const reviewedIdsSet = useMemo(() =>
    new Set(activeSession?.reviewedResumeIds || []),
    [activeSession?.reviewedResumeIds]
  );

  const applyExternalState = useCallback((state: ExternalSessionState) => {
    console.debug('[session-applyExternalState]', state)
    if (state.location !== undefined) {
      const normalizedLocation = state.location.trim()
      if (normalizedLocation.length > 0) {
        setLocation(normalizedLocation)
      }
    }

    if (state.keywords !== undefined) {
      const normalizedKeywords = state.keywords
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0)
      setKeywords(normalizedKeywords)
    }

    if (state.jobDescriptionId !== undefined) {
      const normalizedJobDescriptionId = state.jobDescriptionId.trim()
      setJobDescriptionId(normalizedJobDescriptionId.length > 0 ? normalizedJobDescriptionId : undefined)
    }

    if (state.filters !== undefined) {
      setFilters(state.filters)
    }

    setHasRestored(true)
  }, [setFilters, setJobDescriptionId, setKeywords, setLocation])

  return {
    location,
    setLocation,
    keywords,
    setKeywords,
    jobDescriptionId,
    setJobDescriptionId,
    filters,
    setFilters,
    reviewedIdsSet,
    trackReviewedResume,
    applyExternalState,
    loading: !activeSession && !hasRestored,
  };
}
