import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { DEFAULT_WORKSPACE_SLUG } from "../sessions";
import { normalizeCompanyAlias } from "@trends/shared";

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

/**
 * Resolve the workspace(s) a resume link must be written under.
 *
 * A resume with a stored workspaceSlug belongs to that workspace only.
 * Shared-corpus resumes carry no workspaceSlug; their owning workspace(s)
 * come from resume_digest_statuses (the workspace-scoped candidate status
 * overlay). Resumes with no ownership anywhere fall back to the default
 * workspace. Without this, links for shared-corpus resumes always land in
 * the default workspace and per-workspace recomputes no-op for every other
 * workspace (observed 2026-08-14: hr-workspace approvals never found their
 * affected resumes).
 */
async function resolveResumeWorkspaces(
  ctx: Pick<MutationCtx, "db">,
  resume: Pick<Doc<"resumes">, "_id" | "workspaceSlug">,
): Promise<string[]> {
  const direct = normalizeToken(resume.workspaceSlug);
  if (direct) {
    return [direct];
  }
  const statusRows = await ctx.db
    .query("resume_digest_statuses")
    .withIndex("by_resume", (query) => query.eq("resumeId", resume._id))
    .collect();
  const workspaces = [
    ...new Set(
      statusRows
        .map((row) => normalizeToken(row.workspaceSlug))
        .filter((value): value is string => value !== undefined),
    ),
  ];
  return workspaces.length > 0 ? workspaces : [DEFAULT_WORKSPACE_SLUG];
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

  const workspaces = await resolveResumeWorkspaces(ctx, resume);
  const resumeIdentity =
    normalizeToken(resume.identityKey) ??
    normalizeToken(resume.externalId) ??
    String(resume._id);
  const updatedAt = Date.now();
  const derived = deriveCompanyResumeLinks(ingestData);

  for (const link of derived) {
    const revisionIds = [...link.verdictRevisionIds].sort();
    for (const workspaceSlug of workspaces) {
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

  // Keep content.workHistory stamps in sync with the freshly derived links.
  await stampWorkHistoryCompanyKeys(
    ctx,
    resume,
    derived.map((link) => ({
      companyKey: link.companyKey,
      matchedEmployerSurfaces: [...link.matchedEmployerSurfaces],
      ...(link.verdictRevisionIds.size === 1
        ? { companyKeyRevision: [...link.verdictRevisionIds][0] }
        : {}),
    })),
  );
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

  const workspaces = await resolveResumeWorkspaces(ctx, resume);
  const resumeIdentity =
    normalizeToken(resume.identityKey) ??
    normalizeToken(resume.externalId) ??
    String(resume._id);
  const revisionId = normalizeToken(input.currentVerdictRevisionId);

  for (const workspaceSlug of workspaces) {
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Stamp canonical companyKey links onto a resume's content.workHistory
 * entries so policy evaluation can prefer persisted links over runtime
 * alias re-matching. Entries whose normalized companyName resolves to one of
 * the given matched surfaces get `companyKey` (plus `companyKeyRevision`
 * when the caller has one); a matched entry without a revision has any stale
 * revision cleared. Entries with no matching surface keep their stamps
 * untouched — per-company backfill batches must never clobber the stamps of
 * other companies on multi-company resumes. Callers pass the full derived
 * link set (recompute path) or the per-company backfill batch (backfill
 * path); the surface set drives which entries get stamped.
 */
export async function stampWorkHistoryCompanyKeys(
  ctx: Pick<MutationCtx, "db">,
  resume: Pick<Doc<"resumes">, "_id" | "content">,
  links: Array<{
    companyKey: string;
    matchedEmployerSurfaces: string[];
    companyKeyRevision?: string;
  }>,
): Promise<void> {
  const content = resume.content;
  if (!isRecord(content) || !Array.isArray(content.workHistory)) {
    return;
  }

  const surfaceToLink = new Map<
    string,
    { companyKey: string; companyKeyRevision?: string }
  >();
  for (const link of links) {
    for (const surface of link.matchedEmployerSurfaces) {
      const normalized = normalizeCompanyAlias(surface);
      if (!normalized || surfaceToLink.has(normalized)) {
        continue;
      }
      surfaceToLink.set(normalized, {
        companyKey: link.companyKey,
        ...(link.companyKeyRevision?.trim()
          ? { companyKeyRevision: link.companyKeyRevision.trim() }
          : {}),
      });
    }
  }
  if (surfaceToLink.size === 0) {
    return;
  }

  let changed = false;
  const workHistory = content.workHistory.map((entry) => {
    if (!isRecord(entry) || typeof entry.companyName !== "string") {
      return entry;
    }
    const link = surfaceToLink.get(normalizeCompanyAlias(entry.companyName));
    if (!link) {
      return entry;
    }
    const next = { ...entry };
    if (next.companyKey !== link.companyKey) {
      next.companyKey = link.companyKey;
      changed = true;
    }
    const nextRevision = next.companyKeyRevision;
    if ((nextRevision as string | undefined) !== link.companyKeyRevision) {
      if (link.companyKeyRevision) {
        next.companyKeyRevision = link.companyKeyRevision;
      } else {
        delete next.companyKeyRevision;
      }
      changed = true;
    }
    return next;
  });

  if (!changed) {
    return;
  }
  await ctx.db.patch(resume._id, {
    content: { ...content, workHistory },
  });
}
