import { isRecord, policyEffectsFromPreset, type CompanyPolicyPreset } from "@trends/shared";

import { callConvexMutation, callConvexQuery } from "./convex-utils.js";
import { config } from "./config.js";

export type CompanyRecord = {
  _id: string;
  companyKey: string;
  status: string;
  displayName: string;
  nameCn?: string;
  nameEn?: string;
  mergedIntoCompanyKey?: string;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  /** Soft-delete marker; set → the company is archived (hidden from default list). */
  archivedAt?: number;
  aliases: Array<{ aliasDisplay: string; aliasNormalized: string; source: string }>;
};

export type CompanyPolicyRecord = {
  companyKey: string;
  displayName: string;
  nameCn?: string;
  nameEn?: string;
  status: string;
  scopeType: string;
  scopeId: string;
  revision: number;
  effects: {
    visibility?: string;
    workflow?: string;
    rankingEffect?: string;
    reasonCodes?: string[];
    summary?: string;
  } | null;
  createdAt: number;
  createdBy?: string;
};

function parseCompany(value: unknown): CompanyRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const companyKey = typeof value.companyKey === "string" ? value.companyKey : "";
  const displayName = typeof value.displayName === "string" ? value.displayName : "";
  if (!companyKey || !displayName) {
    return null;
  }
  const aliases = Array.isArray(value.aliases)
    ? value.aliases
        .map((item) => {
          if (!isRecord(item)) {
            return null;
          }
          const aliasDisplay = typeof item.aliasDisplay === "string" ? item.aliasDisplay : "";
          const aliasNormalized =
            typeof item.aliasNormalized === "string" ? item.aliasNormalized : "";
          const source = typeof item.source === "string" ? item.source : "operator";
          if (!aliasDisplay || !aliasNormalized) {
            return null;
          }
          return { aliasDisplay, aliasNormalized, source };
        })
        .filter((item): item is { aliasDisplay: string; aliasNormalized: string; source: string } => item != null)
    : [];

  return {
    _id: typeof value._id === "string" ? value._id : String(value._id ?? ""),
    companyKey,
    status: typeof value.status === "string" ? value.status : "confirmed",
    displayName,
    ...(typeof value.nameCn === "string" ? { nameCn: value.nameCn } : {}),
    ...(typeof value.nameEn === "string" ? { nameEn: value.nameEn } : {}),
    ...(typeof value.mergedIntoCompanyKey === "string"
      ? { mergedIntoCompanyKey: value.mergedIntoCompanyKey }
      : {}),
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    ...(typeof value.createdBy === "string" ? { createdBy: value.createdBy } : {}),
    ...(typeof value.archivedAt === "number" ? { archivedAt: value.archivedAt } : {}),
    aliases,
  };
}

function parsePolicy(value: unknown): CompanyPolicyRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const companyKey = typeof value.companyKey === "string" ? value.companyKey : "";
  if (!companyKey) {
    return null;
  }
  const effects = isRecord(value.effects)
    ? {
        ...(typeof value.effects.visibility === "string"
          ? { visibility: value.effects.visibility }
          : {}),
        ...(typeof value.effects.workflow === "string" ? { workflow: value.effects.workflow } : {}),
        ...(typeof value.effects.rankingEffect === "string"
          ? { rankingEffect: value.effects.rankingEffect }
          : {}),
        ...(Array.isArray(value.effects.reasonCodes)
          ? {
              reasonCodes: value.effects.reasonCodes.filter(
                (item): item is string => typeof item === "string",
              ),
            }
          : {}),
        ...(typeof value.effects.summary === "string" ? { summary: value.effects.summary } : {}),
      }
    : null;

  return {
    companyKey,
    displayName: typeof value.displayName === "string" ? value.displayName : companyKey,
    ...(typeof value.nameCn === "string" ? { nameCn: value.nameCn } : {}),
    ...(typeof value.nameEn === "string" ? { nameEn: value.nameEn } : {}),
    status: typeof value.status === "string" ? value.status : "confirmed",
    scopeType: typeof value.scopeType === "string" ? value.scopeType : "workspace",
    scopeId: typeof value.scopeId === "string" ? value.scopeId : "",
    revision: typeof value.revision === "number" ? value.revision : 0,
    effects,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    ...(typeof value.createdBy === "string" ? { createdBy: value.createdBy } : {}),
  };
}

export async function listCompanies(input: { includeArchived?: boolean } = {}): Promise<CompanyRecord[]> {
  const value = await callConvexQuery("companies:list", {
    writeSecret: config.auth.convexWriteSecret,
    includeArchived: input.includeArchived === true,
  });
  if (!Array.isArray(value)) {
    throw new Error("Invalid companies:list response");
  }
  return value.map(parseCompany).filter((item): item is CompanyRecord => item != null);
}

