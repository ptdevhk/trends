import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { DEFAULT_WORKSPACE_SLUG } from "../sessions";

type IngestData = NonNullable<Doc<"resumes">["ingestData"]>;

type CompanyResumeLinkAccumulator = {
  companyKey: string;
  matchedEmployerSurfaces: Set<string>;
  workEntryFingerprints: Set<string>;
  verdictRevisionIds: Set<string>;
};

function normalizeToken(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function deriveWorkEntryFingerprint(entry: {
  companyKey?: string;
  companyName?: string;
  jobTitle?: string;
  workEntryFingerprint?: string;
}): string | undefined {
  const explicit = normalizeToken(entry.workEntryFingerprint);
  if (explicit) {
    return explicit;
  }

  const parts = [
    normalizeToken(entry.companyKey),
    normalizeToken(entry.companyName),
    normalizeToken(entry.jobTitle),
  ].filter((value): value is string => value !== undefined);
  return parts.length > 0 ? parts.join("|").toLowerCase() : undefined;
}

export { deriveWorkEntryFingerprint };

function deriveCompanyResumeLinks(ingestData: IngestData): CompanyResumeLinkAccumulator[] {
  const linksByCompany = new Map<string, CompanyResumeLinkAccumulator>();

  for (const roleSignal of ingestData.roleSignals ?? []) {
    for (const workEntry of roleSignal.matchedWorkEntries ?? []) {
      const companyKey = normalizeToken(workEntry.companyKey)?.toLowerCase();
      if (!companyKey) {
        continue;
      }

      let link = linksByCompany.get(companyKey);
      if (!link) {
        link = {
          companyKey,
          matchedEmployerSurfaces: new Set<string>(),
          workEntryFingerprints: new Set<string>(),
          verdictRevisionIds: new Set<string>(),
        };
        linksByCompany.set(companyKey, link);
      }

      const employerSurface = normalizeToken(workEntry.companyName);
      if (employerSurface) {
        link.matchedEmployerSurfaces.add(employerSurface);
      }

      const workEntryFingerprint = deriveWorkEntryFingerprint(workEntry);
      if (workEntryFingerprint) {
        link.workEntryFingerprints.add(workEntryFingerprint);
      }

      const verdictRevisionId = normalizeToken(workEntry.verdictRevisionId);
      if (verdictRevisionId) {
        link.verdictRevisionIds.add(verdictRevisionId);
      }
    }
  }

  return [...linksByCompany.values()].sort((left, right) =>
    left.companyKey.localeCompare(right.companyKey),
  );
}

export async function replaceCompanyResumeLinksForResume(
  ctx: Pick<MutationCtx, "db">,
  resume: Doc<"resumes">,
  ingestData: IngestData,
): Promise<void> {
  const existing = await ctx.db
    .query("company_resume_links")
    .withIndex("by_resume", (query) => query.eq("resumeId", resume._id))
    .collect();

  for (const row of existing) {
    await ctx.db.delete(row._id);
  }

  const workspaceSlug =
    normalizeToken(resume.workspaceSlug) ?? DEFAULT_WORKSPACE_SLUG;
  const resumeIdentity =
    normalizeToken(resume.identityKey) ??
    normalizeToken(resume.externalId) ??
    String(resume._id);
  const updatedAt = Date.now();

  for (const link of deriveCompanyResumeLinks(ingestData)) {
    const revisionIds = [...link.verdictRevisionIds].sort();
    await ctx.db.insert("company_resume_links", {
      workspaceSlug,
      companyKey: link.companyKey,
      resumeId: resume._id,
      resumeIdentity,
      matchedEmployerSurfaces: [...link.matchedEmployerSurfaces].sort((left, right) =>
        left.localeCompare(right),
      ),
      workEntryFingerprints: [...link.workEntryFingerprints].sort((left, right) =>
        left.localeCompare(right),
      ),
      ...(revisionIds.length === 1
        ? { currentVerdictRevisionId: revisionIds[0] }
        : {}),
      updatedAt,
    });
  }
}

/**
 * Idempotent upsert of a single company→resume link for the backfill flow
 * (delete existing link for this resume+company, then insert the fresh row).
 *
 * `currentVerdictRevisionId` is deliberately passed by the caller: backfilled
 * links for resumes that were never computed under the company's verdict must
 * omit it, so the affected list classifies them as stale and a targeted
 * recompute picks them up.
 */
export async function upsertCompanyResumeLinkForCompany(
  ctx: Pick<MutationCtx, "db">,
  resume: Pick<Doc<"resumes">, "_id" | "workspaceSlug" | "identityKey" | "externalId">,
  input: {
    companyKey: string;
    matchedEmployerSurfaces: string[];
    workEntryFingerprints: string[];
    currentVerdictRevisionId?: string;
  },
): Promise<void> {
  const existing = await ctx.db
    .query("company_resume_links")
    .withIndex("by_resume", (query) => query.eq("resumeId", resume._id))
    .filter((query) => query.eq(query.field("companyKey"), input.companyKey))
    .collect();

  for (const row of existing) {
    await ctx.db.delete(row._id);
  }

  const workspaceSlug =
    normalizeToken(resume.workspaceSlug) ?? DEFAULT_WORKSPACE_SLUG;
  const resumeIdentity =
    normalizeToken(resume.identityKey) ??
    normalizeToken(resume.externalId) ??
    String(resume._id);
  const revisionId = normalizeToken(input.currentVerdictRevisionId);

  await ctx.db.insert("company_resume_links", {
    workspaceSlug,
    companyKey: input.companyKey,
    resumeId: resume._id,
    resumeIdentity,
    matchedEmployerSurfaces: Array.from(new Set(input.matchedEmployerSurfaces))
      .filter((surface): surface is string => Boolean(surface?.trim()))
      .sort((left, right) => left.localeCompare(right)),
    workEntryFingerprints: Array.from(new Set(input.workEntryFingerprints))
      .filter((fingerprint): fingerprint is string => Boolean(fingerprint?.trim()))
      .sort((left, right) => left.localeCompare(right)),
    ...(revisionId ? { currentVerdictRevisionId: revisionId } : {}),
    updatedAt: Date.now(),
  });
}
