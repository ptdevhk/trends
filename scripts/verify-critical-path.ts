import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ConvexHttpClient } from "convex/browser";

import { api } from "../packages/convex/convex/_generated/api.js";
import type { Doc } from "../packages/convex/convex/_generated/dataModel.js";

export type VerifyMode = "dual" | "live" | "seeded";
export type VerifyStatus = "PASS" | "DEGRADED_PASS" | "FAIL";

type Logger = {
    info: (message: string) => void;
    warn: (message: string) => void;
};

type SeedResume = {
    externalId: string;
    content: Record<string, unknown>;
    hash: string;
    source: string;
    tags: string[];
};

export type StageResult = {
    status: VerifyStatus;
    evidence: Record<string, unknown>;
    error?: string;
    fallbackUsed: boolean;
};

export type StageResults = {
    collection: StageResult;
    search: StageResult;
    analysis: StageResult;
};

export type VerificationReport = {
    mode: VerifyMode;
    keyword: string;
    location: string;
    convexUrl: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    stages: StageResults;
    overallStatus: VerifyStatus;
};

type CliOptions = {
    mode: VerifyMode;
    keyword: string;
    location: string;
    collectionTimeoutSec: number;
    analysisTimeoutSec: number;
    json: boolean;
};

const DEFAULT_MODE: VerifyMode = "dual";
const DEFAULT_KEYWORD = "CNC";
const DEFAULT_LOCATION = "广东";
const DEFAULT_COLLECTION_TIMEOUT_SEC = 180;
const DEFAULT_ANALYSIS_TIMEOUT_SEC = 300;
const DEFAULT_COLLECTION_LIMIT = 120;
const DEFAULT_COLLECTION_MAX_PAGES = 5;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_WORKER_HEALTH_FRESHNESS_MS = 15_000;

function createLogger(json: boolean): Logger {
    return {
        info: (message: string) => {
            if (!json) {
                console.log(message);
            }
        },
        warn: (message: string) => {
            if (!json) {
                console.warn(message);
            }
        },
    };
}

function printUsage(): void {
    console.log("Usage: verify-critical-path.ts [options]");
    console.log("");
    console.log("Options:");
    console.log("  --mode=dual|live|seeded           Verification mode (default: dual)");
    console.log("  --keyword=<term>                  Search keyword (default: CNC)");
    console.log("  --location=<term>                 Collection location (default: 广东)");
    console.log("  --collection-timeout-sec=<number> Collection timeout in seconds (default: 180)");
    console.log("  --analysis-timeout-sec=<number>   Analysis timeout in seconds (default: 300)");
    console.log("  --json                            Print machine-readable JSON output");
    console.log("  --help                            Show this help");
}

function readCliValue(argv: string[], name: string): string | undefined {
    const fullFlag = `--${name}`;
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === fullFlag) {
            return argv[i + 1];
        }
        if (arg.startsWith(`${fullFlag}=`)) {
            return arg.slice(fullFlag.length + 1);
        }
    }
    return undefined;
}

function hasCliFlag(argv: string[], name: string): boolean {
    return argv.includes(`--${name}`);
}

