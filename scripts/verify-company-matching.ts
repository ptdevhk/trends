import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ConvexHttpClient } from "convex/browser";

import { IndustryDataService } from "../apps/api/src/services/industry-data-service.js";
import { api } from "../packages/convex/convex/_generated/api.js";
import type { Doc } from "../packages/convex/convex/_generated/dataModel.js";

const DEFAULT_QUERY = "CNC";
const DEFAULT_LIMIT = 300;
const DEFAULT_MIN_AGE = 25;
const DEFAULT_MAX_AGE = 40;
const DEFAULT_NEAR_MISS_LIMIT = 5;
const COMPANY_PATTERN = /([\u4e00-\u9fa5A-Za-z0-9()（）·.&\-]{2,40}(?:公司|集团|科技|机械|设备|自动化|股份|有限|厂|行))/;
const COMPANY_SUFFIX_RE = /(股份有限公司|有限责任公司|有限公司|股份公司|集团股份公司|集团有限公司|集团|公司|科技|机械|设备|自动化|股份|有限|厂|行)$/u;
const GENERIC_CORES = new Set([
    "中国",
    "广东",
    "深圳",
    "东莞",
    "广州",
    "惠州",
    "中山",
    "科技",
    "机械",
    "设备",
    "自动化",
    "精密",
    "数控",
    "智能",
    "技术",
]);

type ResumeDoc = Doc<"resumes">;

type EmployerVerification = {
    employerName: string;
    occurrences: number;
    resumes: string[];
    verification: ReturnType<IndustryDataService["verifyCompanyIndustry"]>;
    nearMisses: NearMiss[];
};

type NearMiss = {
    companyName: string;
    category: string;
    overlapRatio: number;
    reason: string;
};

type ScriptOptions = {
    query: string;
    limit: number;
    minAge: number;
    maxAge: number;
};

function resolveProjectRoot(): string {
    const scriptPath = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(scriptPath), "..");
}

