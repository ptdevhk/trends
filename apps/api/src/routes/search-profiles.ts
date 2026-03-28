/**
 * Search Profiles API Routes
 */

import fs from "node:fs";
import path from "node:path";

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
    findWorkspaceSearchProfileTemplate,
    generateStructuredJobDescriptionContent,
    getWorkspaceSearchProfileTemplates,
    isValidWorkspace,
    WORKSPACE_TEAMS,
} from "@trends/shared";

import {
    matchSearchProfilesByKeywords,
    searchProfileService,
    type AutoMatchResult,
    type SearchProfile,
} from "../services/search-profile-service.js";

const app = new OpenAPIHono();

// Schemas
const ProfileSummarySchema = z.object({
    id: z.string(),
    name: z.string(),
    updatedAt: z.string(),
    status: z.enum(["active", "paused", "archived"]),
    location: z.string(),
    keywords: z.array(z.string()),
    quickStart: z.object({
        enabled: z.boolean(),
        rank: z.number().optional(),
        label: z.string().optional(),
        description: z.string().optional(),
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

const ProfilePayloadSchema = z.record(z.unknown());
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
        autoAnalyze: z.boolean(),
        analysisTopN: z.number(),
        convexUrl: z.string(),
    }),
});

const ProfileRunStatusSchema = z.object({
    profileId: z.string(),
    taskId: z.string(),
    taskStatus: z.enum(["pending", "processing", "completed", "failed", "cancelled", "unknown"]),
    startedAt: z.string(),
    updatedAt: z.string(),
    completedAt: z.string().optional(),
    resultCount: z.number().int().optional(),
    extracted: z.number().int().optional(),
    submitted: z.number().int().optional(),
    error: z.string().optional(),
});

type ProfileRunStatus = z.infer<typeof ProfileRunStatusSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : undefined;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}

function toIsoTimestamp(value: unknown): string | undefined {
    const numeric = readNumber(value);
    if (numeric === undefined) {
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

function getRunStatusFilePath(): string {
    return path.join(searchProfileService.projectRoot, "output", "search-profile-runs.json");
}

function readRunStatusStore(): Record<string, ProfileRunStatus> {
    try {
        const content = fs.readFileSync(getRunStatusFilePath(), "utf8");
        const parsed = JSON.parse(content) as unknown;
        if (!isRecord(parsed)) {
            return {};
        }

        const store: Record<string, ProfileRunStatus> = {};
        for (const [key, value] of Object.entries(parsed)) {
            const validated = ProfileRunStatusSchema.safeParse(value);
            if (!validated.success) {
                continue;
            }
            store[key] = validated.data;
        }
        return store;
    } catch {
        return {};
    }
}

function writeRunStatusStore(store: Record<string, ProfileRunStatus>): void {
    const filePath = getRunStatusFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
}

function toScopedProfileKey(workspaceSlug: string, profileId: string): string {
    return `${workspaceSlug}:${profileId}`;
}

function upsertRunStatus(workspaceSlug: string, status: ProfileRunStatus): void {
    const store = readRunStatusStore();
    store[toScopedProfileKey(workspaceSlug, status.profileId)] = status;
    writeRunStatusStore(store);
}

function readEnvVarFromFile(filePath: string, key: string): string | null {
    if (!fs.existsSync(filePath)) {
        return null;
    }

    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }

        const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match || match[1] !== key) {
            continue;
        }

        let value = match[2].trim();
        const hasDoubleQuotes = value.startsWith("\"") && value.endsWith("\"");
        const hasSingleQuotes = value.startsWith("'") && value.endsWith("'");
        if (hasDoubleQuotes || hasSingleQuotes) {
            value = value.slice(1, -1);
        }

        return value;
    }

    return null;
}

function resolveConvexUrl(): string {
    if (process.env.CONVEX_URL) {
        return process.env.CONVEX_URL;
    }
    if (process.env.VITE_CONVEX_URL) {
        return process.env.VITE_CONVEX_URL;
    }

    const projectRoot = searchProfileService.projectRoot;
    const candidateFiles = [
        path.join(projectRoot, "packages", "convex", ".env.local"),
        path.join(projectRoot, "apps", "web", ".env.local"),
        path.join(projectRoot, ".env.local"),
        path.join(projectRoot, ".env"),
    ];

    for (const filePath of candidateFiles) {
        const direct = readEnvVarFromFile(filePath, "CONVEX_URL");
        if (direct) {
            return direct;
        }

        const vite = readEnvVarFromFile(filePath, "VITE_CONVEX_URL");
        if (vite) {
            return vite;
        }
    }

    return "http://127.0.0.1:3210";
}

