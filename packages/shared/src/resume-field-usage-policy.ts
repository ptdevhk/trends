import {
  DEFAULT_RESUME_FIELD_USAGE_POLICY,
  RESUME_FIELD_USAGE_SURFACES,
  type ResumeFieldUsageFieldPolicy,
  type ResumeFieldUsagePolicy,
  type ResumeFieldUsageSurface,
} from "./generated/resume-field-usage-policy.js";

export type {
  ResumeFieldUsageFieldPolicy,
  ResumeFieldUsagePolicy,
  ResumeFieldUsageSurface,
} from "./generated/resume-field-usage-policy.js";

export type ResumeFieldUsagePolicyOverrides = {
  version?: number;
  updatedAt?: string;
  description?: string;
  sourceFileRelativePath?: string;
  fields?: Record<string, ResumeFieldUsageFieldPolicy>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseFieldPolicy(value: unknown): ResumeFieldUsageFieldPolicy | null {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = isRecord(value.surfaces) ? value.surfaces : value;
  const surfaces: Partial<Record<ResumeFieldUsageSurface, boolean>> = {};

  for (const surface of RESUME_FIELD_USAGE_SURFACES) {
    const allowed = candidate[surface];
    if (typeof allowed === "boolean") {
      surfaces[surface] = allowed;
    }
  }

  return Object.keys(surfaces).length > 0 ? { surfaces } : null;
}

function cloneFieldPolicy(policy: ResumeFieldUsageFieldPolicy): ResumeFieldUsageFieldPolicy {
  return {
    surfaces: {
      ...policy.surfaces,
    },
  };
}

function mergeFieldPolicy(
  base: ResumeFieldUsageFieldPolicy | undefined,
  override: ResumeFieldUsageFieldPolicy,
): ResumeFieldUsageFieldPolicy {
  return {
    surfaces: {
      ...(base?.surfaces ?? {}),
      ...(override.surfaces ?? {}),
    },
  };
}

function getFieldPolicy(
  fieldKey: string,
  policy: ResumeFieldUsagePolicy,
): ResumeFieldUsageFieldPolicy | undefined {
  const normalizedFieldKey = fieldKey.trim();
  return normalizedFieldKey ? policy.fields[normalizedFieldKey] : undefined;
}

function isResumeFieldAllowedInResolvedPolicy(
  fieldKey: string,
  surface: ResumeFieldUsageSurface,
  policy: ResumeFieldUsagePolicy,
): boolean {
  const fieldPolicy = getFieldPolicy(fieldKey, policy);
  if (!fieldPolicy) {
    return true;
  }

  const allowed = fieldPolicy.surfaces?.[surface];
  return allowed ?? true;
}

export function parseResumeFieldUsagePolicy(value: unknown): ResumeFieldUsagePolicy {
  const root = isRecord(value) ? value : {};
  const fieldsRoot = isRecord(root.fields) ? root.fields : {};
  const fields = Object.fromEntries(
    Object.entries(fieldsRoot)
      .map(([fieldKey, fieldValue]) => [fieldKey.trim(), parseFieldPolicy(fieldValue)] as const)
      .filter(
        (entry): entry is [string, ResumeFieldUsageFieldPolicy] =>
          entry[0].length > 0 && entry[1] !== null,
      ),
  );

  return {
    version: readNumber(root.version) ?? DEFAULT_RESUME_FIELD_USAGE_POLICY.version,
    updatedAt: readString(root.updatedAt),
    description: readString(root.description),
    sourceFileRelativePath:
      readString(root.sourceFileRelativePath)
      ?? DEFAULT_RESUME_FIELD_USAGE_POLICY.sourceFileRelativePath,
    fields,
  };
}

export function parseResumeFieldUsagePolicyOverrides(
  value: unknown,
): ResumeFieldUsagePolicyOverrides | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const parsed = parseResumeFieldUsagePolicy(value);
  return {
    version: parsed.version,
    updatedAt: parsed.updatedAt,
    description: parsed.description,
    sourceFileRelativePath: parsed.sourceFileRelativePath,
    fields: parsed.fields,
  };
}

export function mergeResumeFieldUsagePolicy(
  base: ResumeFieldUsagePolicy,
  override?: ResumeFieldUsagePolicyOverrides | ResumeFieldUsagePolicy,
): ResumeFieldUsagePolicy {
  if (!override) {
    return {
      ...base,
      fields: Object.fromEntries(
        Object.entries(base.fields).map(([fieldKey, policy]) => [fieldKey, cloneFieldPolicy(policy)]),
      ),
    };
  }

  const mergedFields = new Map<string, ResumeFieldUsageFieldPolicy>();

  for (const [fieldKey, policy] of Object.entries(base.fields)) {
    mergedFields.set(fieldKey, cloneFieldPolicy(policy));
  }

  for (const [fieldKey, policy] of Object.entries(override.fields ?? {})) {
    const existing = mergedFields.get(fieldKey);
    mergedFields.set(fieldKey, mergeFieldPolicy(existing, policy));
  }

  return {
    version: override.version ?? base.version,
    updatedAt: override.updatedAt ?? base.updatedAt,
    description: override.description ?? base.description,
    sourceFileRelativePath: override.sourceFileRelativePath ?? base.sourceFileRelativePath,
    fields: Object.fromEntries(Array.from(mergedFields.entries()).sort(([left], [right]) => left.localeCompare(right))),
  };
}

export function resolveResumeFieldUsagePolicy(
  override?: ResumeFieldUsagePolicyOverrides | ResumeFieldUsagePolicy | unknown,
): ResumeFieldUsagePolicy {
  return mergeResumeFieldUsagePolicy(
    DEFAULT_RESUME_FIELD_USAGE_POLICY,
    parseResumeFieldUsagePolicyOverrides(override),
  );
}

export function isResumeFieldAllowed(
  fieldKey: string,
  surface: ResumeFieldUsageSurface,
  policy?: ResumeFieldUsagePolicyOverrides | ResumeFieldUsagePolicy | unknown,
): boolean {
  const resolvedPolicy = resolveResumeFieldUsagePolicy(policy);
  return isResumeFieldAllowedInResolvedPolicy(fieldKey, surface, resolvedPolicy);
}

export function getDisallowedResumeFieldKeys(
  surface: ResumeFieldUsageSurface,
  policy?: ResumeFieldUsagePolicyOverrides | ResumeFieldUsagePolicy | unknown,
): string[] {
  const resolvedPolicy = resolveResumeFieldUsagePolicy(policy);
  return Object.keys(resolvedPolicy.fields)
    .filter((fieldKey) => !isResumeFieldAllowedInResolvedPolicy(fieldKey, surface, resolvedPolicy))
    .sort((left, right) => left.localeCompare(right));
}

export function getResumeFieldValueForSurface(
  record: Record<string, unknown> | null | undefined,
  fieldKey: string,
  surface: ResumeFieldUsageSurface,
  policy?: ResumeFieldUsagePolicyOverrides | ResumeFieldUsagePolicy | unknown,
): unknown {
  if (!record || !isResumeFieldAllowed(fieldKey, surface, policy)) {
    return undefined;
  }

  return record[fieldKey];
}

export function sanitizeResumeRecordForSurface<T extends Record<string, unknown>>(
  record: T,
  surface: ResumeFieldUsageSurface,
  policy?: ResumeFieldUsagePolicyOverrides | ResumeFieldUsagePolicy | unknown,
): T {
  const nextRecord = { ...record };

  for (const fieldKey of getDisallowedResumeFieldKeys(surface, policy)) {
    delete nextRecord[fieldKey];
  }

  return nextRecord;
}
