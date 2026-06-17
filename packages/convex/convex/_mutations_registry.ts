/**
 * Registry of Convex mutations and their quiesce-awareness status.
 *
 * When adding a new public mutation (exported `mutation(...)`), add an entry here.
 * `quiesceAware: true` means the mutation is covered by the maintenance mode
 * quiesce (either via the BFF middleware or a direct entry-point guard).
 * `quiesceAware: false` with a reason means it's intentionally excluded — e.g.
 * the system_settings toggle itself, or migration mutations that must run
 * during a restore window.
 *
 * Internal mutations (`internalMutation(...)`) are NOT user-reachable via the
 * BFF and are intentionally excluded from this registry.
 *
 * Enforced by `scripts/check-mutation-entry-points.sh` via `make check`.
 */
export interface MutationRegistryEntry {
    /** File name (basename) under packages/convex/convex/ */
    file: string;
    /** Exported function name */
    name: string;
    /** Whether this mutation is covered by maintenance mode quiesce */
    quiesceAware: boolean;
    /** Brief explanation, especially when quiesceAware is false */
    reason?: string;
}

export const MUTATIONS_REGISTRY: MutationRegistryEntry[] = [
    // ---------------------------------------------------------------------
    // Quiesce toggle — must NOT be blocked by itself.
    // ---------------------------------------------------------------------
    { file: "system_settings.ts", name: "set", quiesceAware: false, reason: "This IS the quiesce toggle — must not block itself" },

    // ---------------------------------------------------------------------
    // Migration mutations — must run during restore to complete the upgrade.
    // ---------------------------------------------------------------------
    { file: "migrations.ts", name: "backfillSearchText", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "reindexSearchText", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "backfillAge", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "backfillWorkspaceSlugs", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "backfillPrimaryRuleScore", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "backfillEvidenceText", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "backfillJob5156ProfileUrls", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "backfillJob5156WorkHistoryEducation", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "backfillJob5156LocationHierarchy", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "backfillManual51jobStructuredContent", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "auditDuplicateResumesByIdentity", quiesceAware: false, reason: "Migration audit helper — must run during restore" },
    { file: "migrations.ts", name: "backfillTaggingEnvelope", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "mergeDuplicateResumesByIdentity", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "backfillSourceKey", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "backfillVerifiedRoleYears", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "backfillSearchProfileTemplateHash", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "removeScreeningSessionCollectUrl", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "backfillMarketField", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "backfillSeekNameSearchUrls", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "backfillAnalysesValidator", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "migrations.ts", name: "backfillAuditLogActorIdentity", quiesceAware: false, reason: "Migration — must run during restore" },

    // Backfill in resumes_search.ts — same migration semantics as migrations.ts entries.
    { file: "resumes_search.ts", name: "backfillResumeDigests", quiesceAware: false, reason: "Migration — must run during restore" },

    // ---------------------------------------------------------------------
    // Scheduler dispatch + submit — direct guards in the handler (Task 3).
    // ---------------------------------------------------------------------
    { file: "analysis_tasks.ts", name: "dispatch", quiesceAware: true, reason: "Direct guard in handler (Task 3)" },
    { file: "resume_tasks.ts", name: "dispatch", quiesceAware: true, reason: "Direct guard in handler (Task 3)" },
    { file: "resume_tasks.ts", name: "submitResumes", quiesceAware: true, reason: "Direct guard in handler (Task 3)" },

    // ---------------------------------------------------------------------
    // User-facing mutations — covered by BFF maintenance middleware (Task 4).
    // ---------------------------------------------------------------------
    { file: "ai_summary_cache.ts", name: "upsert", quiesceAware: true, reason: "Blocked by BFF middleware" },

    { file: "ai_tagging_results.ts", name: "enqueueBatch", quiesceAware: true, reason: "Blocked by BFF middleware" },

    { file: "analysis_tasks.ts", name: "cancel", quiesceAware: true, reason: "Blocked by BFF middleware" },

    { file: "audit.ts", name: "submitAppeal", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "audit.ts", name: "setAuditOutcome", quiesceAware: true, reason: "Blocked by BFF middleware" },

    { file: "candidate_blocks.ts", name: "upsert", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "candidate_blocks.ts", name: "updateReason", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "candidate_blocks.ts", name: "bulkUpsert", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "candidate_blocks.ts", name: "remove", quiesceAware: true, reason: "Blocked by BFF middleware" },

    { file: "candidate_status.ts", name: "upsert", quiesceAware: true, reason: "Blocked by BFF middleware" },

    { file: "job_descriptions.ts", name: "create", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "job_descriptions.ts", name: "update", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "job_descriptions.ts", name: "delete_jd", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "job_descriptions.ts", name: "delete_batch", quiesceAware: true, reason: "Blocked by BFF middleware" },

    { file: "resume_tasks.ts", name: "claim", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "resume_tasks.ts", name: "heartbeat", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "resume_tasks.ts", name: "failStalePending", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "resume_tasks.ts", name: "updateProgress", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "resume_tasks.ts", name: "complete", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "resume_tasks.ts", name: "cancel", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "resume_tasks.ts", name: "resetDatabase", quiesceAware: true, reason: "Blocked by BFF middleware" },

    { file: "resumes_mutations.ts", name: "clearAnalyses", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "resumes_mutations.ts", name: "deleteResumes", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "resumes_mutations.ts", name: "archiveResumes", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "resumes_mutations.ts", name: "unarchiveResumes", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "resumes_mutations.ts", name: "hardResetIngestData", quiesceAware: true, reason: "Blocked by BFF middleware" },

    { file: "resumes_search.ts", name: "upsertResumeDigestForTest", quiesceAware: true, reason: "Test-only helper — Blocked by BFF middleware" },

    { file: "search_alerts.ts", name: "create", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "search_alerts.ts", name: "toggle", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "search_alerts.ts", name: "remove", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "search_alerts.ts", name: "markNotified", quiesceAware: true, reason: "Blocked by BFF middleware" },

    { file: "search_profiles.ts", name: "create", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "search_profiles.ts", name: "update", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "search_profiles.ts", name: "remove", quiesceAware: true, reason: "Blocked by BFF middleware" },

    { file: "seed.ts", name: "seedJobDescriptions", quiesceAware: true, reason: "Admin/seed helper — Blocked by BFF middleware" },
    { file: "seed.ts", name: "seedResumes", quiesceAware: true, reason: "Admin/seed helper — Blocked by BFF middleware" },
    { file: "seed.ts", name: "seedWorkspaceDemoData", quiesceAware: true, reason: "Admin/seed helper — Blocked by BFF middleware" },
    { file: "seed.ts", name: "clearWorkspaceData", quiesceAware: true, reason: "Admin/seed helper — Blocked by BFF middleware" },
    { file: "seed.ts", name: "clearWorkspaceDemoResumes", quiesceAware: true, reason: "Admin/seed helper — Blocked by BFF middleware" },
    { file: "seed.ts", name: "clearAll", quiesceAware: true, reason: "Admin/seed helper — Blocked by BFF middleware" },

    { file: "sessions.ts", name: "saveSession", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "sessions.ts", name: "addReviewedItem", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "sessions.ts", name: "archiveSession", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "sessions.ts", name: "saveSearchHistory", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "sessions.ts", name: "markSearchHistoryOpened", quiesceAware: true, reason: "Blocked by BFF middleware" },

    { file: "sync_events.ts", name: "recordError", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "sync_events.ts", name: "cleanup", quiesceAware: true, reason: "Blocked by BFF middleware" },

    { file: "taxonomy_clusters.ts", name: "upsert", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "taxonomy_clusters.ts", name: "remove", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "taxonomy_clusters.ts", name: "suggest", quiesceAware: true, reason: "Blocked by BFF middleware" },

    { file: "workspace_config.ts", name: "upsert", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "workspace_config.ts", name: "remove", quiesceAware: true, reason: "Blocked by BFF middleware" },
];
