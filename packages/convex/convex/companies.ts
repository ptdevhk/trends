/// <reference path="./query-count-augmentation.d.ts" />
// Re-export aggregator (Arch#3).
//
// companies.ts was split into cohesive domain modules; this file keeps the
// `companies:*` Convex wire surface intact by re-exporting every function.
// The codegen'd `api.companies.*` / `internal.companies.*` namespaces and all
// `companies:<name>` path strings used by apps/api remain valid because this
// module still exports every name.
export {
  list,
  getByKey,
  resolveAlias,
  resolveAliasesBatch,
  upsert,
  setCompanyArchived,
  addAlias,
  removeAlias,
  listPoliciesForScope,
  getEffectivePolicy,
  appendPolicyRevision,
  seedCanonicalCompanies,
} from "./company_registry.js";
export {
  listIndustryProfiles,
  getIndustryProfile,
  listVerifiedIndustryEmployerAliases,
  getReviewedIndustryCatalogByKeys,
  upsertIndustryProfile,
  deleteIndustryProfile,
} from "./industry_profiles.js";
export {
  listAffectedResumesByCompany,
  getCompanyBackfillCatalog,
  backfillCompanyResumeLinksByCompany,
  backfillCompanyResumeLinksByCompanySync,
  scheduleCompanyLinkBackfill,
  backfillCompanyResumeLinks,
  resolveIndustryRefreshResumeReference,
} from "./company_resume_links.js";
export type {
  CompanyLinkBackfillHit,
  CompanyLinkBackfillResult,
} from "./company_resume_links.js";
export {
  upsertIndustryProposal,
  listIndustryProposalsPage,
  listIndustryProposals,
  resolveIndustryReviewTargetsForResume,
  recordIndustryRefreshRequest,
  listIndustryRefreshRequests,
  getIndustryProposal,
  setIndustryProposalResearchState,
} from "./industry_proposals.js";
export {
  upsertIndustryEvidenceSource,
  listIndustryEvidenceSources,
  listDueIndustryEvidenceSources,
  markIndustryEvidenceProfilesChecking,
  recordIndustryEvidenceFreshnessCheck,
  listIndustryEvidenceChecks,
} from "./industry_evidence_sources.js";
export {
  approveIndustryProposal,
  autoApproveIndustryProposal,
  undoIndustryProposalApproval,
  resolveIndustryProposal,
  listIndustryVerdictRevisions,
  listAutoApprovedVerdictRevisions,
} from "./industry_verdicts.js";
export {
  getIndustryRecomputeRevisionState,
  startIndustryRecomputeRun,
  getIndustryRecomputeRun,
  listIndustryRecomputeRuns,
  getNextIndustryRecomputeBatch,
  reserveIndustryRecomputePage,
  recordIndustryRecomputeBatchDispatch,
  recordIndustryRecomputeBatchFailure,
  recordIndustryRecomputeBatchReadiness,
  finalizeIndustryRecomputeRun,
  markIndustryRecomputeRunSuperseded,
  retryIndustryRecomputeRun,
  resetIndustryRecomputeRun,
} from "./industry_recompute.js";
export {
  enqueueIndustryEvidenceResearchRequest,
  enqueueScheduledIndustryEvidenceResearchSweep,
  getIndustryEvidenceResearchRequestSummary,
  listIndustryEvidenceResearchRequests,
  claimIndustryEvidenceResearchRequests,
  startAndClaimIndustryEvidenceMaintenanceRun,
  renewIndustryEvidenceResearchRequestLease,
  completeIndustryEvidenceResearchRequest,
  releaseIndustryEvidenceResearchRequests,
  recoverExpiredIndustryEvidenceResearchLeases,
  retryIndustryEvidenceResearchRequest,
  cancelIndustryEvidenceResearchRequest,
} from "./industry_research_requests.js";
export {
  upsertIndustryIdentityCandidate,
  listIndustryIdentityCandidates,
  listAllIndustryIdentityCandidates,
  deleteIndustryIdentityCandidates,
  resolveIndustryProposalIdentity,
  attachProposalToCompany,
} from "./industry_identity.js";
export {
  startIndustryMaintenanceRun,
  claimNextIndustryMaintenanceRun,
  patchIndustryMaintenanceRunContext,
  appendIndustryMaintenanceLedger,
  finishIndustryMaintenanceRun,
  listIndustryMaintenanceRuns,
  getIndustryMaintenanceRun,
  listIndustryMaintenanceLedger,
  findActiveIndustryMaintenanceRun,
} from "./industry_maintenance_runs.js";
export {
  upsertIndustryDataEntry,
  deleteIndustryDataEntry,
  listIndustryDataEntries,
  getIndustryDataEntry,
  appendIndustryDataChange,
  setIndustryDataChangeGitSha,
  listIndustryDataChanges,
  setIndustryMaintenanceSchedulePaused,
  getIndustryMaintenanceSchedulePaused,
} from "./industry_data_entries.js";
export {
  getIndustryCoverageSummary,
  refreshIndustryCoverageProposalCounters,
  refreshIndustryCoverageEvidenceCounters,
  getIndustryCoverageCounters,
} from "./industry_coverage.js";