function parseBoolean(value: string | undefined): boolean {
    if (!value) {
        return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

function parseMode(value: string | undefined): VerifyMode {
    if (!value) {
        return DEFAULT_MODE;
    }
    if (value === "dual" || value === "live" || value === "seeded") {
        return value;
    }
    return DEFAULT_MODE;
}

function resolveProjectRoot(): string {
    const scriptPath = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(scriptPath), "..");
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

function resolveConvexUrl(projectRoot: string): string {
    if (process.env.CONVEX_URL) {
        return process.env.CONVEX_URL;
    }
    if (process.env.VITE_CONVEX_URL) {
        return process.env.VITE_CONVEX_URL;
    }

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

function parseCliArgs(argv: string[]): CliOptions {
    if (hasCliFlag(argv, "help") || hasCliFlag(argv, "h")) {
        printUsage();
        process.exit(0);
    }

    const mode = parseMode(readCliValue(argv, "mode") ?? process.env.MODE);
    const keyword = (readCliValue(argv, "keyword") ?? process.env.KEYWORD ?? DEFAULT_KEYWORD).trim() || DEFAULT_KEYWORD;
    const location = (readCliValue(argv, "location") ?? process.env.LOCATION ?? DEFAULT_LOCATION).trim() || DEFAULT_LOCATION;
    const collectionTimeoutSec = parsePositiveInt(
        readCliValue(argv, "collection-timeout-sec") ?? process.env.COLLECTION_TIMEOUT_SEC,
        DEFAULT_COLLECTION_TIMEOUT_SEC
    );
    const analysisTimeoutSec = parsePositiveInt(
        readCliValue(argv, "analysis-timeout-sec") ?? process.env.ANALYSIS_TIMEOUT_SEC,
        DEFAULT_ANALYSIS_TIMEOUT_SEC
    );

    const jsonFlag = hasCliFlag(argv, "json") || parseBoolean(process.env.JSON);

    return {
        mode,
        keyword,
        location,
        collectionTimeoutSec,
        analysisTimeoutSec,
        json: jsonFlag,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function readStringField(record: Record<string, unknown>, key: string): string | null {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    return null;
}

function normalizeIdentityToken(value: string): string {
    return value.trim().toLowerCase();
}

function normalizeProfileUrlForIdentity(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const lowered = trimmed.toLowerCase();
    if (lowered === "javascript:;" || lowered === "javascript:void(0)" || lowered === "#") {
        return null;
    }

    let parsed: URL | null = null;
    try {
        parsed = new URL(trimmed);
    } catch (error) {
        try {
            parsed = new URL(`https://${trimmed}`);
        } catch (fallbackError) {
            console.error("Failed to normalize profile URL for verification identity.", error, fallbackError);
            parsed = null;
        }
    }

    if (!parsed) {
        const fallback = lowered
            .replace(/^https?:\/\//, "")
            .replace(/#.*$/, "")
            .replace(/\/+$/, "");
        return fallback || null;
    }

    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const sortedParams = Array.from(parsed.searchParams.entries())
        .filter(([key]) => !key.toLowerCase().startsWith("utm_"))
        .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
            if (leftKey === rightKey) {
                return leftValue.localeCompare(rightValue);
            }
            return leftKey.localeCompare(rightKey);
        });

    const query = sortedParams.length > 0
        ? `?${sortedParams
            .map(([key, paramValue]) => `${encodeURIComponent(key)}=${encodeURIComponent(paramValue)}`)
            .join("&")}`
        : "";

    return `${parsed.hostname.toLowerCase()}${path}${query}`.toLowerCase();
}

function extractResumesFromPayload(payload: unknown): Record<string, unknown>[] {
    if (Array.isArray(payload)) {
        return payload.filter(isRecord);
    }

    if (!isRecord(payload)) {
        return [];
    }

    const data = payload.data;
    if (Array.isArray(data)) {
        return data.filter(isRecord);
    }

    const resumes = payload.resumes;
    if (Array.isArray(resumes)) {
        return resumes.filter(isRecord);
    }

    return [];
}

function extractResumeSource(payload: unknown): string {
    if (!isRecord(payload)) {
        return "sample-initial";
    }

    const metadata = payload.metadata;
    if (!isRecord(metadata)) {
        return "sample-initial";
    }

    const sourceUrl = metadata.sourceUrl;
    if (typeof sourceUrl !== "string" || !sourceUrl.trim()) {
        return "sample-initial";
    }

    if (URL.canParse(sourceUrl)) {
        const hostname = new URL(sourceUrl).hostname;
        if (hostname) {
            return hostname;
        }
    }

    return sourceUrl;
}

function resolveResumeExternalId(resume: Record<string, unknown>, index: number): string {
    const profileUrl = readStringField(resume, "profileUrl");
    if (profileUrl) {
        const normalizedProfileUrl = normalizeProfileUrlForIdentity(profileUrl);
        if (normalizedProfileUrl) {
            return normalizedProfileUrl;
        }
    }

    const resumeId = readStringField(resume, "resumeId");
    if (resumeId) {
        return normalizeIdentityToken(resumeId);
    }

    const perUserId = readStringField(resume, "perUserId");
    if (perUserId) {
        return normalizeIdentityToken(perUserId);
    }

    const externalId = readStringField(resume, "externalId");
    if (externalId) {
        return normalizeIdentityToken(externalId);
    }

    const name = readStringField(resume, "name") ?? "resume";
    const extractedAt = readStringField(resume, "extractedAt");
    if (extractedAt) {
        return `${name}-${extractedAt}`;
    }

    return `sample-initial-${index + 1}`;
}

function loadSeedResumes(projectRoot: string): SeedResume[] {
    const samplePath = path.join(projectRoot, "output", "resumes", "samples", "sample-initial.json");
    if (!fs.existsSync(samplePath)) {
        throw new Error(`Resume sample file not found: ${samplePath}`);
    }

    const raw: unknown = JSON.parse(fs.readFileSync(samplePath, "utf8"));
    const source = extractResumeSource(raw);
    const resumes = extractResumesFromPayload(raw).slice(0, 100);

    return resumes.map((resume, index) => {
        const externalId = resolveResumeExternalId(resume, index);
        const hash = createHash("sha256").update(JSON.stringify(resume), "utf8").digest("hex");
        return {
            externalId,
            content: resume,
            hash,
            source,
            tags: ["sample-initial", "seed"],
        };
    });
}

function chunkItems<T>(items: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
}

function hasSearchText(resume: Doc<"resumes">): boolean {
    return typeof resume.searchText === "string" && resume.searchText.trim().length > 0;
}

function resolveResumeIdentityKeyForEvidence(
    resume: Pick<Doc<"resumes">, "_id" | "identityKey" | "externalId">
): string {
    if (typeof resume.identityKey === "string" && resume.identityKey.trim()) {
        return resume.identityKey;
    }
    if (typeof resume.externalId === "string" && resume.externalId.trim()) {
        return `externalId:${resume.externalId.trim().toLowerCase()}`;
    }
    return String(resume._id);
}

export function countIdentityDistinctHits(
    resumes: Array<Pick<Doc<"resumes">, "_id" | "identityKey" | "externalId">>
): number {
    return new Set(resumes.map((resume) => resolveResumeIdentityKeyForEvidence(resume))).size;
}

function stagePass(evidence: Record<string, unknown>, fallbackUsed: boolean = false): StageResult {
    return {
        status: "PASS",
        evidence,
        fallbackUsed,
    };
}

function stageDegraded(evidence: Record<string, unknown>, error: string, fallbackUsed: boolean): StageResult {
    return {
        status: "DEGRADED_PASS",
        evidence,
        error,
        fallbackUsed,
    };
}

function stageFail(evidence: Record<string, unknown>, error: string, fallbackUsed: boolean = false): StageResult {
    return {
        status: "FAIL",
        evidence,
        error,
        fallbackUsed,
    };
}

function isCollectionTerminal(status: Doc<"collection_tasks">["status"]): boolean {
    return status === "completed" || status === "failed" || status === "cancelled";
}

function isAnalysisTerminal(status: Doc<"analysis_tasks">["status"]): boolean {
    return status === "completed" || status === "failed" || status === "cancelled";
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollTaskById<TTask extends { _id: unknown; status: string }>(
    fetchTasks: () => Promise<TTask[]>,
    taskId: string,
    timeoutSec: number,
    isTerminal: (status: TTask["status"]) => boolean
): Promise<{ task: TTask | null; timedOut: boolean; elapsedMs: number }> {
    const startedAt = Date.now();
    const timeoutMs = timeoutSec * 1_000;
    let lastTask: TTask | null = null;

    while (Date.now() - startedAt < timeoutMs) {
        const tasks = await fetchTasks();
        const matched = tasks.find((task) => String(task._id) === taskId) ?? null;
        if (matched) {
            lastTask = matched;
            if (isTerminal(matched.status)) {
                return {
                    task: matched,
                    timedOut: false,
                    elapsedMs: Date.now() - startedAt,
                };
            }
        }
        await sleep(DEFAULT_POLL_INTERVAL_MS);
    }

    return {
        task: lastTask,
        timedOut: true,
        elapsedMs: Date.now() - startedAt,
    };
}

async function runLiveCollectionStage(
    client: ConvexHttpClient,
    options: CliOptions,
    logger: Logger
): Promise<StageResult> {
    const beforeResumes = await client.query(api.resumes.list, { limit: 200 });
    const stalePending = await client.mutation(api.resume_tasks.failStalePending, {
        staleMs: options.collectionTimeoutSec * 1_000,
    });
    const workerHealth = await client.query(api.resume_tasks.getWorkerHealth, {
        freshnessMs: DEFAULT_WORKER_HEALTH_FRESHNESS_MS,
    });

    if (!workerHealth.hasHealthyWorker) {
        return stageFail(
            {
                mode: "live",
                preflight: {
                    stalePending,
                    workerHealth,
                },
                resumesBefore: beforeResumes.length,
            },
            "Collection preflight failed: no healthy scraper worker heartbeat detected."
        );
    }

    const taskId = await client.mutation(api.resume_tasks.dispatch, {
        keyword: options.keyword,
        location: options.location,
        limit: DEFAULT_COLLECTION_LIMIT,
        maxPages: DEFAULT_COLLECTION_MAX_PAGES,
    });
    logger.info(`[collection] dispatched live task ${String(taskId)}.`);

    const pollResult = await pollTaskById(
        () => client.query(api.resume_tasks.list, {}),
        String(taskId),
        options.collectionTimeoutSec,
        isCollectionTerminal
    );

    const afterResumes = await client.query(api.resumes.list, { limit: 200 });

    if (pollResult.timedOut) {
        return stageFail(
            {
                mode: "live",
                taskId: String(taskId),
                timeoutSec: options.collectionTimeoutSec,
                elapsedMs: pollResult.elapsedMs,
                lastStatus: pollResult.task?.status,
                lastTaskStatus: pollResult.task?.lastStatus ?? null,
                preflight: {
                    stalePending,
                    workerHealth,
                },
                resumesBefore: beforeResumes.length,
                resumesAfter: afterResumes.length,
            },
            "Collection task timed out before reaching a terminal state."
        );
    }

    const task = pollResult.task;
    if (!task) {
        return stageFail(
            {
                mode: "live",
                taskId: String(taskId),
                preflight: {
                    stalePending,
                    workerHealth,
                },
                resumesBefore: beforeResumes.length,
                resumesAfter: afterResumes.length,
            },
            "Collection task could not be found in resume_tasks.list."
        );
    }

    if (task.status !== "completed") {
        return stageFail(
            {
                mode: "live",
                taskId: String(taskId),
                taskStatus: task.status,
                taskError: task.error ?? null,
                taskLastStatus: task.lastStatus ?? null,
                progress: task.progress,
                preflight: {
                    stalePending,
                    workerHealth,
                },
                resumesBefore: beforeResumes.length,
                resumesAfter: afterResumes.length,
            },
            `Collection task ended with status ${task.status}.`
        );
    }

    if (afterResumes.length === 0) {
        return stageFail(
            {
                mode: "live",
                taskId: String(taskId),
                taskStatus: task.status,
                progress: task.progress,
                preflight: {
                    stalePending,
                    workerHealth,
                },
                resumesBefore: beforeResumes.length,
                resumesAfter: afterResumes.length,
            },
            "Collection completed but no resumes are visible."
        );
    }

    return stagePass({
        mode: "live",
        taskId: String(taskId),
        taskStatus: task.status,
        taskLastStatus: task.lastStatus ?? null,
        progress: task.progress,
        preflight: {
            stalePending,
            workerHealth,
        },
        resumesBefore: beforeResumes.length,
        resumesAfter: afterResumes.length,
        resumesAdded: afterResumes.length - beforeResumes.length,
    });
}

async function runSeededCollectionStage(
    client: ConvexHttpClient,
    projectRoot: string,
    keyword: string,
    location: string
): Promise<StageResult> {
    const keywordAnchorId = `verify-keyword-anchor:${keyword.toLowerCase()}:${location.toLowerCase()}`;
    const keywordAnchorResume: SeedResume = {
        externalId: keywordAnchorId,
        content: {
            name: "Verifier Keyword Anchor",
            location,
            jobIntention: `${keyword} 销售工程师`,
            selfIntro: `This deterministic seeded resume ensures keyword search coverage for ${keyword}.`,
            workHistory: [
                { raw: `Worked on ${keyword} opportunities and customer development.` },
            ],
        },
        hash: createHash("sha256").update(`${keywordAnchorId}:${keyword}:${location}`, "utf8").digest("hex"),
        source: "verify-critical-path",
        tags: ["seed", "verify-critical-path"],
    };

    const existing = await client.query(api.resumes.list, { limit: 200 });
    if (existing.length > 0) {
        const ensureAnchor = await client.mutation(api.seed.seedResumes, { resumes: [keywordAnchorResume] });
        const refreshed = await client.query(api.resumes.list, { limit: 200 });
        return stagePass({
            mode: "seeded",
            action: "reused-existing-resumes",
            existingCount: refreshed.length,
            existingWithSearchText: refreshed.filter(hasSearchText).length,
            keywordAnchor: ensureAnchor,
            keywordAnchorId,
        });
    }

    const seedResumes = loadSeedResumes(projectRoot);
    if (seedResumes.length === 0) {
        return stageFail(
            {
                mode: "seeded",
                action: "load-sample",
                seededCount: 0,
            },
            "Sample file was loaded but contains no resumes to seed."
        );
    }

    const batches = chunkItems(seedResumes, 50);
    let inserted = 0;
    let skipped = 0;
    for (const batch of batches) {
        const result = await client.mutation(api.seed.seedResumes, { resumes: batch });
        inserted += result.inserted;
        skipped += result.skipped;
    }
    const anchorResult = await client.mutation(api.seed.seedResumes, { resumes: [keywordAnchorResume] });

    const afterSeed = await client.query(api.resumes.list, { limit: 200 });
    if (afterSeed.length === 0) {
        return stageFail(
            {
                mode: "seeded",
                action: "seeded",
                inserted,
                skipped,
                countAfterSeed: afterSeed.length,
            },
            "Seeding completed but resumes.list still returned 0 records."
        );
    }

    return stagePass({
        mode: "seeded",
        action: "seeded",
        inserted,
        skipped,
        keywordAnchor: anchorResult,
        keywordAnchorId,
        countAfterSeed: afterSeed.length,
        withSearchText: afterSeed.filter(hasSearchText).length,
    });
}

export function classifyDualCollectionResult(liveResult: StageResult, seededResult: StageResult): StageResult {
    if (liveResult.status === "PASS") {
        return liveResult;
    }

    if (seededResult.status === "PASS") {
        return stageDegraded(
            {
                mode: "dual",
                live: liveResult,
                seeded: seededResult,
            },
            liveResult.error ?? "Live collection failed; seeded fallback passed.",
            true
        );
    }

    if (seededResult.status === "DEGRADED_PASS") {
        return stageDegraded(
            {
                mode: "dual",
                live: liveResult,
                seeded: seededResult,
            },
            seededResult.error ?? liveResult.error ?? "Live collection failed and fallback was degraded.",
            true
        );
    }

    return stageFail(
        {
            mode: "dual",
            live: liveResult,
            seeded: seededResult,
        },
        seededResult.error ?? liveResult.error ?? "Both live collection and seeded fallback failed.",
        true
    );
}

async function runCollectionStage(
    client: ConvexHttpClient,
    options: CliOptions,
    projectRoot: string,
    logger: Logger
): Promise<StageResult> {
    if (options.mode === "live") {
        return runLiveCollectionStage(client, options, logger);
    }
    if (options.mode === "seeded") {
        return runSeededCollectionStage(client, projectRoot, options.keyword, options.location);
    }

    const liveResult = await runLiveCollectionStage(client, options, logger);
    if (liveResult.status === "PASS") {
        return liveResult;
    }

    logger.warn(`[collection] live mode failed (${liveResult.error ?? "unknown error"}), running seeded fallback.`);
    const seededResult = await runSeededCollectionStage(client, projectRoot, options.keyword, options.location);
    return classifyDualCollectionResult(liveResult, seededResult);
}

async function runSearchStage(client: ConvexHttpClient, keyword: string): Promise<StageResult> {
    const listResults = await client.query(api.resumes.list, { limit: 200 });
    const searchableCount = listResults.filter(hasSearchText).length;
    const positiveHits = await client.query(api.resumes.search, { query: keyword, limit: 50 });
    const negativeHits = await client.query(api.resumes.search, { query: "__nohit__", limit: 50 });

    const rawHitCount = positiveHits.length;
    const identityDistinctHitCount = countIdentityDistinctHits(positiveHits);
    const sentinelNoHitCount = negativeHits.length;
    const searchPass = rawHitCount > 0 && sentinelNoHitCount === 0;

    if (!searchPass) {
        return stageFail(
            {
                keyword,
                resumeCount: listResults.length,
                searchableCount,
                rawHitCount,
                identityDistinctHitCount,
                sentinelNoHitCount,
                positiveHits: rawHitCount,
                negativeHits: sentinelNoHitCount,
            },
            "Search verification failed. Expected positive hits > 0 and sentinel negative hits = 0."
        );
    }

    return stagePass({
        keyword,
        resumeCount: listResults.length,
        searchableCount,
        rawHitCount,
        identityDistinctHitCount,
        sentinelNoHitCount,
        positiveHits: rawHitCount,
        negativeHits: sentinelNoHitCount,
    });
}

async function runAnalysisStage(
    client: ConvexHttpClient,
    keyword: string,
    timeoutSec: number
): Promise<StageResult> {
    const searchHits = await client.query(api.resumes.search, { query: keyword, limit: 10 });
    const listFallback = searchHits.length > 0 ? [] : await client.query(api.resumes.list, { limit: 10 });
    const candidates = searchHits.length > 0 ? searchHits : listFallback;
    const resumeIds = candidates.map((candidate) => candidate._id);

    if (resumeIds.length === 0) {
        return stageFail(
            {
                keyword,
                candidateCount: 0,
            },
            "Analysis verification failed: no candidate resume IDs available."
        );
    }

    const taskId = await client.mutation(api.analysis_tasks.dispatch, {
        keywords: [keyword],
        resumeIds,
    });

    const pollResult = await pollTaskById(
        () => client.query(api.analysis_tasks.list, {}),
        String(taskId),
        timeoutSec,
        isAnalysisTerminal
    );

    if (pollResult.timedOut) {
        return stageFail(
            {
                taskId: String(taskId),
                timeoutSec,
                elapsedMs: pollResult.elapsedMs,
                taskStatus: pollResult.task?.status ?? null,
                lastStatus: pollResult.task?.lastStatus ?? null,
                candidateCount: resumeIds.length,
            },
            "Analysis task timed out before reaching a terminal state."
        );
    }

    const task = pollResult.task;
    if (!task) {
        return stageFail(
            {
                taskId: String(taskId),
                candidateCount: resumeIds.length,
            },
            "Analysis task could not be found in analysis_tasks.list."
        );
    }

    if (task.status !== "completed") {
        return stageFail(
            {
                taskId: String(taskId),
                taskStatus: task.status,
                taskError: task.error ?? null,
                lastStatus: task.lastStatus ?? null,
                candidateCount: resumeIds.length,
            },
            `Analysis task ended with status ${task.status}.`
        );
    }

    const analyzed = task.results?.analyzed ?? 0;
    if (analyzed <= 0) {
        return stageFail(
            {
                taskId: String(taskId),
                taskStatus: task.status,
                taskResults: task.results ?? null,
                candidateCount: resumeIds.length,
            },
            "Analysis task completed but results.analyzed is 0."
        );
    }

    return stagePass({
        taskId: String(taskId),
        taskStatus: task.status,
        taskResults: task.results ?? null,
        candidateCount: resumeIds.length,
    });
}

export function reduceOverallStatus(stageResults: StageResult[]): VerifyStatus {
    if (stageResults.some((stage) => stage.status === "FAIL")) {
        return "FAIL";
    }
    if (stageResults.some((stage) => stage.status === "DEGRADED_PASS")) {
        return "DEGRADED_PASS";
    }
    return "PASS";
}

export function buildVerificationReport(input: {
    mode: VerifyMode;
    keyword: string;
    location: string;
    convexUrl: string;
    startedAt: string;
    finishedAt: string;
    stages: StageResults;
}): VerificationReport {
    const startedMs = Date.parse(input.startedAt);
    const finishedMs = Date.parse(input.finishedAt);
    const durationMs = Number.isFinite(startedMs) && Number.isFinite(finishedMs)
        ? Math.max(0, finishedMs - startedMs)
        : 0;

    return {
        mode: input.mode,
        keyword: input.keyword,
        location: input.location,
        convexUrl: input.convexUrl,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        durationMs,
        stages: input.stages,
        overallStatus: reduceOverallStatus([
            input.stages.collection,
            input.stages.search,
            input.stages.analysis,
        ]),
    };
}

export function toJsonOutput(report: VerificationReport): string {
    return JSON.stringify(report, null, 2);
}

export function statusToExitCode(status: VerifyStatus): number {
    if (status === "PASS") {
        return 0;
    }
    if (status === "DEGRADED_PASS") {
        return 2;
    }
    return 1;
}

export async function runVerification(
    client: ConvexHttpClient,
    options: CliOptions,
    projectRoot: string,
    convexUrl: string,
    logger: Logger
): Promise<VerificationReport> {
    const startedAt = new Date().toISOString();

    let collection: StageResult;
    try {
        collection = await runCollectionStage(client, options, projectRoot, logger);
    } catch (error) {
        collection = stageFail(
            {
                mode: options.mode,
            },
            error instanceof Error ? error.message : "Unknown collection stage error."
        );
    }

    let search: StageResult;
    try {
        search = await runSearchStage(client, options.keyword);
    } catch (error) {
        search = stageFail(
            {
                keyword: options.keyword,
            },
            error instanceof Error ? error.message : "Unknown search stage error."
        );
    }

    let analysis: StageResult;
    try {
        analysis = await runAnalysisStage(client, options.keyword, options.analysisTimeoutSec);
    } catch (error) {
        analysis = stageFail(
            {
                keyword: options.keyword,
            },
            error instanceof Error ? error.message : "Unknown analysis stage error."
        );
    }

    const finishedAt = new Date().toISOString();
    return buildVerificationReport({
        mode: options.mode,
        keyword: options.keyword,
        location: options.location,
        convexUrl,
        startedAt,
        finishedAt,
        stages: {
            collection,
            search,
            analysis,
        },
    });
}

function printHumanSummary(report: VerificationReport): void {
    const lines = [
        `Mode: ${report.mode}`,
        `Keyword: ${report.keyword}`,
        `Location: ${report.location}`,
        `Convex URL: ${report.convexUrl}`,
        `Collection: ${report.stages.collection.status}`,
        `Search: ${report.stages.search.status}`,
        `Analysis: ${report.stages.analysis.status}`,
        `Overall: ${report.overallStatus}`,
    ];

    for (const line of lines) {
        console.log(line);
    }

    console.log("");
    console.log("Evidence:");
    console.log(JSON.stringify(report.stages, null, 2));
}

async function main(): Promise<void> {
    const options = parseCliArgs(process.argv.slice(2));
    const logger = createLogger(options.json);
    const projectRoot = resolveProjectRoot();
    const convexUrl = resolveConvexUrl(projectRoot);
    const client = new ConvexHttpClient(convexUrl);

    logger.info(`Running critical-path verification in ${options.mode} mode.`);
    logger.info(`Using Convex URL ${convexUrl}`);

    const report = await runVerification(client, options, projectRoot, convexUrl, logger);
    process.exitCode = statusToExitCode(report.overallStatus);

    if (options.json) {
        console.log(toJsonOutput(report));
        return;
    }

    printHumanSummary(report);
}

const isMainModule = process.argv[1]
    ? path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
    : false;

if (isMainModule) {
    main().catch((error) => {
        console.error("verify-critical-path failed:");
        console.error(error);
        process.exit(1);
    });
}
