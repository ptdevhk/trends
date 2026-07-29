import { createHash } from "node:crypto";

import { getIndustryProfile } from "./company-industry-profile-service.js";
import { upsertIndustryProposal } from "./company-industry-proposal-service.js";
import { config } from "./config.js";
import { callConvexMutation, callConvexQuery } from "./convex-utils.js";

export const INDUSTRY_REFRESH_REASON_CODES = [
  "stale",
  "incomplete",
  "incorrect",
  "other",
] as const;

export type IndustryRefreshReasonCode =
  (typeof INDUSTRY_REFRESH_REASON_CODES)[number];

export interface CompanyIndustryRefreshRequest {
  companyKey: string;
  currentRevisionId: string;
  workspaceSlug: string;
  requesterId: string;
  reasonCode: IndustryRefreshReasonCode;
  note?: string;
  resumeIdentity?: string;
  workEntryFingerprint?: string;
}

function refreshProposalId(companyKey: string, revisionId: string): string {
  const digest = createHash("sha256")
    .update(`${companyKey}\u0000${revisionId}`)
    .digest("hex")
    .slice(0, 20);
  return `industry-refresh-${digest}`;
}

function refreshRequestId(input: {
  companyKey: string;
  currentRevisionId: string;
  workspaceSlug: string;
  requesterId: string;
  reasonCode: IndustryRefreshReasonCode;
  note?: string;
  resumeIdentity?: string;
  workEntryFingerprint?: string;
}): string {
  const digest = createHash("sha256")
    .update(
      [
        input.companyKey,
        input.currentRevisionId,
        input.workspaceSlug,
        input.requesterId,
        input.reasonCode,
        input.note ?? "",
        input.resumeIdentity ?? "",
        input.workEntryFingerprint ?? "",
      ].join("\u0000"),
    )
    .digest("hex")
    .slice(0, 24);
  return `industry-refresh-request-${digest}`;
}

export async function requestCompanyIndustryEvidenceRefresh(
  input: CompanyIndustryRefreshRequest,
): Promise<{
  companyKey: string;
  currentRevisionId: string;
  proposalId: string;
  status: "requested" | "already_pending";
}> {
  const companyKey = input.companyKey.trim().toLowerCase();
  const currentRevisionId = input.currentRevisionId.trim();
  const workspaceSlug = input.workspaceSlug.trim();
  const requesterId = input.requesterId.trim();
  const note = input.note?.trim();
  if (!companyKey || !currentRevisionId || !workspaceSlug || !requesterId) {
    throw new Error(
      "Refresh request requires company, revision, workspace, and requester",
    );
  }
  if (!INDUSTRY_REFRESH_REASON_CODES.includes(input.reasonCode)) {
    throw new Error("Invalid industry evidence refresh reason");
  }
  if (note && note.length > 300) {
    throw new Error("Industry evidence refresh note is limited to 300 characters");
  }
  if (input.reasonCode === "other" && !note) {
    throw new Error("A note is required for the other refresh reason");
  }
  const profile = await getIndustryProfile(companyKey);
  if (!profile?.currentRevisionId) {
    throw new Error(`No approved industry evidence profile for ${companyKey}`);
  }
  if (profile.currentRevisionId !== currentRevisionId) {
    throw new Error("Industry evidence revision is stale; reload before requesting refresh");
  }
  let resumeIdentity = input.resumeIdentity?.trim();
  let workEntryFingerprint = input.workEntryFingerprint?.trim();
  if (resumeIdentity) {
    const reference = await callConvexQuery(
      "companies:resolveIndustryRefreshResumeReference",
      {
        workspaceSlug,
        companyKey,
        verdictRevisionId: currentRevisionId,
        resumeReference: resumeIdentity,
        writeSecret: config.auth.convexWriteSecret,
      },
    );
    if (
      reference === null ||
      typeof reference !== "object" ||
      typeof (reference as { resumeIdentity?: unknown }).resumeIdentity !==
        "string"
    ) {
      throw new Error(
        "Refresh resume reference does not belong to this workspace, company, and revision",
      );
    }
    resumeIdentity = (reference as { resumeIdentity: string }).resumeIdentity;
    workEntryFingerprint =
      typeof (reference as { workEntryFingerprint?: unknown })
        .workEntryFingerprint === "string"
        ? (reference as { workEntryFingerprint: string })
            .workEntryFingerprint
        : workEntryFingerprint;
  }
  const proposal = await upsertIndustryProposal({
    proposalId: refreshProposalId(companyKey, currentRevisionId),
    companyKey,
    triggerReasons: ["recruiter_refresh_request"],
    priority: 100,
    currentRevisionId,
    requestedBy: requesterId,
    materialChangeSummary: [
      `Recruiter refresh reason: ${input.reasonCode}.`,
      note ? `Note: ${note}` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 800),
    ...(resumeIdentity
      ? {
          sampleReferences: [
            {
              workspaceSlug: workspaceSlug.slice(0, 80),
              resumeIdentity: resumeIdentity.slice(0, 200),
              ...(workEntryFingerprint
                ? {
                    workEntryFingerprint:
                      workEntryFingerprint.slice(0, 160),
                  }
                : {}),
            },
          ],
        }
      : {}),
  });
  const requestId = refreshRequestId({
    companyKey,
    currentRevisionId,
    workspaceSlug,
    requesterId,
    reasonCode: input.reasonCode,
    ...(note ? { note } : {}),
    ...(resumeIdentity ? { resumeIdentity } : {}),
    ...(workEntryFingerprint ? { workEntryFingerprint } : {}),
  });
  const recorded = await callConvexMutation(
    "companies:recordIndustryRefreshRequest",
    {
      requestId,
      proposalId: proposal.proposalId,
      companyKey,
      verdictRevisionId: currentRevisionId,
      workspaceSlug,
      requesterId,
      reasonCode: input.reasonCode,
      ...(note ? { note } : {}),
      ...(resumeIdentity ? { resumeIdentity } : {}),
      ...(workEntryFingerprint ? { workEntryFingerprint } : {}),
      writeSecret: config.auth.convexWriteSecret,
    },
  );
  if (
    recorded === null ||
    typeof recorded !== "object" ||
    typeof (recorded as { requestId?: unknown }).requestId !== "string"
  ) {
    throw new Error("Invalid companies:recordIndustryRefreshRequest response");
  }
  return {
    companyKey,
    currentRevisionId,
    proposalId: proposal.proposalId,
    status: proposal.created ? "requested" : "already_pending",
  };
}