async function dispatchCollectionTask(args: {
    keyword: string;
    location: string;
    limit: number;
    maxPages: number;
    minAge?: number;
    maxAge?: number;
    autoAnalyze: boolean;
    analysisTopN: number;
}): Promise<{ taskId: string; convexUrl: string }> {
    const convexUrl = resolveConvexUrl().replace(/\/$/, "");
    const response = await fetch(`${convexUrl}/api/mutation`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({
            path: "resume_tasks:dispatch",
            args,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Convex dispatch failed (${response.status}): ${text}`);
    }

    const payload = await response.json() as {
        status?: string;
        value?: unknown;
        errorMessage?: string;
    };

    if (payload.status !== "success") {
        throw new Error(payload.errorMessage || "Convex mutation failed.");
    }

    return {
        taskId: String(payload.value),
        convexUrl,
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
    const convexUrl = resolveConvexUrl().replace(/\/$/, "");
    const response = await fetch(`${convexUrl}/api/query`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({
            path: "resume_tasks:getById",
            args: { taskId },
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Convex task query failed (${response.status}): ${text}`);
    }

    const payload = await response.json() as {
        status?: string;
        value?: unknown;
        errorMessage?: string;
    };

    if (payload.status !== "success") {
        throw new Error(payload.errorMessage || "Convex query failed.");
    }

    if (!isRecord(payload.value)) {
        return null;
    }

    const task = payload.value;

    const results = isRecord(task.results) ? task.results : undefined;
    const progress = isRecord(task.progress) ? task.progress : undefined;
    const submitted = readNumber(results?.submitted);
    const extracted = readNumber(results?.extracted);
    const progressCurrent = readNumber(progress?.current);
    const resultCount = submitted ?? extracted ?? progressCurrent;

  return {
    taskStatus: normalizeTaskStatus(task.status),
    completedAt: toIsoTimestamp(task.completedAt),
    resultCount: resultCount !== undefined ? Math.round(resultCount) : undefined,
    extracted: extracted !== undefined ? Math.round(extracted) : undefined,
    submitted: submitted !== undefined ? Math.round(submitted) : undefined,
    error: readString(task.error),
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
    return readNumber(profilePayload.deletedAt);
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
    }
): Record<string, unknown> {
    return {
        ...profile,
        ...(options?.seededFromConfig ? { seedSource: CONFIG_SEED_SOURCE } : {}),
        ...(typeof options?.deletedAt === "number" ? { deletedAt: options.deletedAt } : {}),
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
    deletedAt?: number;
};

async function callConvex(
    type: "query" | "mutation",
    pathName: string,
    args: Record<string, unknown>
): Promise<unknown> {
    const convexUrl = resolveConvexUrl().replace(/\/$/, "");
    const response = await fetch(`${convexUrl}/api/${type}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({ path: pathName, args }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Convex ${type} failed (${response.status}): ${text}`);
    }

    const payload = await response.json() as unknown;
    if (!isRecord(payload) || payload.status !== "success") {
        const errorMessage = isRecord(payload) ? readString(payload.errorMessage) : undefined;
        throw new Error(errorMessage ?? `Convex ${type} failed for ${pathName}`);
    }

    return payload.value;
}

async function listCustomProfileRecords(
    workspaceSlug: string,
    options?: {
        includeDeleted?: boolean;
    }
): Promise<ResolvedCustomProfileRecord[]> {
    const value = await callConvex("query", "search_profiles:list", { workspaceSlug });
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
    const value = await callConvex("query", "search_profiles:getById", { id, workspaceSlug });
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
        deletedAt,
    };
}

async function ensureWorkspaceSeedProfiles(workspaceSlug: string): Promise<void> {
    const existingRecords = await listCustomProfileRecords(workspaceSlug, { includeDeleted: true });
    const existingIds = new Set(existingRecords.map((record) => record.logicalId));

    for (const template of getWorkspaceSearchProfileTemplates(workspaceSlug)) {
        const profile = searchProfileService.normalizeProfileInput(template.profile);
        const logicalId = searchProfileService.normalizeProfileIdentifier(profile.id);
        if (existingIds.has(logicalId)) {
            continue;
        }

        await createCustomProfile(
            toStoredProfilePayload(profile, { seededFromConfig: true }),
            workspaceSlug,
        );
        existingIds.add(logicalId);
    }
}

async function ensureWorkspaceProfileById(id: string, workspaceSlug: string): Promise<void> {
    const existing = await findCustomProfileRecordById(id, workspaceSlug, { includeDeleted: true });
    if (existing) {
        return;
    }

    const template = findWorkspaceSearchProfileTemplate(id, workspaceSlug);
    if (!template) {
        return;
    }

    const profile = searchProfileService.normalizeProfileInput(template.profile);
    await createCustomProfile(
        toStoredProfilePayload(profile, { seededFromConfig: true }),
        workspaceSlug,
    );
}

async function getLinkedCustomJobDescription(
    id: string,
    workspaceSlug: string
): Promise<ConvexJobDescriptionRecord | null> {
    let value: unknown;
    try {
        value = await callConvex("query", "job_descriptions:get", { id });
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
        location: readString(jobDescription.location),
        industryTags: normalizeKeywordList(jobDescription.industryTags),
        minExperience: readNumber(jobDescription.minExperience),
        maxExperience: readNumber(jobDescription.maxExperience),
        minAge: readNumber(jobDescription.minAge),
        maxAge: readNumber(jobDescription.maxAge),
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
    const value = await callConvex("mutation", "search_profiles:create", {
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
    const value = await callConvex("mutation", "search_profiles:update", {
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
    const value = await callConvex("mutation", "search_profiles:remove", {
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
        quickStart: profile.quickStart,
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
    const limit = parsed.data.limit ?? profile.schedule?.maxCandidates ?? 120;
    const maxPages = parsed.data.maxPages ?? 10;
    const autoAnalyze = parsed.data.autoAnalyze ?? Boolean(profile.ai);
    const analysisTopN = parsed.data.analysisTopN ?? 10;
    const minAge = normalizePositiveInt(parsed.data.minAge ?? profile.filters?.minAge);
    const maxAge = normalizePositiveInt(parsed.data.maxAge ?? profile.filters?.maxAge);

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
        console.error("Failed to resolve profile run status:", error);
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
