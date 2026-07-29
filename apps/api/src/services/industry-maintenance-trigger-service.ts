import { createHash } from "node:crypto";

import {
  normalizeCompanyAlias,
  type IndustryMaintenanceTriggerReason,
} from "@trends/shared";

import {
  resolveCompanyKeysForEmployerSurfaces,
  type EmployerSurfaceResolutionResult,
} from "./company-industry-profile-service.js";
import { upsertIndustryProposal } from "./company-industry-proposal-service.js";
import type { UnresolvedEvent, UnresolvedReason } from "./industry-unresolved-queue.js";

const MAX_SAMPLE_REFERENCES = 10;
const PROPOSAL_UPSERT_CONCURRENCY = 8;

export interface IndustryMaintenanceEvent {
  employerSurface: string;
  companyKey?: string;
  unresolvedReason?: UnresolvedReason;
  nearbyScore?: number;
  directRoleYears?: number;
  resultRank?: number;
  viewDemand?: number;
  currentEvidenceRisk?: number;
  missingApprovedProfile?: boolean;
  evidenceConflict?: boolean;
  workspaceSlug?: string;
  resumeIdentity?: string;
  workEntryFingerprint?: string;
}

export interface IndustryMaintenanceCandidate {
  proposalId: string;
  companyKey?: string;
  normalizedEmployerSurface?: string;
  triggerReasons: IndustryMaintenanceTriggerReason[];
  priority: number;
  sampleReferences: Array<{
    workspaceSlug: string;
    resumeIdentity: string;
    workEntryFingerprint?: string;
  }>;
}

interface TriggerDependencies {
  resolveEmployerSurfaces: (
    surfaces: string[],
  ) => Promise<EmployerSurfaceResolutionResult>;
  upsertProposal: typeof upsertIndustryProposal;
}

function boundedNumber(value: number | undefined, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function stableProposalId(identity: string): string {
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 20);
  return `industry-maintenance-${digest}`;
}

function referenceFromEvent(
  event: IndustryMaintenanceEvent,
): IndustryMaintenanceCandidate["sampleReferences"][number] | null {
  const workspaceSlug = event.workspaceSlug?.trim();
  const resumeIdentity = event.resumeIdentity?.trim();
  const workEntryFingerprint = event.workEntryFingerprint?.trim();
  if (!workspaceSlug || !resumeIdentity) return null;
  return {
    workspaceSlug: workspaceSlug.slice(0, 80),
    resumeIdentity: resumeIdentity.slice(0, 200),
    ...(workEntryFingerprint
      ? { workEntryFingerprint: workEntryFingerprint.slice(0, 160) }
      : {}),
  };
}

function priorityForGroup(events: IndustryMaintenanceEvent[]): number {
  const frequency = events.length;
  const maxNearbyScore = Math.max(
    0,
    ...events.map((event) => boundedNumber(event.nearbyScore, 0, 100)),
  );
  const directRoleYears = Math.max(
    0,
    ...events.map((event) => boundedNumber(event.directRoleYears, 0, 20)),
  );
  const highestViewDemand = Math.max(
    0,
    ...events.map((event) => boundedNumber(event.viewDemand, 0, 100)),
  );
  const currentEvidenceRisk = Math.max(
    0,
    ...events.map((event) => boundedNumber(event.currentEvidenceRisk, 0, 100)),
  );
  const bestRank = Math.min(
    ...events
      .map((event) => event.resultRank)
      .filter(
        (rank): rank is number =>
          typeof rank === "number" && Number.isFinite(rank) && rank > 0,
      ),
    Number.POSITIVE_INFINITY,
  );
  const score =
    20 +
    Math.min(25, Math.max(0, frequency - 1) * 8) +
    maxNearbyScore * 0.2 +
    Math.min(20, directRoleYears * 4) +
    highestViewDemand * 0.1 +
    currentEvidenceRisk * 0.2 +
    (bestRank <= 10 ? 12 : bestRank <= 25 ? 6 : 0) +
    (events.some((event) => event.evidenceConflict) ? 20 : 0) +
    (events.some((event) => event.missingApprovedProfile) ? 10 : 0);
  return Math.round(Math.max(1, Math.min(100, score)));
}

function reasonsForGroup(
  events: IndustryMaintenanceEvent[],
): IndustryMaintenanceTriggerReason[] {
  const reasons = new Set<IndustryMaintenanceTriggerReason>();
  if (events.some((event) => event.unresolvedReason === "miss")) {
    reasons.add("unknown_employer");
  }
  if (
    events.some(
      (event) => event.unresolvedReason === "low_confidence_keyword",
    )
  ) {
    reasons.add("weak_employer_evidence");
  }
  if (events.length >= 3) reasons.add("frequent_employer");
  if (
    events.some(
      (event) =>
        boundedNumber(event.nearbyScore, 0, 100) >= 70 ||
        boundedNumber(event.directRoleYears, 0, 20) >= 2 ||
        boundedNumber(event.viewDemand, 0, 100) >= 50 ||
        (typeof event.resultRank === "number" && event.resultRank <= 25),
    )
  ) {
    reasons.add("high_value_candidate");
  }
  if (events.some((event) => event.missingApprovedProfile)) {
    reasons.add("missing_approved_profile");
  }
  if (events.some((event) => event.evidenceConflict)) {
    reasons.add("evidence_conflict");
  }
  if (reasons.size === 0) reasons.add("unknown_employer");
  return [...reasons].sort();
}

