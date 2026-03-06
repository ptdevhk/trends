# Release Note: Disable Hidden Screening Session Restore

Date: 2026-03-06
Area: Resume Search Session UX (`apps/web/src/hooks/useSession.ts`)

## What Changed

Automatic restore of the previous screening session has been disabled.

- Old behavior: opening `/dev/resumes` could silently rehydrate old location, keyword, JD, and filter state from `screening_sessions`, then show `已恢复之前的筛选会话`.
- New behavior: the page starts fresh on load, while still keeping the anonymous `sessionKey` and backend session persistence for future explicit history features.

## Why

The previous behavior acted like hidden state injection, not explicit search history.

For resume search, the expected mental model is closer to:

- Google search history: explicit prior searches, not surprise query replay
- Chat history: explicit thread/session list, not silent overwrite of the current draft

## Follow-Up Direction

Current `screening_sessions` is only an active-session bucket keyed by anonymous `sessionKey`.

The next design should move to explicit history records with:

- `sessionKey` as the browser/thread identity
- optional `taskId` linkage for collection / deep-search runs
- explicit timestamps and titles
- optional user notes
- explicit "open this history item" behavior instead of auto-restore on page load

## Affected Paths

- `apps/web/src/hooks/useSession.ts`
- `packages/convex/convex/sessions.ts`
- `packages/convex/convex/schema.ts`
