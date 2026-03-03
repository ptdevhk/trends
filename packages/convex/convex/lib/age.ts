function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parseAgeFromString(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const withSuffix = trimmed.match(/(\d+)\s*岁/u);
    if (withSuffix && withSuffix[1]) {
        return Number(withSuffix[1]);
    }

    const plainNumber = trimmed.match(/^(\d{1,3})$/u);
    if (plainNumber && plainNumber[1]) {
        return Number(plainNumber[1]);
    }

    return null;
}

export function parseAgeNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return Math.trunc(value);
    }

    if (typeof value !== "string") {
        return null;
    }

    const parsed = parseAgeFromString(value);
    if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }

    return Math.trunc(parsed);
}

export function parseAgeFromContent(content: unknown): number | null {
    if (!isRecord(content)) {
        return null;
    }

    if (Array.isArray(content.data) && content.data.length > 0) {
        const first = content.data[0];
        if (isRecord(first)) {
            const nestedParsed = parseAgeNumber(first.age);
            if (nestedParsed !== null) {
                return nestedParsed;
            }
        }
    }

    const candidates = [
        content.age,
        content.ageNumber,
    ];

    for (const candidate of candidates) {
        const parsed = parseAgeNumber(candidate);
        if (parsed !== null) {
            return parsed;
        }
    }

    return null;
}