export async function setCompanyArchived(input: {
  companyKey: string;
  archived: boolean;
  createdBy?: string;
}): Promise<{ companyKey: string; archived: boolean; archivedAt: number | null }> {
  const value = await callConvexMutation("companies:setCompanyArchived", {
    companyKey: input.companyKey,
    archived: input.archived === true,
    createdBy: input.createdBy,
    writeSecret: config.auth.convexWriteSecret,
  });
  if (!isRecord(value) || typeof value.companyKey !== "string") {
    throw new Error("Invalid companies:setCompanyArchived response");
  }
  return {
    companyKey: value.companyKey,
    archived: value.archived === true,
    archivedAt: typeof value.archivedAt === "number" ? value.archivedAt : null,
  };
}

export async function listWorkspacePolicies(workspaceSlug: string): Promise<CompanyPolicyRecord[]> {
  const value = await callConvexQuery("companies:listPoliciesForScope", {
    scopeType: "workspace",
    scopeId: workspaceSlug,
    writeSecret: config.auth.convexWriteSecret,
  });
  if (!Array.isArray(value)) {
    throw new Error("Invalid companies:listPoliciesForScope response");
  }
  return value.map(parsePolicy).filter((item): item is CompanyPolicyRecord => item != null);
}

export async function upsertCompany(input: {
  companyKey: string;
  displayName: string;
  nameCn?: string;
  nameEn?: string;
  status?: "provisional" | "confirmed" | "merged";
  createdBy?: string;
}): Promise<{ companyKey: string; created: boolean }> {
  const value = await callConvexMutation("companies:upsert", {
    ...input,
    writeSecret: config.auth.convexWriteSecret,
  });
  if (!isRecord(value) || typeof value.companyKey !== "string") {
    throw new Error("Invalid companies:upsert response");
  }
  return {
    companyKey: value.companyKey,
    created: value.created === true,
  };
}

export async function addCompanyAlias(input: {
  companyKey: string;
  alias: string;
  source?: "seed" | "operator" | "observed";
}): Promise<{ created: boolean }> {
  const value = await callConvexMutation("companies:addAlias", {
    ...input,
    source: input.source ?? "operator",
    writeSecret: config.auth.convexWriteSecret,
  });
  if (!isRecord(value)) {
    throw new Error("Invalid companies:addAlias response");
  }
  return { created: value.created === true };
}

export async function appendWorkspacePolicy(input: {
  companyKey: string;
  workspaceSlug: string;
  createdBy?: string;
  preset?: CompanyPolicyPreset;
  visibility?: "default" | "hide";
  workflow?: "default" | "blocked";
  rankingEffect?: "none" | "band_known_good" | "band_known_bad" | "boost" | "demote";
  reasonCodes?: string[];
  summary?: string;
}): Promise<{ revision: number }> {
  const fromPreset = input.preset ? policyEffectsFromPreset(input.preset) : null;
  const value = await callConvexMutation("companies:appendPolicyRevision", {
    companyKey: input.companyKey,
    scopeType: "workspace",
    scopeId: input.workspaceSlug,
    createdBy: input.createdBy,
    visibility: input.visibility ?? fromPreset?.visibility,
    workflow: input.workflow ?? fromPreset?.workflow,
    rankingEffect: input.rankingEffect ?? fromPreset?.rankingEffect,
    reasonCodes: input.reasonCodes ?? fromPreset?.reasonCodes,
    summary: input.summary ?? fromPreset?.summary,
    writeSecret: config.auth.convexWriteSecret,
  });
  if (!isRecord(value) || typeof value.revision !== "number") {
    throw new Error("Invalid companies:appendPolicyRevision response");
  }
  return { revision: value.revision };
}

export async function seedCanonicalCompanies(input: {
  workspaceSlug: string;
  seedNoHireForWorkspace?: boolean;
  /** @deprecated Use seedNoHireForWorkspace — accepted for older clients */
  seedKnownGoodForWorkspace?: boolean;
  createdBy?: string;
}): Promise<{
  companiesCreated: number;
  companiesUpdated: number;
  aliasesCreated: number;
  policiesSeeded: number;
  policyRevision: number | null;
}> {
  const seedPolicies =
    input.seedNoHireForWorkspace === true || input.seedKnownGoodForWorkspace === true;
  const value = await callConvexMutation("companies:seedCanonicalCompanies", {
    workspaceSlug: input.workspaceSlug,
    seedNoHireForWorkspace: seedPolicies,
    createdBy: input.createdBy,
    writeSecret: config.auth.convexWriteSecret,
  });
  if (!isRecord(value)) {
    throw new Error("Invalid companies:seedCanonicalCompanies response");
  }
  return {
    companiesCreated: typeof value.companiesCreated === "number" ? value.companiesCreated : 0,
    companiesUpdated: typeof value.companiesUpdated === "number" ? value.companiesUpdated : 0,
    aliasesCreated: typeof value.aliasesCreated === "number" ? value.aliasesCreated : 0,
    policiesSeeded: typeof value.policiesSeeded === "number" ? value.policiesSeeded : 0,
    policyRevision: typeof value.policyRevision === "number" ? value.policyRevision : null,
  };
}
