import {
  buildCompanyPolicyAliasIndex,
  deriveMarketFromSourceKey,
  hasActiveOverride,
  matchResumeCompanyPolicies,
  resolvePolicyEffectsForCompanies,
  type CandidatePolicyOverride,
  type CompanyPolicyEffects,
  type CompanyPolicyIndexEntry,
} from "@trends/shared";

import { listCandidatePolicyOverrides } from "./candidate-policy-override-service.js";
import {
  listCompanies,
  listMarketPolicies,
  listWorkspacePolicies,
  type CompanyPolicyRecord,
} from "./company-policy-service.js";
import { logger } from "./logger.js";

export function resolveResumeIdentity(resume: { identityKey?: string; externalId?: string }): string {
  return (resume.identityKey?.trim() || resume.externalId?.trim() || "").trim();
}

export type ResumeVisibilityEvaluation = {
  hidden: boolean;
  hiddenCompanyKeys: string[];
  overriddenCompanyKeys: string[];
};

export class ResumePolicyEnforcer {
  private readonly aliasIndexByMarket: Record<
    "cn" | "my",
    Map<string, CompanyPolicyIndexEntry>
  >;
  private readonly overrides: CandidatePolicyOverride[];

  constructor(
    aliasIndexByMarket: Record<"cn" | "my", Map<string, CompanyPolicyIndexEntry>>,
    overrides: CandidatePolicyOverride[],
  ) {
    this.aliasIndexByMarket = aliasIndexByMarket;
    this.overrides = overrides;
  }

  static async load(workspaceSlug: string): Promise<ResumePolicyEnforcer> {
    try {
      const [companies, policies, cnPolicies, myPolicies, overrides] = await Promise.all([
        listCompanies({ includeArchived: true }),
        listWorkspacePolicies(workspaceSlug),
        listMarketPolicies("cn"),
        listMarketPolicies("my"),
        listCandidatePolicyOverrides(workspaceSlug),
      ]);

      const workspaceByCompanyKey = new Map<string, CompanyPolicyEffects>();
      for (const policy of policies) {
        if (!policy.effects) {
          continue;
        }
        workspaceByCompanyKey.set(policy.companyKey, policy.effects as CompanyPolicyEffects);
      }

      const buildMarketIndex = (marketPolicies: CompanyPolicyRecord[]) => {
        const marketByCompanyKey = new Map<string, CompanyPolicyEffects>();
        for (const policy of marketPolicies) {
          if (!policy.effects) {
            continue;
          }
          marketByCompanyKey.set(policy.companyKey, policy.effects as CompanyPolicyEffects);
        }
        // Market beats workspace per company; workspace rows still apply in
        // markets without their own row (global rows are not a resolution tier).
        return buildCompanyPolicyAliasIndex(
          companies,
          resolvePolicyEffectsForCompanies([
            { scopeType: "market", effectsByCompanyKey: marketByCompanyKey },
            { scopeType: "workspace", effectsByCompanyKey: workspaceByCompanyKey },
          ]),
        );
      };

      const aliasIndexByMarket = {
        cn: buildMarketIndex(cnPolicies),
        my: buildMarketIndex(myPolicies),
      };
      return new ResumePolicyEnforcer(aliasIndexByMarket, overrides as CandidatePolicyOverride[]);
    } catch (error) {
      // Fail open to an empty policy index when policy data cannot be loaded
      // (e.g. Convex unavailable for non-Convex search sources); the web-side
      // client filter is the second layer. Log so enforcement gaps are visible.
      logger.warn("Resume policy enforcement degraded; failing open (no hide filter)", {
        workspaceSlug,
        error,
      });
      return new ResumePolicyEnforcer({ cn: new Map(), my: new Map() }, []);
    }
  }

  evaluate(resume: {
    workHistory?: Array<{ companyName?: string; raw?: string; companyKey?: string } | null | undefined> | null;
    ingestData?: { companyHits?: string[] } | null;
    identityKey?: string;
    externalId?: string;
    sourceKey?: string | null;
  }): ResumeVisibilityEvaluation {
    const market = deriveMarketFromSourceKey(resume.sourceKey);
    const marketKey = market === "MY" || market === "TH" ? "my" : "cn";
    const aliasIndex = this.aliasIndexByMarket[marketKey];
    const hits = matchResumeCompanyPolicies(
      {
        workHistory: resume.workHistory,
        companyHits: resume.ingestData?.companyHits,
      },
      aliasIndex,
    );

    const identity = resolveResumeIdentity(resume);

    const hiddenHits = hits.filter((hit) => hit.effects.visibility === "hide");
    const hiddenCompanyKeys = hiddenHits.map((hit) => hit.companyKey);

    const blockedHits = hits.filter((hit) => hit.effects.workflow === "blocked");

    const overriddenHiddenKeys = hiddenHits
      .filter((hit) => hasActiveOverride(this.overrides, identity, hit.companyKey))
      .map((hit) => hit.companyKey);

    const overriddenBlockedKeys = blockedHits
      .filter((hit) => hasActiveOverride(this.overrides, identity, hit.companyKey))
      .map((hit) => hit.companyKey);

    const overriddenCompanyKeys = Array.from(
      new Set([...overriddenHiddenKeys, ...overriddenBlockedKeys]),
    );

    const hidden =
      hiddenCompanyKeys.length > 0 && overriddenHiddenKeys.length < hiddenCompanyKeys.length;

    return {
      hidden,
      hiddenCompanyKeys,
      overriddenCompanyKeys,
    };
  }
}
