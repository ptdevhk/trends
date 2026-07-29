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
