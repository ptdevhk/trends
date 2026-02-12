import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../packages/convex/convex/_generated/api';
import type { ResumeFilters } from '@/types/resume';
import { toast } from 'sonner';

const STORAGE_KEY = 'trends.resume.sessionKey';

export function useSession() {
  // 1. Session Key (Persistent in LocalStorage)
  const [sessionKey] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
    const newKey = Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem(STORAGE_KEY, newKey);
    return newKey;
  });

  // 2. Convex Sync
  const activeSession = useQuery(api.sessions.getActiveSession, { sessionKey });
  const saveSession = useMutation(api.sessions.saveSession);
  const addReviewedItem = useMutation(api.sessions.addReviewedItem);

  const [hasRestored, setHasRestored] = useState(false);

  // 3. Local State (Initialized from Convex when available)
  const [location, setLocation] = useState('广东');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [jobDescriptionId, setJobDescriptionId] = useState<string | undefined>(undefined);
  const [filters, setFilters] = useState<ResumeFilters>({});

  // 4. Initialization (Restore from DB)
  useEffect(() => {
    if (activeSession && !hasRestored) {
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
    if (!hasRestored) return;

    const timer = setTimeout(() => {
      saveSession({
        sessionKey,
        location,
        keywords,
        jobDescriptionId,
        filters,
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [sessionKey, location, keywords, jobDescriptionId, filters, saveSession, hasRestored]);

  // 6. Helpers
  const trackReviewedResume = useCallback(
    async (resumeId: string) => {
      await addReviewedItem({ sessionKey, resumeId });
    },
    [sessionKey, addReviewedItem]
  );

  const reviewedIdsSet = useMemo(() =>
    new Set(activeSession?.reviewedResumeIds || []),
    [activeSession?.reviewedResumeIds]
  );

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
    loading: !activeSession && !hasRestored,
  };
}
