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

## Current Status

That follow-up has now landed.

- `screening_sessions` remains the active-session bucket keyed by anonymous `sessionKey`
- explicit saved searches now live in workspace-scoped `search_history` records
- the resume UI exposes explicit save/open actions instead of silent page-load restore
- opening a saved history item applies the saved draft state and updates `lastOpenedAt`

Current saved history records include:

- `workspaceSlug`
- `sessionKey`
- `title`
- `location`
- `keywords`
- `jobDescriptionId`
- `filters`
- `selectedTags`
- `selectedCompanies`
- `selectedExperienceLevel`
- optional `collectionTaskId` / `analysisTaskId`
- optional `notes`
- `createdAt` and `lastOpenedAt`

## Affected Paths

- `apps/web/src/hooks/useSession.ts`
- `apps/web/src/hooks/useResumeListState.ts`
- `apps/web/src/components/SearchHistoryDialog.tsx`
- `packages/convex/convex/sessions.ts`
- `packages/convex/convex/schema.ts`
