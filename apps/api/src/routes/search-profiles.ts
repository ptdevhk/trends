/**
 * Search Profiles API Routes
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
    computeTemplateHash,
    findWorkspaceSearchProfileTemplate,
    generateStructuredJobDescriptionContent,
    getWorkspaceSearchProfileTemplates,
    isRecord,
    isValidWorkspace,
    WORKSPACE_TEAMS,
} from "@trends/shared";

import {
    matchSearchProfilesByKeywords,
    searchProfileService,
    type AutoMatchResult,
    type SearchProfile,
} from "../services/search-profile-service.js";
import { logger } from "../services/logger.js";
import { requireAdmin } from "../middleware/workspace.js";
import { callConvexQuery, callConvexMutation } from "../services/convex-utils.js";
import { resolveConvexUrl } from "../services/resume-import-service.js";
import { readString, readNumber } from "../services/workspace-config-service.js";
import {
    ProfileRunStatusSchema,
    readRunStatusStore,
    toScopedProfileKey,
    upsertRunStatus,
    type ProfileRunStatus,
} from "../services/search-profile-run-status.js";

const app = new OpenAPIHono();
app.use("/api/search-profiles", requireAdmin);
app.use("/api/search-profiles/*", requireAdmin);

// Schemas
const ProfileSummarySchema = z.object({
    id: z.string(),
    name: z.string(),
    updatedAt: z.string(),
    status: z.enum(["active", "paused", "archived"]),
    location: z.string(),
    keywords: z.array(z.string()),
    sources: z.array(z.object({
        type: z.string(),
        enabled: z.boolean(),
        priority: z.number().optional(),
        jobUrl: z.string().optional(),
        unsafeLimits: z.boolean().optional(),
    })).optional(),
    quickStart: z.object({
        enabled: z.boolean(),
        rank: z.number().optional(),
        label: z.string().optional(),
        description: z.string().optional(),
    }).optional(),
    filters: z.object({
        minAge: z.number().optional(),
        maxAge: z.number().optional(),
        maxExperience: z.number().optional(),
        minRoleYears: z.number().optional(),
        roleFilterType: z.string().optional(),
    }).optional(),
});

const StatsSchema = z.object({
    total: z.number(),
    active: z.number(),
    paused: z.number(),
    archived: z.number(),
});

const AutoMatchRequestSchema = z.object({
    keywords: z.array(z.string()).min(1),
    location: z.string().optional(),
});

const AutoMatchResponseSchema = z.object({
    success: z.literal(true),
    profileId: z.string().optional(),
    jobDescription: z.string().optional(),
    filterPreset: z.string().optional(),
    confidence: z.number(),
    matchedKeywords: z.array(z.string()),
});

const ProfilePayloadSchema = z.record(z.string(), z.unknown());
const ProfileRuntimeItemSchema = z.object({
    workspaceSlug: z.string().min(1),
    profileId: z.string(),
    name: z.string(),
    cron: z.string(),
    profile: ProfilePayloadSchema,
});
const ProfilesRuntimeResponseSchema = z.object({
    success: z.literal(true),
    items: z.array(ProfileRuntimeItemSchema),
});

const RunProfileRequestSchema = z.object({
    keyword: z.string().optional(),
    location: z.string().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    maxPages: z.number().int().min(1).max(50).optional(),
    autoAnalyze: z.boolean().optional(),
    analysisTopN: z.number().int().min(1).max(100).optional(),
    minAge: z.number().int().min(1).max(120).optional(),
    maxAge: z.number().int().min(1).max(120).optional(),
    maxSalary: z.number().int().min(1).optional(),
});

const RunProfileResponseSchema = z.object({
    success: z.literal(true),
    profileId: z.string(),
    taskId: z.string(),
    dispatch: z.object({
        keyword: z.string(),
        location: z.string(),
        limit: z.number(),
        maxPages: z.number(),
        minAge: z.number().optional(),
        maxAge: z.number().optional(),
        maxSalary: z.number().optional(),
        autoAnalyze: z.boolean(),
        analysisTopN: z.number(),
        convexUrl: z.string(),
    }),
});

function toIsoTimestamp(value: unknown): string | undefined {
    const numeric = readNumber(value);
    if (numeric === null) {
        return undefined;
    }
    return new Date(numeric).toISOString();
}

function normalizeTaskStatus(value: unknown): ProfileRunStatus["taskStatus"] {
    const status = readString(value);
    if (
        status === "pending"
        || status === "processing"
        || status === "completed"
        || status === "failed"
        || status === "cancelled"
    ) {
        return status;
    }
    return "unknown";
}

async function dispatchCollectionTask(args: {
    keyword: string;
    location: string;
    limit: number;
    maxPages: number;
    minAge?: number;
    maxAge?: number;
    maxSalary?: number;
    autoAnalyze: boolean;
    analysisTopN: number;
}): Promise<{ taskId: string; convexUrl: string }> {
    const value = await callConvexMutation("resume_tasks:dispatch", args);
    if (isRecord(value) && value.queued === false) {
        throw new Error("Maintenance mode active — collection dispatch refused");
    }
    const taskId = isRecord(value) && typeof value.taskId !== "undefined"
        ? String(value.taskId)
        : String(value);
    return {
        taskId,
        convexUrl: resolveConvexUrl().replace(/\/$/, ""),
    };
}

function normalizePositiveInt(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined;
    }
    const truncated = Math.trunc(value);
    if (truncated <= 0) {
        return undefined;
    }
    return truncated;
}

async function getCollectionTaskStatus(taskId: string): Promise<Partial<ProfileRunStatus> | null> {
    const value = await callConvexQuery("resume_tasks:getById", { taskId });

    if (!isRecord(value)) {
        return null;
    }

    const task = value;

    const results = isRecord(task.results) ? task.results : undefined;
    const progress = isRecord(task.progress) ? task.progress : undefined;
    const submitted = readNumber(results?.submitted);
    const extracted = readNumber(results?.extracted);
    const progressCurrent = readNumber(progress?.current);
    const resultCount = submitted ?? extracted ?? progressCurrent;

  return {
    taskStatus: normalizeTaskStatus(task.status),
    completedAt: toIsoTimestamp(task.completedAt),
    resultCount: resultCount !== null ? Math.round(resultCount) : undefined,
    extracted: extracted !== null ? Math.round(extracted) : undefined,
    submitted: submitted !== null ? Math.round(submitted) : undefined,
    error: readString(task.error) ?? undefined,
  };
}

type ConvexSearchProfileRecord = {
    _id?: unknown;
    name?: unknown;
    profileId?: unknown;
    profile?: unknown;
    criteria?: unknown;
    workspaceSlug?: unknown;
    updatedAt?: unknown;
    createdAt?: unknown;
};

type ConvexJobDescriptionRecord = {
    _id?: unknown;
    type?: unknown;
    title?: unknown;
    workspaceSlug?: unknown;
    location?: unknown;
    industryTags?: unknown;
    minExperience?: unknown;
    maxExperience?: unknown;
    minAge?: unknown;
    maxAge?: unknown;
};

type JobDescriptionSyncPayload = {
    id: string;
    content: string;
    customKeywords: string[];
};

const DEFAULT_WORKSPACE_SLUG = "dev";
const CONFIG_SEED_SOURCE = "config/search-profiles";
const KNOWN_WORKSPACE_SLUGS = Object.keys(WORKSPACE_TEAMS).filter(isValidWorkspace);

function belongsToWorkspace(recordWorkspaceSlug: unknown, workspaceSlug: string): boolean {
    const normalizedRecordWorkspace = readString(recordWorkspaceSlug);
    if (workspaceSlug === DEFAULT_WORKSPACE_SLUG) {
        return !normalizedRecordWorkspace || normalizedRecordWorkspace === DEFAULT_WORKSPACE_SLUG;
    }
    return normalizedRecordWorkspace === workspaceSlug;
}

function normalizeKeywordList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(
        new Set(
            value
                .map((item) => readString(item))
                .filter((item): item is string => Boolean(item))
        )
    );
}

function buildProfileRunKeyword(value: string | undefined, profileKeywords: string[]): string {
    const explicitKeyword = readString(value);
    if (explicitKeyword) {
        return explicitKeyword;
    }

    return normalizeKeywordList(profileKeywords).join(" ");
}

function readProfilePayload(record: ConvexSearchProfileRecord): Record<string, unknown> {
    return isRecord(record.profile) ? record.profile : {};
}

function readLogicalProfileId(record: ConvexSearchProfileRecord): string | null {
    const profilePayload = readProfilePayload(record);
    const explicitId = readString(record.profileId) ?? readString(profilePayload.id);
    if (explicitId) {
        return searchProfileService.normalizeProfileIdentifier(explicitId);
    }
    return record._id ? String(record._id) : null;
}

function readDeletedAt(record: ConvexSearchProfileRecord): number | undefined {
    const profilePayload = readProfilePayload(record);
    return readNumber(profilePayload.deletedAt) ?? undefined;
}

function readTemplateHash(record: ConvexSearchProfileRecord): string | undefined {
    const profilePayload = readProfilePayload(record);
    return readString(profilePayload.templateHash) ?? undefined;
}

function isSeededFromConfig(record: ConvexSearchProfileRecord): boolean {
    const profilePayload = readProfilePayload(record);
    return readString(profilePayload.seedSource) === CONFIG_SEED_SOURCE;
}

function toStoredProfilePayload(
    profile: SearchProfile,
    options?: {
        seededFromConfig?: boolean;
        deletedAt?: number;
        templateHash?: string;
    }
): Record<string, unknown> {
    return {
        ...profile,
        ...(options?.seededFromConfig ? { seedSource: CONFIG_SEED_SOURCE } : {}),
        ...(typeof options?.deletedAt === "number" ? { deletedAt: options.deletedAt } : {}),
        ...(options?.templateHash ? { templateHash: options.templateHash } : {}),
    };
}

function toSearchProfile(record: ConvexSearchProfileRecord): SearchProfile | null {
    const profileId = readLogicalProfileId(record) ?? "";
    if (!profileId) {
        return null;
    }

    const profilePayload = readProfilePayload(record);
    const criteria = isRecord(record.criteria) ? record.criteria : {};
    const criteriaKeywords = normalizeKeywordList(criteria.keywords);
    const criteriaLocations = normalizeKeywordList(criteria.locations);
    const fallbackLocation = criteriaLocations[0] ?? "";

    const fallback: SearchProfile = {
        id: profileId,
        name: readString(record.name) ?? profileId,
        status: "active",
        location: fallbackLocation,
        keywords: criteriaKeywords,
    };

    const normalized = searchProfileService.normalizeProfileInput(
        {
            ...profilePayload,
            id: profileId,
        },
        fallback
    );

    normalized.id = profileId;
    if (!normalized.location && fallbackLocation) {
        normalized.location = fallbackLocation;
    }
    if (normalized.keywords.length === 0 && criteriaKeywords.length > 0) {
        normalized.keywords = criteriaKeywords;
    }

    if (normalized.keywords.length === 0) {
        return null;
    }

    return normalized;
}

type ResolvedCustomProfileRecord = {
    storageId: string;
    logicalId: string;
    profile: SearchProfile;
    seededFromConfig: boolean;
    templateHash?: string;
    deletedAt?: number;
};

async function listCustomProfileRecords(
    workspaceSlug: string,
    options?: {
        includeDeleted?: boolean;
    }
): Promise<ResolvedCustomProfileRecord[]> {
    const value = await callConvexQuery( "search_profiles:list", { workspaceSlug });
    if (!Array.isArray(value)) {
        return [];
    }

    const records: ResolvedCustomProfileRecord[] = [];
    value
        .filter((item): item is ConvexSearchProfileRecord => isRecord(item))
        .forEach((item) => {
            const profile = toSearchProfile(item);
            const storageId = item._id ? String(item._id) : "";
            const logicalId = profile?.id ?? "";
            if (!profile || !storageId || !logicalId) {
                return;
            }

            const deletedAt = readDeletedAt(item);
            if (!options?.includeDeleted && typeof deletedAt === "number") {
                return;
            }

            records.push({
                storageId,
                logicalId,
                profile,
                seededFromConfig: isSeededFromConfig(item),
                templateHash: readTemplateHash(item),
                ...(typeof deletedAt === "number" ? { deletedAt } : {}),
            });
        });

    return records;
}

async function listCustomProfiles(workspaceSlug: string): Promise<SearchProfile[]> {
    const records = await listCustomProfileRecords(workspaceSlug);
    return records.map((record) => record.profile);
}

async function getCustomProfile(id: string, workspaceSlug: string): Promise<SearchProfile | null> {
    const record = await findCustomProfileRecordById(id, workspaceSlug);
    return record?.profile ?? null;
}

async function findCustomProfileRecordById(
    id: string,
    workspaceSlug: string,
    options?: {
        includeDeleted?: boolean;
    }
): Promise<ResolvedCustomProfileRecord | null> {
    const value = await callConvexQuery( "search_profiles:getById", { id, workspaceSlug });
    if (!isRecord(value)) {
        return null;
    }

    const record = value as ConvexSearchProfileRecord;
    const profile = toSearchProfile(record);
    const storageId = record._id ? String(record._id) : "";
    const logicalId = profile?.id ?? "";
    if (!profile || !storageId || !logicalId) {
        return null;
    }

    const deletedAt = readDeletedAt(record);
    if (!options?.includeDeleted && typeof deletedAt === "number") {
        return null;
    }

    return {
        storageId,
        logicalId,
        profile,
        seededFromConfig: isSeededFromConfig(record),
        templateHash: readTemplateHash(record),
        deletedAt,
    };
}

function isReseedOnDriftEnabled(): boolean {
    const value = process.env.SEARCH_PROFILES_RESEED_ON_DRIFT?.toLowerCase().trim();
    return value === "true" || value === "1" || value === "yes";
}

async function ensureWorkspaceSeedProfiles(workspaceSlug: string): Promise<void> {
    const existingRecords = await listCustomProfileRecords(workspaceSlug, { includeDeleted: true });
    const existingByLogicalId = new Map<string, ResolvedCustomProfileRecord>(
        existingRecords.map((record) => [record.logicalId, record]),
    );
    const reseedOnDrift = isReseedOnDriftEnabled();

    for (const template of getWorkspaceSearchProfileTemplates(workspaceSlug)) {
        const profile = searchProfileService.normalizeProfileInput(template.profile);
        const logicalId = searchProfileService.normalizeProfileIdentifier(profile.id);
        const currentHash = computeTemplateHash(template.profile);
        const existing = existingByLogicalId.get(logicalId);

        if (!existing) {
            await createCustomProfile(
                toStoredProfilePayload(profile, { seededFromConfig: true, templateHash: currentHash }),
                workspaceSlug,
            );
            continue;
        }

        const isSoftDeleted = typeof existing.deletedAt === "number";
        if (isSoftDeleted) {
            continue;
        }

        // Legacy adoption: profile exists by profileId but was seeded before the
        // stamping mechanism was added — no seedSource or templateHash. Treat it
        // the same as a drifted seeded profile when the operator opts in via
        // SEARCH_PROFILES_RESEED_ON_DRIFT. Without the flag, log and skip.
        const isLegacyUnstamped = !existing.seededFromConfig
            && !existing.templateHash
            && existing.logicalId === logicalId;

        if (isLegacyUnstamped) {
            // Always adopt — legacy unstamped profiles were auto-seeded from config
            // before the stamping mechanism was added. They have no user edits to
            // protect, so it's safe to refresh from YAML unconditionally.
            const refreshedProfile = searchProfileService.normalizeProfileInput(
                { ...profile, id: existing.profile.id },
                existing.profile,
            );
            refreshedProfile.id = existing.profile.id;
            await updateCustomProfile(
                existing.storageId,
                toStoredProfilePayload(refreshedProfile, {
                    seededFromConfig: true,
                    templateHash: currentHash,
                }),
                workspaceSlug,
            );
            logger.warn(
                `adopted legacy profile "${logicalId}" (workspace=${workspaceSlug}): ` +
                `stamped seedSource + templateHash, refreshed filters from YAML.`,
                { route: "search-profiles" },
            );
            continue;
        }

        // Half-stamped fix: seeded profile with seedSource but no templateHash.
        // This happens when a profile was PUT via the API editor (which stamps
        // seedSource) before the templateHash field was added to the PUT path.
        // Always safe to stamp — no user edits are clobbered.
        const isHalfStamped = existing.seededFromConfig
            && !existing.templateHash;

        if (isHalfStamped) {
            await updateCustomProfile(
                existing.storageId,
                toStoredProfilePayload(existing.profile, {
                    seededFromConfig: true,
                    templateHash: currentHash,
                }),
                workspaceSlug,
            );
            logger.warn(
                `stamped missing templateHash on half-stamped profile "${logicalId}" (workspace=${workspaceSlug}).`,
                { route: "search-profiles" },
            );
            continue;
        }

        // Drift detection: seeded profile whose YAML template has changed since
        // it was inserted. Only refresh when the operator opts in via
        // SEARCH_PROFILES_RESEED_ON_DRIFT — refresh clobbers any user edits to
        // the profile's sources / quickStart / filters / schedule, so it must
        // be explicit. Without the env flag, log the drift and skip.
        const hasDrift = existing.seededFromConfig
            && typeof existing.templateHash === "string"
            && existing.templateHash !== currentHash;
        if (!hasDrift) {
            continue;
        }

        if (!reseedOnDrift) {
            logger.warn(
                `template drift detected for "${logicalId}" (workspace=${workspaceSlug}); ` +
                `set SEARCH_PROFILES_RESEED_ON_DRIFT=true to refresh from YAML automatically, ` +
                `or PUT the profile manually via the editor.`,
                { route: "search-profiles" },
            );
            continue;
        }

        const refreshedProfile = searchProfileService.normalizeProfileInput(
            { ...profile, id: existing.profile.id },
            existing.profile,
        );
        refreshedProfile.id = existing.profile.id;
        await updateCustomProfile(
            existing.storageId,
            toStoredProfilePayload(refreshedProfile, {
                seededFromConfig: true,
                templateHash: currentHash,
            }),
            workspaceSlug,
        );
        logger.warn(
            `refreshed "${logicalId}" (workspace=${workspaceSlug}) from YAML template ` +
            `(hash ${existing.templateHash ?? "unknown"} → ${currentHash}).`,
            { route: "search-profiles" },
        );
    }
}

async function ensureWorkspaceProfileById(id: string, workspaceSlug: string): Promise<void> {
    const existing = await findCustomProfileRecordById(id, workspaceSlug, { includeDeleted: true });
    const template = findWorkspaceSearchProfileTemplate(id, workspaceSlug);
    if (!template) {
        return;
    }

    const currentHash = computeTemplateHash(template.profile);

    if (!existing) {
        const profile = searchProfileService.normalizeProfileInput(template.profile);
        await createCustomProfile(
            toStoredProfilePayload(profile, { seededFromConfig: true, templateHash: currentHash }),
            workspaceSlug,
        );
        return;
    }

    const isSoftDeleted = typeof existing.deletedAt === "number";
    if (isSoftDeleted) {
        return;
    }
}

async function getLinkedCustomJobDescription(
    id: string,
    workspaceSlug: string
): Promise<ConvexJobDescriptionRecord | null> {
    let value: unknown;
    try {
        value = await callConvexQuery( "job_descriptions:get", { id });
    } catch {
        return null;
    }
    if (!isRecord(value)) {
        return null;
    }
    if (readString(value.type) !== "custom") {
        return null;
    }
    if (!belongsToWorkspace(value.workspaceSlug, workspaceSlug)) {
        return null;
    }
    return value;
}

async function buildJobDescriptionSyncPayload(
    profile: SearchProfile,
    workspaceSlug: string
): Promise<JobDescriptionSyncPayload | undefined> {
    const jobDescriptionId = profile.jobDescription?.trim();
    if (!jobDescriptionId) {
        return undefined;
    }

    const jobDescription = await getLinkedCustomJobDescription(jobDescriptionId, workspaceSlug);
    if (!jobDescription) {
        return undefined;
    }

    const title = readString(jobDescription.title) ?? profile.name;
    const content = generateStructuredJobDescriptionContent({
        title,
        location: readString(jobDescription.location) ?? undefined,
        industryTags: normalizeKeywordList(jobDescription.industryTags),
        minExperience: readNumber(jobDescription.minExperience) ?? undefined,
        maxExperience: readNumber(jobDescription.maxExperience) ?? undefined,
        minAge: readNumber(jobDescription.minAge) ?? undefined,
        maxAge: readNumber(jobDescription.maxAge) ?? undefined,
        customKeywords: profile.keywords,
    });

    return {
        id: jobDescriptionId,
        content,
        customKeywords: profile.keywords,
    };
}

async function createCustomProfile(
    profile: unknown,
    workspaceSlug: string,
    jobDescriptionSync?: JobDescriptionSyncPayload
): Promise<SearchProfile> {
    const value = await callConvexMutation( "search_profiles:create", {
        profile,
        workspaceSlug,
        jobDescriptionSync,
    });
    if (!isRecord(value)) {
        throw new Error("Failed to create search profile");
    }

    const created = toSearchProfile(value);
    if (!created) {
        throw new Error("Created search profile payload is invalid");
    }
    return created;
}

async function updateCustomProfile(
    id: string,
    profile: unknown,
    workspaceSlug: string,
    jobDescriptionSync?: JobDescriptionSyncPayload
): Promise<SearchProfile> {
    const value = await callConvexMutation( "search_profiles:update", {
        id,
        profile,
        workspaceSlug,
        jobDescriptionSync,
    });
    if (!isRecord(value)) {
        throw new Error("Failed to update search profile");
    }

    const updated = toSearchProfile(value);
    if (!updated) {
        throw new Error("Updated search profile payload is invalid");
    }
    return updated;
}

async function deleteCustomProfile(id: string, workspaceSlug: string): Promise<boolean> {
    const value = await callConvexMutation( "search_profiles:remove", {
        id,
        workspaceSlug,
    });
    return value === true;
}

function matchProfiles(profiles: SearchProfile[], keywords: string[], location?: string): AutoMatchResult {
    return matchSearchProfilesByKeywords(profiles, keywords, location);
}

async function loadProfileById(id: string, workspaceSlug: string): Promise<SearchProfile | null> {
    const custom = await getCustomProfile(id, workspaceSlug);
    if (custom) {
        return custom;
    }

    const template = findWorkspaceSearchProfileTemplate(id, workspaceSlug);
    if (!template) {
        return null;
    }

    return searchProfileService.normalizeProfileInput(template.profile);
}

function compareProfileSummaries(
    left: z.infer<typeof ProfileSummarySchema>,
    right: z.infer<typeof ProfileSummarySchema>
): number {
    const leftQuickStartRank = left.quickStart?.enabled ? left.quickStart.rank ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    const rightQuickStartRank = right.quickStart?.enabled ? right.quickStart.rank ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;

    if (leftQuickStartRank !== rightQuickStartRank) {
        return leftQuickStartRank - rightQuickStartRank;
    }

    if (left.quickStart?.enabled !== right.quickStart?.enabled) {
        return left.quickStart?.enabled ? -1 : 1;
    }

    return right.updatedAt.localeCompare(left.updatedAt);
}

function hasRuntimeSchedule(
    profile: SearchProfile
): profile is SearchProfile & { schedule: NonNullable<SearchProfile["schedule"]> } {
    return profile.status === "active"
        && profile.schedule?.enabled === true
        && typeof profile.schedule.cron === "string"
        && profile.schedule.cron.trim().length > 0;
}

function toProfileRuntimeItem(workspaceSlug: string, profile: SearchProfile): z.infer<typeof ProfileRuntimeItemSchema> {
    const profilePayload: Record<string, unknown> = {
        ...profile,
    };

    return {
        workspaceSlug,
        profileId: profile.id,
        name: profile.name,
        cron: profile.schedule!.cron!,
        profile: profilePayload,
    };
}

// ============================================================
// GET /api/search-profiles/stats
// ============================================================
const statsRoute = createRoute({
    method: "get",
    path: "/stats",
    tags: ["Search Profiles"],
    summary: "Search profiles statistics",
    responses: {
        200: {
            description: "Profile statistics",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        stats: StatsSchema,
                    }),
                },
            },
        },
    },
});

app.openapi(statsRoute, async (c) => {
    await ensureWorkspaceSeedProfiles(c.var.workspaceSlug);
    const profiles = await listCustomProfiles(c.var.workspaceSlug);
    const stats = {
        total: profiles.length,
        active: profiles.filter((profile) => profile.status === "active").length,
        paused: profiles.filter((profile) => profile.status === "paused").length,
        archived: profiles.filter((profile) => profile.status === "archived").length,
    };
    return c.json({ success: true, stats } as const);
});

// ============================================================
// GET /api/search-profiles
// ============================================================
const listRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["Search Profiles"],
    summary: "List all search profiles",
    responses: {
        200: {
            description: "List of search profiles",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        profiles: z.array(ProfileSummarySchema),
                    }),
                },
            },
        },
    },
});

app.openapi(listRoute, async (c) => {
    await ensureWorkspaceSeedProfiles(c.var.workspaceSlug);
    const workspaceProfiles = await listCustomProfiles(c.var.workspaceSlug);
    const workspaceSummaries = workspaceProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        updatedAt: profile.updatedAt ?? profile.createdAt ?? new Date().toISOString(),
        status: profile.status,
        location: profile.location,
        keywords: profile.keywords,
        sources: profile.sources,
        quickStart: profile.quickStart,
        filters: profile.filters
            ? {
                minAge: readNumber(profile.filters.minAge) ?? undefined,
                maxAge: readNumber(profile.filters.maxAge) ?? undefined,
                maxExperience: readNumber(profile.filters.maxExperience) ?? undefined,
                minRoleYears: readNumber(profile.filters.minRoleYears) ?? undefined,
                roleFilterType: readString(profile.filters.roleFilterType) ?? undefined,
            }
            : undefined,
    }));

    const summariesById = new Map<string, z.infer<typeof ProfileSummarySchema>>();
    for (const summary of workspaceSummaries) {
        summariesById.set(summary.id, summary);
    }

    const summaries = Array.from(summariesById.values()).sort(compareProfileSummaries);
    return c.json({ success: true, profiles: summaries } as const);
});

const runtimeProfilesRoute = createRoute({
    method: "get",
    path: "/runtime",
    tags: ["Search Profiles"],
    summary: "List enabled runtime search profiles across known workspaces for worker scheduling",
    responses: {
        200: {
            description: "Runtime search profile list",
            content: {
                "application/json": {
                    schema: ProfilesRuntimeResponseSchema,
                },
            },
        },
    },
});

app.openapi(runtimeProfilesRoute, async (c) => {
    const workspaceItems = await Promise.all(
        KNOWN_WORKSPACE_SLUGS.map(async (workspaceSlug) => {
            await ensureWorkspaceSeedProfiles(workspaceSlug);
            const profiles = await listCustomProfiles(workspaceSlug);
            return profiles
                .filter(hasRuntimeSchedule)
                .map((profile) => toProfileRuntimeItem(workspaceSlug, profile));
        }),
    );

    return c.json({
        success: true as const,
        items: workspaceItems.flat(),
    }, 200);
});

// ============================================================
// POST /api/search-profiles/auto-match
// ============================================================
const autoMatchRoute = createRoute({
    method: "post",
    path: "/auto-match",
    tags: ["Search Profiles"],
    summary: "Auto-match profile from keywords",
    description: "Find the best matching search profile based on input keywords and location",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: AutoMatchRequestSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: "Match result",
            content: {
                "application/json": {
                    schema: AutoMatchResponseSchema,
                },
            },
        },
    },
});

app.openapi(autoMatchRoute, async (c) => {
    const { keywords, location } = c.req.valid("json");
    await ensureWorkspaceSeedProfiles(c.var.workspaceSlug);
    const customProfiles = await listCustomProfiles(c.var.workspaceSlug);
    const result = matchProfiles(customProfiles, keywords, location);

    return c.json({
        success: true,
        profileId: result.profile?.id,
        jobDescription: result.jobDescription,
        filterPreset: result.filterPreset,
        confidence: result.confidence,
        matchedKeywords: result.matchedKeywords,
    } as const);
});

// ============================================================
// POST /api/search-profiles
// ============================================================
const createProfileRoute = createRoute({
    method: "post",
    path: "/",
    tags: ["Search Profiles"],
    summary: "Create search profile",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: ProfilePayloadSchema,
                },
            },
        },
    },
    responses: {
        201: {
            description: "Profile created",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        profile: ProfilePayloadSchema,
                    }),
                },
            },
        },
        400: {
            description: "Invalid payload",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(false),
                        error: z.string(),
                    }),
                },
            },
        },
    },
});

app.openapi(createProfileRoute, async (c) => {
    try {
        const payload = c.req.valid("json");
        const provisional = searchProfileService.normalizeProfileInput(payload);
        const derivedId = provisional.id !== "profile"
            ? provisional.id
            : searchProfileService.normalizeProfileIdentifier(provisional.name);
        const now = new Date().toISOString();
        const normalizedProfile = searchProfileService.normalizeProfileInput(
            {
                ...provisional,
                id: derivedId,
                createdAt: provisional.createdAt ?? now,
                updatedAt: now,
            },
            {
                id: derivedId,
                name: provisional.name || derivedId,
                status: provisional.status || "active",
                location: provisional.location,
                keywords: provisional.keywords,
            }
        );
        searchProfileService.validateProfile(normalizedProfile);

        const jobDescriptionSync = await buildJobDescriptionSyncPayload(normalizedProfile, c.var.workspaceSlug);
        const profile = await createCustomProfile(normalizedProfile, c.var.workspaceSlug, jobDescriptionSync);
        return c.json({ success: true as const, profile }, 201);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create profile";
        return c.json({ success: false as const, error: message }, 400);
    }
});

// ============================================================
// POST /api/search-profiles/:id/run
// ============================================================
const runProfileRoute = createRoute({
    method: "post",
    path: "/:id/run",
    tags: ["Search Profiles"],
    summary: "Execute profile (collection dispatch)",
    request: {
        params: z.object({
            id: z.string(),
        }),
        body: {
            required: false,
            content: {
                "application/json": {
                    schema: RunProfileRequestSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: "Task dispatched",
            content: {
                "application/json": {
                    schema: RunProfileResponseSchema,
                },
            },
        },
        400: {
            description: "Invalid payload",
            content: {
                "application/json": {
                    schema: z.object({ success: z.literal(false), error: z.string() }),
                },
            },
        },
        404: {
            description: "Profile not found",
            content: {
                "application/json": {
                    schema: z.object({ success: z.literal(false), error: z.string() }),
                },
            },
        },
        502: {
            description: "Dispatch failed",
            content: {
                "application/json": {
                    schema: z.object({ success: z.literal(false), error: z.string() }),
                },
            },
        },
        403: {
            description: "Forbidden",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(false),
                        error: z.string(),
                    }),
                },
            },
        },
    },
});

app.openapi(runProfileRoute, async (c) => {
    if (process.env.ENABLE_HEADLESS_COLLECTOR !== "true") {
        return c.json({
            success: false as const,
            error: "Headless collector is not available in this environment.",
        }, 403);
    }

    const { id } = c.req.valid("param");
    const workspaceSlug = c.var.workspaceSlug;

    await ensureWorkspaceProfileById(id, workspaceSlug);
    const profile = await loadProfileById(id, workspaceSlug);
    if (!profile) {
        return c.json({ success: false as const, error: `Profile not found: ${id}` }, 404);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = RunProfileRequestSchema.safeParse(body);
    if (!parsed.success) {
        return c.json({ success: false as const, error: "Invalid run payload" }, 400);
    }

    const keyword = buildProfileRunKeyword(parsed.data.keyword, profile.keywords);
    const location = readString(parsed.data.location) ?? profile.location;
    const activeSource = Array.isArray(profile.sources)
        ? profile.sources.find((s) => s.enabled) ?? profile.sources[0]
        : undefined;
    const limit = parsed.data.limit ?? activeSource?.collectLimit ?? profile.schedule?.maxCandidates ?? 120;
    const maxPages = parsed.data.maxPages ?? activeSource?.maxPages ?? 10;
    const autoAnalyze = parsed.data.autoAnalyze ?? Boolean(profile.ai);
    const analysisTopN = parsed.data.analysisTopN ?? 10;
    const minAge = normalizePositiveInt(parsed.data.minAge ?? profile.filters?.minAge);
    const maxAge = normalizePositiveInt(parsed.data.maxAge ?? profile.filters?.maxAge);
    const maxSalary = normalizePositiveInt(parsed.data.maxSalary ?? profile.filters?.salaryRange?.max);

    if (typeof minAge === "number" && typeof maxAge === "number" && minAge > maxAge) {
        return c.json({ success: false as const, error: "minAge cannot be greater than maxAge" }, 400);
    }

    if (!keyword || !location) {
        return c.json({ success: false as const, error: "Profile keyword/location is required to run" }, 400);
    }

    try {
        const { taskId, convexUrl } = await dispatchCollectionTask({
            keyword,
            location,
            limit,
            maxPages,
            minAge,
            maxAge,
            maxSalary,
            autoAnalyze,
            analysisTopN,
        });
        const now = new Date().toISOString();
        upsertRunStatus(workspaceSlug, {
            profileId: profile.id,
            taskId,
            taskStatus: "pending",
            startedAt: now,
            updatedAt: now,
        });

        return c.json({
            success: true,
            profileId: profile.id,
            taskId,
            dispatch: {
                keyword,
                location,
                limit,
                maxPages,
                minAge,
                maxAge,
                maxSalary,
                autoAnalyze,
                analysisTopN,
                convexUrl,
            },
        } as const, 200);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to dispatch profile run";
        return c.json({ success: false as const, error: message }, 502);
    }
});

// ============================================================
// GET /api/search-profiles/:id/status
// ============================================================
const getProfileStatusRoute = createRoute({
    method: "get",
    path: "/:id/status",
    tags: ["Search Profiles"],
    summary: "Get latest run status for a profile",
    request: {
        params: z.object({
            id: z.string(),
        }),
    },
    responses: {
        200: {
            description: "Latest run status",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        status: ProfileRunStatusSchema.nullable(),
                    }),
                },
            },
        },
        404: {
            description: "Profile/status not found",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(false),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: "Forbidden",
            content: {
                "application/json": {
                    schema: z.object({ success: z.literal(false), error: z.string() }),
                },
            },
        },
    },
});

app.openapi(getProfileStatusRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceSlug = c.var.workspaceSlug;

    await ensureWorkspaceProfileById(id, workspaceSlug);
    const profile = await loadProfileById(id, workspaceSlug);
    if (!profile) {
        return c.json({ success: false as const, error: `Profile not found: ${id}` }, 404);
    }

    const store = readRunStatusStore();
    const storedStatus = store[toScopedProfileKey(workspaceSlug, profile.id)];
    if (!storedStatus) {
        return c.json({ success: true as const, status: null }, 200);
    }

    let resolvedStatus = storedStatus;
    try {
        const liveStatus = await getCollectionTaskStatus(storedStatus.taskId);
        if (liveStatus) {
            resolvedStatus = {
                ...storedStatus,
                ...liveStatus,
                updatedAt: new Date().toISOString(),
            };
            upsertRunStatus(workspaceSlug, resolvedStatus);
        }
    } catch (error) {
        logger.error("Failed to resolve profile run status:", error, { route: "search_profiles" });
    }

    return c.json({ success: true as const, status: resolvedStatus }, 200);
});

// ============================================================
// GET /api/search-profiles/:id
// ============================================================
const getRoute = createRoute({
    method: "get",
    path: "/:id",
    tags: ["Search Profiles"],
    summary: "Get search profile by ID",
    request: {
        params: z.object({
            id: z.string(),
        }),
    },
    responses: {
        200: {
            description: "Profile details",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        profile: ProfilePayloadSchema,
                    }),
                },
            },
        },
        404: {
            description: "Profile not found",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(false),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: "Forbidden",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(false),
                        error: z.string(),
                    }),
                },
            },
        },
    },
});

app.openapi(getRoute, async (c) => {
    const { id } = c.req.valid("param");
    await ensureWorkspaceProfileById(id, c.var.workspaceSlug);
    const profile = await loadProfileById(id, c.var.workspaceSlug);
    if (!profile) {
        return c.json({ success: false as const, error: `Profile not found: ${id}` }, 404);
    }
    return c.json({ success: true as const, profile }, 200);
});

// ============================================================
// PUT /api/search-profiles/:id
// ============================================================
const updateProfileRoute = createRoute({
    method: "put",
    path: "/:id",
    tags: ["Search Profiles"],
    summary: "Update search profile",
    request: {
        params: z.object({
            id: z.string(),
        }),
        body: {
            content: {
                "application/json": {
                    schema: ProfilePayloadSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: "Profile updated",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(true),
                        profile: ProfilePayloadSchema,
                    }),
                },
            },
        },
        400: {
            description: "Invalid payload",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(false),
                        error: z.string(),
                    }),
                },
            },
        },
        404: {
            description: "Profile not found",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(false),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: "Forbidden",
            content: {
                "application/json": {
                    schema: z.object({
                        success: z.literal(false),
                        error: z.string(),
                    }),
                },
            },
        },
    },
});

app.openapi(updateProfileRoute, async (c) => {
    const { id } = c.req.valid("param");
    const payload = c.req.valid("json");

    try {
        await ensureWorkspaceProfileById(id, c.var.workspaceSlug);
        const existingCustom = await findCustomProfileRecordById(id, c.var.workspaceSlug);
        if (!existingCustom) {
            return c.json({ success: false as const, error: `Profile not found: ${id}` }, 404);
        }

        const now = new Date().toISOString();
        const normalized = searchProfileService.normalizeProfileInput(
            {
                ...existingCustom.profile,
                ...(isRecord(payload) ? payload : {}),
                id: existingCustom.profile.id,
                createdAt: existingCustom.profile.createdAt ?? now,
                updatedAt: now,
            },
            existingCustom.profile
        );
        normalized.id = existingCustom.profile.id;
        searchProfileService.validateProfile(normalized);

        const jobDescriptionSync = await buildJobDescriptionSyncPayload(normalized, c.var.workspaceSlug);
        const profile = await updateCustomProfile(
            existingCustom.storageId,
            toStoredProfilePayload(normalized, { seededFromConfig: existingCustom.seededFromConfig }),
            c.var.workspaceSlug,
            jobDescriptionSync,
        );
        return c.json({ success: true as const, profile }, 200);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update profile";
        if (message.toLowerCase().includes("not found")) {
            return c.json({ success: false as const, error: message }, 404);
        }
        return c.json({ success: false as const, error: message }, 400);
    }
});

// ============================================================
// DELETE /api/search-profiles/:id
// ============================================================
const deleteProfileRoute = createRoute({
    method: "delete",
    path: "/:id",
    tags: ["Search Profiles"],
    summary: "Delete search profile",
    request: {
        params: z.object({
            id: z.string(),
        }),
    },
    responses: {
        200: {
            description: "Profile deleted",
            content: {
                "application/json": {
                    schema: z.object({ success: z.literal(true) }),
                },
            },
        },
        404: {
            description: "Profile not found",
            content: {
                "application/json": {
                    schema: z.object({ success: z.literal(false), error: z.string() }),
                },
            },
        },
        403: {
            description: "Forbidden",
            content: {
                "application/json": {
                    schema: z.object({ success: z.literal(false), error: z.string() }),
                },
            },
        },
    },
});

app.openapi(deleteProfileRoute, async (c) => {
    const { id } = c.req.valid("param");
    await ensureWorkspaceProfileById(id, c.var.workspaceSlug);
    const existingCustom = await findCustomProfileRecordById(id, c.var.workspaceSlug);

    if (existingCustom) {
        if (existingCustom.seededFromConfig) {
            await updateCustomProfile(
                existingCustom.storageId,
                toStoredProfilePayload(existingCustom.profile, {
                    seededFromConfig: true,
                    templateHash: existingCustom.templateHash,
                    deletedAt: Date.now(),
                }),
                c.var.workspaceSlug,
            );
        } else {
            await deleteCustomProfile(existingCustom.storageId, c.var.workspaceSlug);
        }

        return c.json({ success: true as const }, 200);
    }

    return c.json({ success: false as const, error: `Profile not found: ${id}` }, 404);
});

export default app;
