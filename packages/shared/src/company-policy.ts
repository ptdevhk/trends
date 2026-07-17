/**
 * Shared types and helpers for K3 company registry + company policy.
 *
 * Policy is an operational overlay and must not rewrite canonical AI scores.
 * Exact company naming: 宝力机械 / Pro-Technic Machinery and 宝惠 / Polywell
 * are separate companies — never merge under a "BaoLi" umbrella.
 */

export type CompanyStatus = "provisional" | "confirmed" | "merged";

export type CompanyPolicyScopeType = "workspace" | "market" | "global";

export type CompanyVisibilityEffect = "default" | "hide";
export type CompanyWorkflowEffect = "default" | "blocked";
export type CompanyRankingEffect =
  | "none"
  | "band_known_good"
  | "band_known_bad"
  | "boost"
  | "demote";

export type CompanyAliasSource = "seed" | "operator" | "observed";

export type CompanyPolicyEffects = {
  visibility?: CompanyVisibilityEffect;
  workflow?: CompanyWorkflowEffect;
  rankingEffect?: CompanyRankingEffect;
  reasonCodes?: string[];
  summary?: string;
};

/** Operator presets — convenience mapping only; storage remains multi-effect. */
export type CompanyPolicyPreset = "known_good" | "no_hire" | "none";

export const CANONICAL_SEED_COMPANIES = [
  {
    companyKey: "pro-technic-machinery",
    displayName: "宝力机械 / Pro-Technic Machinery",
    nameCn: "宝力机械",
    nameEn: "Pro-Technic Machinery",
    aliases: [
      "宝力机械",
      "宝力机械有限公司",
      "东莞宝力机械",
      "广州宝力机械科技有限公司",
      "广州宝力机械科技有限公司东莞分公司",
      "Pro-Technic Machinery",
      "Pro-Technic",
      "Pro Technic",
    ],
  },
  {
    companyKey: "polywell",
    displayName: "宝惠 / Polywell",
    nameCn: "宝惠",
    nameEn: "Polywell",
    aliases: ["宝惠", "Polywell", "Polywell Machinery"],
  },
] as const;