export function buildIndustryMaintenanceCandidates(
  events: IndustryMaintenanceEvent[],
  companyKeysByNormalizedSurface: Map<string, string> = new Map(),
): IndustryMaintenanceCandidate[] {
  const groups = new Map<string, IndustryMaintenanceEvent[]>();
  for (const event of events) {
    const normalizedSurface = normalizeCompanyAlias(event.employerSurface);
    const companyKey =
      event.companyKey?.trim().toLowerCase() ||
      companyKeysByNormalizedSurface.get(normalizedSurface);
    if (!companyKey && !normalizedSurface) continue;
    const groupKey = companyKey ? `company:${companyKey}` : `surface:${normalizedSurface}`;
    const bucket = groups.get(groupKey) ?? [];
    bucket.push({ ...event, ...(companyKey ? { companyKey } : {}) });
    groups.set(groupKey, bucket);
  }

  return [...groups.entries()]
    .map(([groupKey, group]) => {
      const companyKey = group[0]?.companyKey?.trim().toLowerCase();
      const normalizedEmployerSurface = companyKey
        ? undefined
        : normalizeCompanyAlias(group[0]?.employerSurface ?? "");
      const references = new Map<
        string,
        IndustryMaintenanceCandidate["sampleReferences"][number]
      >();
      for (const event of group) {
        const reference = referenceFromEvent(event);
        if (!reference) continue;
        const key = `${reference.workspaceSlug}\u0000${reference.resumeIdentity}\u0000${reference.workEntryFingerprint ?? ""}`;
        references.set(key, reference);
      }
      return {
        proposalId: stableProposalId(groupKey),
        ...(companyKey ? { companyKey } : {}),
        ...(normalizedEmployerSurface ? { normalizedEmployerSurface } : {}),
        triggerReasons: reasonsForGroup(group),
        priority: priorityForGroup(group),
        sampleReferences: [...references.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .slice(0, MAX_SAMPLE_REFERENCES)
          .map(([, reference]) => reference),
      };
    })
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        left.proposalId.localeCompare(right.proposalId),
    );
}

export async function promoteIndustryMaintenanceCandidates(
  events: IndustryMaintenanceEvent[],
  dependencies: Partial<TriggerDependencies> = {},
): Promise<{
  candidates: IndustryMaintenanceCandidate[];
  created: number;
  coalesced: number;
  degradedResolution: boolean;
}> {
  const resolveEmployerSurfaces =
    dependencies.resolveEmployerSurfaces ??
    resolveCompanyKeysForEmployerSurfaces;
  const upsertProposal = dependencies.upsertProposal ?? upsertIndustryProposal;
  const unresolvedSurfaces = events
    .filter((event) => !event.companyKey?.trim())
    .map((event) => event.employerSurface);
  const resolution = await resolveEmployerSurfaces(unresolvedSurfaces);
  const candidates = buildIndustryMaintenanceCandidates(
    events,
    resolution.companyKeysByNormalizedSurface,
  );
  let created = 0;
  let coalesced = 0;
  for (
    let offset = 0;
    offset < candidates.length;
    offset += PROPOSAL_UPSERT_CONCURRENCY
  ) {
    const results = await Promise.all(
      candidates
        .slice(offset, offset + PROPOSAL_UPSERT_CONCURRENCY)
        .map((candidate) =>
          upsertProposal({
            proposalId: candidate.proposalId,
            ...(candidate.companyKey
              ? { companyKey: candidate.companyKey }
              : {}),
            ...(candidate.normalizedEmployerSurface
              ? {
                  normalizedEmployerSurface:
                    candidate.normalizedEmployerSurface,
                }
              : {}),
            triggerReasons: candidate.triggerReasons,
            priority: candidate.priority,
            ...(candidate.sampleReferences.length > 0
              ? { sampleReferences: candidate.sampleReferences }
              : {}),
          }),
        ),
    );
    for (const result of results) {
      if (result.created) created += 1;
      else coalesced += 1;
    }
  }
  return {
    candidates,
    created,
    coalesced,
    degradedResolution: resolution.degraded,
  };
}

export function unresolvedEventsToMaintenanceEvents(
  events: UnresolvedEvent[],
): IndustryMaintenanceEvent[] {
  return events.map((event) => ({
    employerSurface: event.surface,
    unresolvedReason: event.reason,
    ...(event.nearbyScore !== undefined
      ? { nearbyScore: event.nearbyScore }
      : {}),
  }));
}