function parsePositiveInteger(raw: string, flag: string): number {
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid value for ${flag}: ${raw}`);
    }
    return value;
}

function parseArgs(argv: string[]): ScriptOptions {
    const options: ScriptOptions = {
        query: DEFAULT_QUERY,
        limit: DEFAULT_LIMIT,
        minAge: DEFAULT_MIN_AGE,
        maxAge: DEFAULT_MAX_AGE,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const value = argv[i + 1];

        switch (arg) {
            case "--query":
                if (!value) {
                    throw new Error("Missing value for --query");
                }
                options.query = value;
                i += 1;
                break;
            case "--limit":
                if (!value) {
                    throw new Error("Missing value for --limit");
                }
                options.limit = parsePositiveInteger(value, "--limit");
                i += 1;
                break;
            case "--min-age":
                if (!value) {
                    throw new Error("Missing value for --min-age");
                }
                options.minAge = parsePositiveInteger(value, "--min-age");
                i += 1;
                break;
            case "--max-age":
                if (!value) {
                    throw new Error("Missing value for --max-age");
                }
                options.maxAge = parsePositiveInteger(value, "--max-age");
                i += 1;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (options.minAge > options.maxAge) {
        throw new Error(`Invalid age range: ${options.minAge}-${options.maxAge}`);
    }

    return options;
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
        if (
            (value.startsWith("\"") && value.endsWith("\"")) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
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
        const convexUrl = readEnvVarFromFile(filePath, "CONVEX_URL");
        if (convexUrl) {
            return convexUrl;
        }

        const viteConvexUrl = readEnvVarFromFile(filePath, "VITE_CONVEX_URL");
        if (viteConvexUrl) {
            return viteConvexUrl;
        }
    }

    return "http://127.0.0.1:3210";
}

function parseAgeNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return Math.trunc(value);
    }
    if (typeof value !== "string") {
        return null;
    }

    const withSuffix = value.match(/(\d+)\s*岁/u);
    if (withSuffix && withSuffix[1]) {
        return Number(withSuffix[1]);
    }

    const plain = value.match(/^(\d{1,3})$/u);
    if (plain && plain[1]) {
        return Number(plain[1]);
    }

    return null;
}

function getResumeAge(resume: ResumeDoc): number | null {
    if (typeof resume.age === "number" && Number.isFinite(resume.age) && resume.age > 0) {
        return Math.trunc(resume.age);
    }

    const content = resume.content;
    if (typeof content === "object" && content !== null && "age" in content) {
        return parseAgeNumber((content as Record<string, unknown>).age);
    }

    return null;
}

function normalizeCompanyName(raw: string): string {
    return raw
        .replace(/^[\d\-~至今年月日()（）.\s]+/u, "")
        .replace(/[\s,，。;；]+/gu, " ")
        .trim();
}

function extractCompanyFromEntry(raw: string): string {
    const cleaned = normalizeCompanyName(raw);
    if (!cleaned) {
        return "";
    }

    const companyMatch = cleaned.match(COMPANY_PATTERN);
    if (companyMatch) {
        return companyMatch[1];
    }

    const firstToken = cleaned.split(/\s+/u).find((token) => token.length >= 2);
    return firstToken || "";
}

function normalizeForComparison(value: string): string {
    return value
        .toLowerCase()
        .replace(/[()（）·.&\-\s]/gu, "")
        .trim();
}

function stripCompanySuffix(value: string): string {
    let current = normalizeForComparison(value);
    let previous = "";

    while (current && current !== previous) {
        previous = current;
        current = current.replace(COMPANY_SUFFIX_RE, "").trim();
    }

    return current || normalizeForComparison(value);
}

function getComparisonLength(value: string): number {
    return Array.from(value).length;
}

function longestCommonSubstringLength(left: string, right: string): number {
    if (!left || !right) {
        return 0;
    }

    const rows = left.length + 1;
    const cols = right.length + 1;
    const table = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    let max = 0;

    for (let i = 1; i < rows; i += 1) {
        for (let j = 1; j < cols; j += 1) {
            if (left[i - 1] !== right[j - 1]) {
                continue;
            }

            const value = table[i - 1][j - 1] + 1;
            table[i][j] = value;
            if (value > max) {
                max = value;
            }
        }
    }

    return max;
}

function buildNearMisses(
    service: IndustryDataService,
    employerName: string,
    limit: number
): NearMiss[] {
    const companies = service.loadCompanies();
    const employerNormalized = normalizeForComparison(employerName);
    const employerCore = stripCompanySuffix(employerName);
    const employerLength = getComparisonLength(employerCore || employerNormalized);

    const candidates = companies
        .map((company) => {
            const candidateName = company.nameCn;
            const candidateNormalized = normalizeForComparison(candidateName);
            const candidateCore = stripCompanySuffix(candidateName);
            const commonLength = longestCommonSubstringLength(employerCore, candidateCore);
            const overlapRatio = commonLength === 0
                ? 0
                : commonLength / Math.max(employerLength, getComparisonLength(candidateCore || candidateNormalized));

            let reason = "";
            if (candidateCore && employerCore && candidateCore === employerCore) {
                reason = "same_core_name";
            } else if (candidateCore && employerCore && (candidateCore.includes(employerCore) || employerCore.includes(candidateCore))) {
                reason = "core_contains";
            } else if (candidateNormalized.includes(employerNormalized) || employerNormalized.includes(candidateNormalized)) {
                reason = "normalized_contains";
            } else if (commonLength >= 2) {
                reason = `common_substring:${commonLength}`;
            }

            return {
                companyName: candidateName,
                category: company.category,
                overlapRatio,
                reason,
            };
        })
        .filter((candidate) => candidate.reason.length > 0)
        .sort((left, right) => {
            if (right.overlapRatio !== left.overlapRatio) {
                return right.overlapRatio - left.overlapRatio;
            }
            return left.companyName.localeCompare(right.companyName, "zh-Hans-CN");
        });

    return candidates.slice(0, limit);
}

function isStrongNearMiss(item: EmployerVerification): boolean {
    return item.nearMisses.some((candidate) => {
        const employerCore = stripCompanySuffix(item.employerName);
        const candidateCore = stripCompanySuffix(candidate.companyName);
        const shorterCoreLength = Math.min(
            getComparisonLength(employerCore),
            getComparisonLength(candidateCore)
        );

        if (shorterCoreLength < 4) {
            return false;
        }
        if (GENERIC_CORES.has(employerCore) || GENERIC_CORES.has(candidateCore)) {
            return false;
        }

        if (candidate.reason === "same_core_name") {
            return true;
        }

        if (candidate.reason === "core_contains" || candidate.reason === "normalized_contains") {
            return candidate.overlapRatio >= 0.6;
        }

        return false;
    });
}

function readResumeWorkHistory(resume: ResumeDoc): string[] {
    if (typeof resume.content !== "object" || resume.content === null) {
        return [];
    }

    const workHistory = (resume.content as Record<string, unknown>).workHistory;
    if (!Array.isArray(workHistory)) {
        return [];
    }

    return workHistory
        .map((entry) => {
            if (typeof entry === "string") {
                return entry;
            }
            if (typeof entry === "object" && entry !== null && typeof (entry as Record<string, unknown>).raw === "string") {
                return (entry as Record<string, unknown>).raw as string;
            }
            return "";
        })
        .filter((entry) => entry.trim().length > 0);
}

function collectEmployers(resumes: ResumeDoc[]): EmployerVerification[] {
    const projectRoot = resolveProjectRoot();
    const service = new IndustryDataService(projectRoot);
    const employerMap = new Map<string, { resumes: Set<string>; occurrences: number }>();

    for (const resume of resumes) {
        const resumeLabel = `${resume.externalId}:${String(resume._id)}`;
        for (const rawEntry of readResumeWorkHistory(resume)) {
            const employer = extractCompanyFromEntry(rawEntry);
            if (!employer) {
                continue;
            }

            const existing = employerMap.get(employer) ?? {
                resumes: new Set<string>(),
                occurrences: 0,
            };
            existing.occurrences += 1;
            existing.resumes.add(resumeLabel);
            employerMap.set(employer, existing);
        }
    }

    return Array.from(employerMap.entries())
        .map(([employerName, value]) => ({
            employerName,
            occurrences: value.occurrences,
            resumes: Array.from(value.resumes).sort(),
            verification: service.verifyCompanyIndustry(employerName),
            nearMisses: buildNearMisses(service, employerName, DEFAULT_NEAR_MISS_LIMIT),
        }))
        .sort((left, right) => {
            if (right.occurrences !== left.occurrences) {
                return right.occurrences - left.occurrences;
            }
            return left.employerName.localeCompare(right.employerName, "zh-Hans-CN");
        });
}

function formatMatchSummary(item: EmployerVerification): string {
    const verification = item.verification;
    if (verification.matchType === "known_company" && verification.company) {
        return `${verification.matchType} conf=${verification.confidence.toFixed(2)} -> ${verification.company.nameCn}`;
    }
    if (verification.matchType === "keyword_match") {
        const keywords = verification.matchedKeywords.join(", ") || "none";
        return `${verification.matchType} conf=${verification.confidence.toFixed(2)} -> [${keywords}]`;
    }
    return `${verification.matchType} conf=${verification.confidence.toFixed(2)}`;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const projectRoot = resolveProjectRoot();
    const convexUrl = resolveConvexUrl(projectRoot);
    const client = new ConvexHttpClient(convexUrl);
    const service = new IndustryDataService(projectRoot);
    const dbCompanies = service.loadCompanies();

    const searched = await client.query(api.resumes.search, {
        query: options.query,
        limit: options.limit,
    });

    const cncResumes = searched.filter((resume) => {
        const age = getResumeAge(resume);
        return age !== null && age >= options.minAge && age <= options.maxAge;
    });
    const resumesWithStoredCompanyHits = cncResumes.filter((resume) =>
        Array.isArray(resume.ingestData?.companyHits) && resume.ingestData.companyHits.length > 0
    ).length;

    const employers = collectEmployers(cncResumes);

    const byTier = {
        known_company: employers.filter((item) => item.verification.matchType === "known_company"),
        keyword_match: employers.filter((item) => item.verification.matchType === "keyword_match"),
        none: employers.filter((item) => item.verification.matchType === "none"),
    };

    const noMatchWithNearMisses = byTier.none.filter((item) => item.nearMisses.length > 0);
    const strongNearMisses = noMatchWithNearMisses.filter((item) => isStrongNearMiss(item));

    console.log("=== Verify Company Matching Report ===");
    console.log(`Convex URL: ${convexUrl}`);
    console.log(`Search query: ${options.query}`);
    console.log(`Search result count before age filter: ${searched.length}`);
    console.log(`UI-equivalent age filter: ${options.minAge}-${options.maxAge}`);
    console.log(`Resume count after age filter: ${cncResumes.length}`);
    console.log(`Resumes with stored companyHits in this slice: ${resumesWithStoredCompanyHits}`);
    console.log(`Industry DB companies loaded: ${dbCompanies.length}`);
    console.log(`Unique employers extracted: ${employers.length}`);
    console.log("");

    console.log("=== Tier Counts ===");
    console.log(`Tier 1 known_company: ${byTier.known_company.length}`);
    console.log(`Tier 2-4 keyword_match: ${byTier.keyword_match.length}`);
    console.log(`No match: ${byTier.none.length}`);
    console.log(`No-match employers with near-miss candidates: ${noMatchWithNearMisses.length}`);
    console.log(`Potential false-negative near-misses (same_core/core_contains/overlap>=0.6): ${strongNearMisses.length}`);
    console.log("");

    if (byTier.known_company.length > 0) {
        console.log("=== Tier 1 Matches ===");
        for (const item of byTier.known_company) {
            console.log(`- ${item.employerName} | ${formatMatchSummary(item)} | resumes=${item.resumes.length}`);
        }
        console.log("");
    }

    if (byTier.keyword_match.length > 0) {
        console.log("=== Tier 2-4 Matches ===");
        for (const item of byTier.keyword_match) {
            console.log(`- ${item.employerName} | ${formatMatchSummary(item)} | resumes=${item.resumes.length}`);
        }
        console.log("");
    }

    console.log("=== No-Match Employers ===");
    for (const item of byTier.none) {
        const nearMissText = item.nearMisses.length > 0
            ? item.nearMisses
                .map((candidate) => `${candidate.companyName} (${candidate.reason}, overlap=${candidate.overlapRatio.toFixed(2)})`)
                .join("; ")
            : "none";
        console.log(`- ${item.employerName} | ${formatMatchSummary(item)} | resumes=${item.resumes.length} | nearMisses=${nearMissText}`);
    }
    console.log("");

    if (strongNearMisses.length > 0) {
        console.log("=== Potential False-Negative Near-Misses ===");
        for (const item of strongNearMisses) {
            const flagged = item.nearMisses.filter((candidate) => {
                const employerCore = stripCompanySuffix(item.employerName);
                const candidateCore = stripCompanySuffix(candidate.companyName);
                const shorterCoreLength = Math.min(
                    getComparisonLength(employerCore),
                    getComparisonLength(candidateCore)
                );

                if (shorterCoreLength < 4) {
                    return false;
                }
                if (GENERIC_CORES.has(employerCore) || GENERIC_CORES.has(candidateCore)) {
                    return false;
                }

                if (candidate.reason === "same_core_name") {
                    return true;
                }
                if (candidate.reason === "core_contains" || candidate.reason === "normalized_contains") {
                    return candidate.overlapRatio >= 0.6;
                }
                return false;
            });

            console.log(
                `- ${item.employerName} | ${flagged
                    .map((candidate) => `${candidate.companyName} (${candidate.reason}, overlap=${candidate.overlapRatio.toFixed(2)})`)
                    .join("; ")}`
            );
        }
        console.log("");
    }

    console.log("=== Assessment ===");
    if (byTier.known_company.length === 0 && strongNearMisses.length === 0) {
        console.log("No evidence of Tier 1 false negatives in the filtered cohort.");
        console.log("The observed companyHits result is consistent with the current Industry DB contents for this query slice.");
    } else if (strongNearMisses.length > 0) {
        console.log("Potential false negatives found. Review the no-match employers listed above with strong near-miss candidates.");
    } else {
        console.log("Tier 1 matches exist in the cohort. Re-check why the UI is showing 0 companyHits for those records.");
    }
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});