export function normalizeCompanyAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, " ")
    .replace(/[()（）[\]【】.,，。·・'"`]/g, "");
}

export function policyEffectsFromPreset(preset: CompanyPolicyPreset): CompanyPolicyEffects {
  switch (preset) {
    case "known_good":
      return {
        visibility: "default",
        workflow: "default",
        rankingEffect: "band_known_good",
        reasonCodes: ["known_good_employer"],
      };
    case "no_hire":
      return {
        visibility: "hide",
        workflow: "blocked",
        rankingEffect: "band_known_bad",
        reasonCodes: ["no_hire_employer"],
      };
    case "none":
      return {
        visibility: "default",
        workflow: "default",
        rankingEffect: "none",
        reasonCodes: [],
      };
  }
}

export function inferPolicyPreset(effects: CompanyPolicyEffects | null | undefined): CompanyPolicyPreset {
  if (!effects) {
    return "none";
  }
  if (effects.rankingEffect === "band_known_good") {
    return "known_good";
  }
  if (
    effects.rankingEffect === "band_known_bad" ||
    effects.visibility === "hide" ||
    effects.workflow === "blocked"
  ) {
    return "no_hire";
  }
  return "none";
}

/**
 * Most-specific-wins among optional scoped effect bags.
 * Pass in order: workspace, market, global (only defined ones compete).
 */
export function resolveMostSpecificPolicy(
  layers: Array<{ scopeType: CompanyPolicyScopeType; effects: CompanyPolicyEffects | null }>,
): CompanyPolicyEffects | null {
  const rank: Record<CompanyPolicyScopeType, number> = {
    workspace: 3,
    market: 2,
    global: 1,
  };
  const present = layers
    .filter((layer) => layer.effects != null)
    .sort((left, right) => rank[right.scopeType] - rank[left.scopeType]);
  return present[0]?.effects ?? null;
}

export type CompanyPolicyMatchHit = {
  companyKey: string;
  displayName: string;
  matchedEmployer: string;
  preset: CompanyPolicyPreset;
  effects: CompanyPolicyEffects;
  rankingEffect?: CompanyRankingEffect;
};

export type CompanyPolicyIndexEntry = {
  companyKey: string;
  displayName: string;
  effects: CompanyPolicyEffects;
  preset: CompanyPolicyPreset;
};

/** Map normalized alias -> policy index entry for O(1) employer matching. */
export function buildCompanyPolicyAliasIndex(
  companies: Array<{
    companyKey: string;
    displayName: string;
    aliases?: Array<{ aliasDisplay?: string; aliasNormalized?: string } | string>;
    nameCn?: string;
    nameEn?: string;
  }>,
  policiesByCompanyKey: Map<string, CompanyPolicyEffects>,
): Map<string, CompanyPolicyIndexEntry> {
  const index = new Map<string, CompanyPolicyIndexEntry>();

  for (const company of companies) {
    const effects = policiesByCompanyKey.get(company.companyKey);
    if (!effects) {
      continue;
    }
    const preset = inferPolicyPreset(effects);
    if (preset === "none") {
      continue;
    }
    const entry: CompanyPolicyIndexEntry = {
      companyKey: company.companyKey,
      displayName: company.displayName,
      effects,
      preset,
    };
    const candidates = [
      company.displayName,
      company.nameCn,
      company.nameEn,
      company.companyKey,
      ...(company.aliases ?? []).map((alias) =>
        typeof alias === "string" ? alias : alias.aliasDisplay ?? alias.aliasNormalized ?? "",
      ),
    ];
    for (const candidate of candidates) {
      const normalized = normalizeCompanyAlias(candidate ?? "");
      if (!normalized || index.has(normalized)) {
        continue;
      }
      index.set(normalized, entry);
    }
  }

  return index;
}

/**
 * Collect employer strings from work history + industry companyHits.
 * Does not mutate score; used only for operational policy signals.
 */
export function collectResumeEmployerStrings(input: {
  workHistory?: Array<{ companyName?: string; raw?: string } | null | undefined> | null;
  companyHits?: string[] | null;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | undefined | null) => {
    const trimmed = value?.trim();
    if (!trimmed) {
      return;
    }
    const key = normalizeCompanyAlias(trimmed);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(trimmed);
  };

  for (const entry of input.workHistory ?? []) {
    if (!entry) {
      continue;
    }
    push(entry.companyName);
    // Prefer structured companyName; only use raw when no companyName.
    if (!entry.companyName?.trim() && entry.raw) {
      push(entry.raw);
    }
  }
  for (const hit of input.companyHits ?? []) {
    push(hit);
  }
  return out;
}

function resolveAliasEntry(
  employer: string,
  aliasIndex: Map<string, CompanyPolicyIndexEntry>,
): CompanyPolicyIndexEntry | null {
  const normalized = normalizeCompanyAlias(employer);
  if (!normalized) {
    return null;
  }
  const exact = aliasIndex.get(normalized);
  if (exact) {
    return exact;
  }
  // Soft contains match for real-world employer strings that embed a seeded alias
  // (e.g. "东莞市宝力机械科技有限公司" contains "宝力机械"). Prefer longest alias.
  let best: { alias: string; entry: CompanyPolicyIndexEntry } | null = null;
  for (const [alias, entry] of aliasIndex.entries()) {
    if (alias.length < 4) {
      continue;
    }
    if (normalized.includes(alias) || (normalized.length >= 4 && alias.includes(normalized))) {
      if (!best || alias.length > best.alias.length) {
        best = { alias, entry };
      }
    }
  }
  return best?.entry ?? null;
}

export function matchCompanyPoliciesForEmployers(
  employers: string[],
  aliasIndex: Map<string, CompanyPolicyIndexEntry>,
): CompanyPolicyMatchHit[] {
  const byCompany = new Map<string, CompanyPolicyMatchHit>();
  for (const employer of employers) {
    const entry = resolveAliasEntry(employer, aliasIndex);
    if (!entry) {
      continue;
    }
    if (byCompany.has(entry.companyKey)) {
      continue;
    }
    byCompany.set(entry.companyKey, {
      companyKey: entry.companyKey,
      displayName: entry.displayName,
      matchedEmployer: employer,
      preset: entry.preset,
      effects: entry.effects,
      rankingEffect: entry.effects.rankingEffect,
    });
  }
  return Array.from(byCompany.values()).sort((left, right) => {
    // Surface no-hire before known-good so warnings are hard to miss.
    const rank = (preset: CompanyPolicyPreset) =>
      preset === "no_hire" ? 0 : preset === "known_good" ? 1 : 2;
    return rank(left.preset) - rank(right.preset) || left.displayName.localeCompare(right.displayName);
  });
}

export function matchResumeCompanyPolicies(
  input: {
    workHistory?: Array<{ companyName?: string; raw?: string } | null | undefined> | null;
    companyHits?: string[] | null;
  },
  aliasIndex: Map<string, CompanyPolicyIndexEntry>,
): CompanyPolicyMatchHit[] {
  return matchCompanyPoliciesForEmployers(collectResumeEmployerStrings(input), aliasIndex);
}

export function isCompanyPolicyHidden(hits: CompanyPolicyMatchHit[]): boolean {
  return hits.some((hit) => hit.effects.visibility === "hide");
}

export function isCompanyWorkflowBlocked(hits: CompanyPolicyMatchHit[]): boolean {
  return hits.some((hit) => hit.effects.workflow === "blocked");
}

export function primaryCompanyPolicyHit(
  hits: CompanyPolicyMatchHit[],
): CompanyPolicyMatchHit | null {
  return hits[0] ?? null;
}

/** Status values treated as "advancing" for soft workflow gate. */
export const COMPANY_POLICY_BLOCKED_STATUSES = [
  "shortlisted",
  "contacted",
  "interviewing",
  "interviewed_pass",
  "offer",
  "hired",
] as const;

export type CompanyPolicyBlockedStatus = (typeof COMPANY_POLICY_BLOCKED_STATUSES)[number];

export function isAdvancingCandidateStatus(status: string): boolean {
  return (COMPANY_POLICY_BLOCKED_STATUSES as readonly string[]).includes(status);
}
