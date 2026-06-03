import {
    buildLatestWorkHistoryEvidence,
    formatLocationHierarchySearchText,
    getDisallowedResumeFieldKeys,
    isRecord,
    type LocationHierarchy,
} from "@trends/shared";

type UnknownRecord = Record<string, unknown>;

const PRIORITY_KEYS = [
    "name",
    "desiredPosition",
    "education",
    "expectedSalary",
    "skills",
    "workHistory",
    "companies",
    "summary",
    "locationHierarchy",
];

const PRIORITY_KEY_SET = new Set(PRIORITY_KEYS);
const EXCLUDED_KEYS = new Set([
    "location",
    "experience",
    ...getDisallowedResumeFieldKeys("analysis"),
]);



export function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

const CJK_RANGE = "\\u4e00-\\u9fff\\u3400-\\u4dbf";
const CJK_CHAR = `[${CJK_RANGE}]`;
const ASCII_WORD = "[a-zA-Z0-9]";

export function addScriptBoundarySpaces(text: string): string {
    return text
        .replace(new RegExp(`(${CJK_CHAR})(${ASCII_WORD})`, "g"), "$1 $2")
        .replace(new RegExp(`(${ASCII_WORD})(${CJK_CHAR})`, "g"), "$1 $2");
}

const CJK_SEGMENTER = new (Intl as unknown as { Segmenter: new (locale: string, options?: { granularity?: string }) => { segment: (text: string) => Iterable<{ segment: string; isWordLike: boolean }> } }).Segmenter(
    "zh-CN",
    { granularity: "word" },
);

export function segmentChineseRuns(text: string): string {
    return text.replace(
        /[\u4e00-\u9fff\u3400-\u4dbf]{3,}/g,
        (run) => {
            const words: string[] = [run];
            for (const { segment, isWordLike } of CJK_SEGMENTER.segment(run)) {
                if (isWordLike && segment.trim()) {
                    words.push(segment);
                }
            }
            return [...new Set(words)].join(" ");
        }
    );
}

export function toNormalizedSearchTokens(values: readonly string[] | undefined): string[] {
    if (!Array.isArray(values) || values.length === 0) {
        return [];
    }

    return Array.from(
        new Set(
            values
                .map((value) => normalizeWhitespace(value).toLowerCase())
                .filter((value) => value.length >= 2)
        )
    );
}

export function appendMissingSearchTokens(existingSearchText: string, tokens: readonly string[]): string {
    const normalizedTokens = toNormalizedSearchTokens(tokens);
    if (normalizedTokens.length === 0) {
        return existingSearchText;
    }

    const normalizedExisting = existingSearchText.toLowerCase();
    const missingTokens = normalizedTokens.filter((token) => !normalizedExisting.includes(token));
    if (missingTokens.length === 0) {
        return existingSearchText;
    }

    return existingSearchText
        ? `${existingSearchText} ${missingTokens.join(" ")}`
        : missingTokens.join(" ");
}

type IngestSearchTextOptions = {
    industryTags?: readonly string[];
    synonymHits?: readonly string[];
    brandHits?: readonly { brand: string }[];
    companyHits?: readonly string[];
    companyPatternAliasTokens?: string;
};

export function buildIngestSearchTokens(options: IngestSearchTextOptions): string[] {
    const aliasTokens = typeof options.companyPatternAliasTokens === "string"
        ? options.companyPatternAliasTokens.split(/\s+/)
        : [];
    const brandTokens = Array.isArray(options.brandHits)
        ? options.brandHits.map((hit) => hit.brand)
        : [];

    return Array.from(
        new Set([
            ...toNormalizedSearchTokens(options.industryTags),
            ...toNormalizedSearchTokens(options.synonymHits),
            ...toNormalizedSearchTokens(brandTokens),
            ...toNormalizedSearchTokens(options.companyHits),
            ...toNormalizedSearchTokens(aliasTokens),
        ])
    );
}

export function mergeSearchTextWithIngestData(
    existingSearchText: string,
    options: IngestSearchTextOptions
): string {
    return appendMissingSearchTokens(existingSearchText, buildIngestSearchTokens(options));
}

export function toTextFragments(value: unknown): string[] {
    if (value === null || value === undefined) {
        return [];
    }

    if (typeof value === "string") {
        const normalized = normalizeWhitespace(value);
        return normalized ? [normalized] : [];
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return [String(value)];
    }

    if (typeof value === "boolean") {
        return [value ? "true" : "false"];
    }

    if (Array.isArray(value)) {
        const parts: string[] = [];
        for (const item of value) {
            parts.push(...toTextFragments(item));
        }
        return parts;
    }

    if (isRecord(value)) {
        const parts: string[] = [];
        for (const key of Object.keys(value).sort()) {
            parts.push(...toTextFragments(value[key]));
        }
        return parts;
    }

    return [];
}

// Field boost weights: higher values = more repetitions in searchText = higher BM25 weight
const FIELD_BOOST: Record<string, number> = {
    skills: 2,
    desiredPosition: 2,
    name: 1,
    education: 1,
    workHistory: 1,
    companies: 1,
    summary: 1,
    expectedSalary: 1,
    locationHierarchy: 1,
};

function collectPriorityFragments(content: UnknownRecord): string[] {
    const parts: string[] = [];
    for (const key of PRIORITY_KEYS) {
        let fragments: string[] = [];
        if (key === "locationHierarchy") {
            const locationHierarchy = formatLocationHierarchySearchText(content[key] as LocationHierarchy | null | undefined);
            if (locationHierarchy) {
                fragments = [locationHierarchy];
            }
        } else if (key === "workHistory") {
            fragments = buildLatestWorkHistoryEvidence(content[key]).lines;
        } else {
            fragments = toTextFragments(content[key]);
        }
        // Repeat fragments based on field boost weight for BM25 weighting
        const boost = FIELD_BOOST[key] ?? 1;
        for (let i = 0; i < boost; i++) {
            parts.push(...fragments);
        }
    }
    return parts;
}

function collectNonPriorityFragments(content: UnknownRecord): string[] {
    const remainder: UnknownRecord = {};
    for (const [key, value] of Object.entries(content)) {
        if (!PRIORITY_KEY_SET.has(key) && !EXCLUDED_KEYS.has(key)) {
            remainder[key] = value;
        }
    }
    return toTextFragments(remainder);
}

const DOMAIN_SEARCH_ALIASES: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
    [/\bcnc\b/i, ["数控"]],
    [/数控/, ["cnc"]],
    [/机床/, ["machine tool", "machine tools"]],
    [/销售/, ["sales"]],
];

function buildDomainAliasTokens(text: string): string[] {
    const tokens: string[] = [];
    for (const [pattern, aliases] of DOMAIN_SEARCH_ALIASES) {
        if (pattern.test(text)) {
            tokens.push(...aliases);
        }
    }
    return toNormalizedSearchTokens(tokens);
}

export function buildSearchText(content: unknown): string {
    if (!isRecord(content)) {
        return normalizeWhitespace(toTextFragments(content).join(" ")).toLowerCase();
    }

    const merged = [
        ...collectPriorityFragments(content),
        ...collectNonPriorityFragments(content),
    ].join(" ");

    const segmented = normalizeWhitespace(segmentChineseRuns(addScriptBoundarySpaces(merged))).toLowerCase();
    return appendMissingSearchTokens(segmented, buildDomainAliasTokens(segmented));
}
