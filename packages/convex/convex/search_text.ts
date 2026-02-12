const PRIORITY_KEYS = [
    "name",
    "jobIntention",
    "desiredPosition",
    "selfIntro",
    "experience",
    "education",
    "location",
    "expectedSalary",
    "skills",
    "workHistory",
    "companies",
    "summary",
];

const PRIORITY_KEY_SET = new Set(PRIORITY_KEYS);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null;
}

function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

const CJK_RANGE = "\\u4e00-\\u9fff\\u3400-\\u4dbf";
const CJK_CHAR = `[${CJK_RANGE}]`;
const ASCII_WORD = "[a-zA-Z0-9]";

function addScriptBoundarySpaces(text: string): string {
    return text
        .replace(new RegExp(`(${CJK_CHAR})(${ASCII_WORD})`, "g"), "$1 $2")
        .replace(new RegExp(`(${ASCII_WORD})(${CJK_CHAR})`, "g"), "$1 $2");
}

function toTextFragments(value: unknown): string[] {
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

function collectPriorityFragments(content: UnknownRecord): string[] {
    const parts: string[] = [];
    for (const key of PRIORITY_KEYS) {
        parts.push(...toTextFragments(content[key]));
    }
    return parts;
}

function collectNonPriorityFragments(content: UnknownRecord): string[] {
    const remainder: UnknownRecord = {};
    for (const [key, value] of Object.entries(content)) {
        if (!PRIORITY_KEY_SET.has(key)) {
            remainder[key] = value;
        }
    }
    return toTextFragments(remainder);
}

export function buildSearchText(content: unknown): string {
    if (!isRecord(content)) {
        return normalizeWhitespace(toTextFragments(content).join(" ")).toLowerCase();
    }

    const merged = [
        ...collectPriorityFragments(content),
        ...collectNonPriorityFragments(content),
    ].join(" ");

    return normalizeWhitespace(addScriptBoundarySpaces(merged)).toLowerCase();
}
