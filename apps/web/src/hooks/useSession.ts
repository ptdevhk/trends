import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../../packages/convex/convex/_generated/api';
import type { ResumeFilters } from '@/types/resume';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export type ExternalSessionState = {
  location?: string
  keywords?: string[]
  jobDescriptionId?: string
  filters?: Partial<ResumeFilters>
}

const AUTO_RESTORE_SCREENING_SESSION = false
const DEFAULT_SESSION_LOCATION = ''

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

  const [hasHydratedInitialState, setHasHydratedInitialState] = useState(false);
  const hasInitializedScopeRef = useRef(false)

  // 3. Local State (Initialized from Convex when available)
  const [location, setLocation] = useState(DEFAULT_SESSION_LOCATION);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [jobDescriptionId, setJobDescriptionId] = useState<string | undefined>(undefined);
  const [filters, setFilters] = useState<ResumeFilters>({});

  useEffect(() => {
    if (!hasInitializedScopeRef.current) {
      hasInitializedScopeRef.current = true
      return
    }

    setHasHydratedInitialState(false)
    setLocation(DEFAULT_SESSION_LOCATION)
    setKeywords([])
    setJobDescriptionId(undefined)
    setFilters({})
  }, [slug, sessionKey])

  // 4. Initialization
  useEffect(() => {
    if (!AUTO_RESTORE_SCREENING_SESSION) {
      if (!hasHydratedInitialState) {
        setHasHydratedInitialState(true)
      }
      return
    }

    if (activeSession && !hasHydratedInitialState) {
      setLocation(activeSession.config.location);
      setKeywords(activeSession.config.keywords);
      setJobDescriptionId(activeSession.config.jobDescriptionId);
      setFilters(activeSession.config.filters || {});
      setHasHydratedInitialState(true);
    }
  }, [activeSession, hasHydratedInitialState]);

  // 5. Auto-save (Debounced)
  useEffect(() => {
    if (!sessionKey) return
    if (!hasHydratedInitialState) return;

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
  }, [sessionKey, slug, location, keywords, jobDescriptionId, filters, saveSession, hasHydratedInitialState]);

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
    if (state.location !== undefined) {
      setLocation(state.location.trim())
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

    setHasHydratedInitialState(true)
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
    loading: !hasHydratedInitialState,
  };
}
