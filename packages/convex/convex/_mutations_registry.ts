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
    { file: "system_settings.ts", name: "setResumeWorkHistoryLimit", quiesceAware: true, reason: "System-setting write is blocked by the BFF maintenance middleware" },

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
    { file: "migrations.ts", name: "backfillResumeAnalysesStatus", quiesceAware: false, reason: "Migration — must run during restore" },

    // Backfill in resumes_search.ts — same migration semantics as migrations.ts entries.
    { file: "resumes_search.ts", name: "backfillResumeDigests", quiesceAware: false, reason: "Migration — must run during restore" },
    { file: "resumes_search.ts", name: "backfillResumeDigestStatuses", quiesceAware: false, reason: "Migration backfill — must run during restore" },
    { file: "resumes_search.ts", name: "backfillResumeAnalyses", quiesceAware: false, reason: "Migration backfill — must run during restore" },

    // ---------------------------------------------------------------------
    // Scheduler dispatch + submit — direct guards in the handler (Task 3).
    // ---------------------------------------------------------------------
    { file: "analysis_tasks.ts", name: "dispatch", quiesceAware: true, reason: "Direct guard in handler (Task 3)" },
    { file: "analysis_tasks.ts", name: "dispatchExact", quiesceAware: true, reason: "Admin exact-cohort dispatch with write-secret, workspace, and atomic target guards" },
    { file: "ingest_agent.ts", name: "scheduleExactReingest", quiesceAware: true, reason: "Admin-only exact re-ingest scheduler with direct write-secret and workspace guards" },
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

    { file: "company_registry.ts", name: "upsert", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "company_registry.ts", name: "setCompanyArchived", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "company_registry.ts", name: "addAlias", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "company_registry.ts", name: "removeAlias", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "company_registry.ts", name: "appendPolicyRevision", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "company_resume_links.ts", name: "backfillCompanyResumeLinks", quiesceAware: true, reason: "Admin industry-link backfill via write-secret and BFF maintenance guard" },
    { file: "company_registry.ts", name: "seedCanonicalCompanies", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "industry_profiles.ts", name: "upsertIndustryProfile", quiesceAware: true, reason: "Admin industry-evidence stewardship via write-secret and BFF middleware" },
    { file: "industry_profiles.ts", name: "deleteIndustryProfile", quiesceAware: true, reason: "Admin industry-evidence stewardship via write-secret and BFF middleware" },
    { file: "industry_proposals.ts", name: "upsertIndustryProposal", quiesceAware: true, reason: "Industry maintenance proposal write via write-secret and BFF middleware" },
    { file: "industry_proposals.ts", name: "recordIndustryRefreshRequest", quiesceAware: true, reason: "Authenticated workspace refresh request ledger via write-secret and BFF maintenance guard" },
    { file: "industry_proposals.ts", name: "setIndustryProposalResearchState", quiesceAware: true, reason: "Industry maintenance worker state via write-secret and BFF maintenance guard" },
    { file: "industry_evidence_sources.ts", name: "upsertIndustryEvidenceSource", quiesceAware: true, reason: "Industry evidence write via write-secret and BFF/worker maintenance guard" },
    { file: "industry_evidence_sources.ts", name: "markIndustryEvidenceProfilesChecking", quiesceAware: true, reason: "Industry freshness maintenance via write-secret and BFF/worker maintenance guard" },
    { file: "industry_evidence_sources.ts", name: "recordIndustryEvidenceFreshnessCheck", quiesceAware: true, reason: "Industry freshness maintenance via write-secret and BFF/worker maintenance guard" },
    { file: "industry_verdicts.ts", name: "approveIndustryProposal", quiesceAware: true, reason: "Attended admin approval via write-secret and BFF middleware" },
    { file: "industry_verdicts.ts", name: "autoApproveIndustryProposal", quiesceAware: true, reason: "Governed Lane A auto-verify via write-secret and BFF/script maintenance guard" },
    { file: "industry_verdicts.ts", name: "resolveIndustryProposal", quiesceAware: true, reason: "Attended admin review via write-secret and BFF middleware" },
    { file: "industry_identity.ts", name: "deleteIndustryIdentityCandidates", quiesceAware: true, reason: "Admin junk-candidate prune via write-secret and BFF/script maintenance guard" },
    { file: "industry_coverage.ts", name: "refreshIndustryCoverageProposalCounters", quiesceAware: true, reason: "Precomputed coverage counters refresh (proposal scan) via write-secret and BFF maintenance guard" },
    { file: "industry_coverage.ts", name: "refreshIndustryCoverageEvidenceCounters", quiesceAware: true, reason: "Precomputed coverage counters refresh (evidence scan) via write-secret and BFF maintenance guard" },
    { file: "industry_recompute.ts", name: "startIndustryRecomputeRun", quiesceAware: true, reason: "Targeted exact reingest orchestration via write-secret and BFF middleware" },
    { file: "industry_recompute.ts", name: "reserveIndustryRecomputePage", quiesceAware: true, reason: "Targeted exact reingest orchestration via write-secret and BFF middleware" },
    { file: "industry_recompute.ts", name: "recordIndustryRecomputeBatchDispatch", quiesceAware: true, reason: "Targeted exact reingest orchestration via write-secret and BFF middleware" },
    { file: "industry_recompute.ts", name: "recordIndustryRecomputeBatchFailure", quiesceAware: true, reason: "Targeted exact reingest orchestration via write-secret and BFF middleware" },
    { file: "industry_recompute.ts", name: "recordIndustryRecomputeBatchReadiness", quiesceAware: true, reason: "Targeted exact reingest orchestration via write-secret and BFF middleware" },
    { file: "industry_recompute.ts", name: "finalizeIndustryRecomputeRun", quiesceAware: true, reason: "Targeted exact reingest orchestration via write-secret and BFF middleware" },
    { file: "industry_recompute.ts", name: "markIndustryRecomputeRunSuperseded", quiesceAware: true, reason: "Targeted exact reingest orchestration via write-secret and BFF middleware" },
    { file: "industry_recompute.ts", name: "retryIndustryRecomputeRun", quiesceAware: true, reason: "Attended targeted recompute retry via write-secret and BFF middleware" },
    { file: "industry_recompute.ts", name: "resetIndustryRecomputeRun", quiesceAware: true, reason: "Attended recompute-run reset (recovery) via write-secret and BFF admin middleware" },

    // Industry evidence research, identity review, and maintenance ledger —
    // all are write-secret gated and enter through the BFF or worker
    // maintenance path, so maintenance quiesce applies.
    { file: "industry_verdicts.ts", name: "undoIndustryProposalApproval", quiesceAware: true, reason: "Attended admin undo via write-secret and BFF middleware" },
    { file: "industry_research_requests.ts", name: "enqueueIndustryEvidenceResearchRequest", quiesceAware: true, reason: "Industry research queue write via write-secret and maintenance middleware" },
    { file: "industry_research_requests.ts", name: "enqueueScheduledIndustryEvidenceResearchSweep", quiesceAware: true, reason: "Scheduled research queue write via write-secret and worker maintenance guard" },
    { file: "industry_research_requests.ts", name: "claimIndustryEvidenceResearchRequests", quiesceAware: true, reason: "Worker research lease claim via write-secret and maintenance guard" },
    { file: "industry_research_requests.ts", name: "startAndClaimIndustryEvidenceMaintenanceRun", quiesceAware: true, reason: "Industry maintenance orchestration via write-secret and worker maintenance guard" },
    { file: "industry_research_requests.ts", name: "renewIndustryEvidenceResearchRequestLease", quiesceAware: true, reason: "Worker research lease renewal via write-secret and maintenance guard" },
    { file: "industry_research_requests.ts", name: "completeIndustryEvidenceResearchRequest", quiesceAware: true, reason: "Worker research completion via write-secret and maintenance guard" },
    { file: "industry_research_requests.ts", name: "releaseIndustryEvidenceResearchRequests", quiesceAware: true, reason: "Worker research lease release via write-secret and maintenance guard" },
    { file: "industry_research_requests.ts", name: "recoverExpiredIndustryEvidenceResearchLeases", quiesceAware: true, reason: "Worker research lease recovery via write-secret and maintenance guard" },
    { file: "industry_research_requests.ts", name: "retryIndustryEvidenceResearchRequest", quiesceAware: true, reason: "Attended research retry via write-secret and maintenance middleware" },
    { file: "industry_research_requests.ts", name: "cancelIndustryEvidenceResearchRequest", quiesceAware: true, reason: "Attended research cancellation via write-secret and maintenance middleware" },
    { file: "industry_identity.ts", name: "upsertIndustryIdentityCandidate", quiesceAware: true, reason: "Identity candidate write via write-secret and maintenance middleware" },
    { file: "industry_identity.ts", name: "resolveIndustryProposalIdentity", quiesceAware: true, reason: "Attended identity resolution via write-secret and maintenance middleware" },
    { file: "industry_identity.ts", name: "attachProposalToCompany", quiesceAware: true, reason: "Attended proposal attachment via write-secret and maintenance middleware" },
    { file: "industry_maintenance_runs.ts", name: "startIndustryMaintenanceRun", quiesceAware: true, reason: "Industry maintenance orchestration via write-secret and maintenance middleware" },
    { file: "industry_maintenance_runs.ts", name: "claimNextIndustryMaintenanceRun", quiesceAware: true, reason: "Worker maintenance claim via write-secret and maintenance guard" },
    { file: "industry_maintenance_runs.ts", name: "patchIndustryMaintenanceRunContext", quiesceAware: true, reason: "Industry maintenance ledger context via write-secret and maintenance guard" },
    { file: "industry_maintenance_runs.ts", name: "appendIndustryMaintenanceLedger", quiesceAware: true, reason: "Industry maintenance ledger write via write-secret and maintenance guard" },
    { file: "industry_maintenance_runs.ts", name: "finishIndustryMaintenanceRun", quiesceAware: true, reason: "Worker maintenance completion via write-secret and maintenance guard" },
    { file: "industry_data_entries.ts", name: "upsertIndustryDataEntry", quiesceAware: true, reason: "Admin industry data write via write-secret and BFF middleware" },
    { file: "industry_data_entries.ts", name: "deleteIndustryDataEntry", quiesceAware: true, reason: "Admin industry data delete via write-secret and BFF middleware" },
    { file: "industry_data_entries.ts", name: "appendIndustryDataChange", quiesceAware: true, reason: "Admin industry data audit write via write-secret and BFF middleware" },
    { file: "industry_data_entries.ts", name: "setIndustryDataChangeGitSha", quiesceAware: true, reason: "Admin industry data audit annotation via write-secret and BFF middleware" },
    { file: "industry_data_entries.ts", name: "setIndustryMaintenanceSchedulePaused", quiesceAware: true, reason: "Admin maintenance schedule control via write-secret and BFF middleware" },

    { file: "candidate_status.ts", name: "upsert", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "candidate_status.ts", name: "importNotesBatch", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "candidate_status.ts", name: "restoreBatch", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "candidate_status.ts", name: "clearWorkspace", quiesceAware: true, reason: "Test/seed helper — write-secret gated; user-facing path blocked by BFF middleware" },
    { file: "candidate_status.ts", name: "stampWorkspaceByExternalIds", quiesceAware: true, reason: "Admin/workspace stamp via write-secret; user-facing path blocked by BFF middleware" },

    { file: "job_descriptions.ts", name: "create", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "job_descriptions.ts", name: "update", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "job_descriptions.ts", name: "delete_jd", quiesceAware: true, reason: "Blocked by BFF middleware" },
    { file: "job_descriptions.ts", name: "delete_batch", quiesceAware: true, reason: "Blocked by BFF middleware" },

    { file: "research_news.ts", name: "upsertItem", quiesceAware: true, reason: "Showcase seed is blocked by BFF middleware; scheduled research ingest skips during maintenance via apps/worker/tasks.py" },

    { file: "research_ops.ts", name: "startIngestRun", quiesceAware: true, reason: "Research ingest and parity writers run only after the worker maintenance-mode check" },
    { file: "research_ops.ts", name: "finishIngestRun", quiesceAware: true, reason: "Research ingest and parity writers run only after the worker maintenance-mode check" },
    { file: "research_ops.ts", name: "recordParityRun", quiesceAware: true, reason: "Research ingest and parity writers run only after the worker maintenance-mode check" },

    { file: "research_signals.ts", name: "upsert", quiesceAware: true, reason: "Showcase seed is blocked by BFF middleware; scheduled research ingest skips during maintenance via apps/worker/tasks.py" },
    { file: "research_signals.ts", name: "deleteByCompanyIngestRunPrefix", quiesceAware: true, reason: "Showcase cleanup is only reachable through BFF-maintained research seed flows" },
    { file: "research_signals.ts", name: "deleteByIngestRunPrefix", quiesceAware: true, reason: "Demo purge is only reachable through BFF-maintained research ops routes" },

    { file: "web_research.ts", name: "recordUse", quiesceAware: true, reason: "Web-research quota write is write-secret gated and worker-maintenance controlled" },

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
