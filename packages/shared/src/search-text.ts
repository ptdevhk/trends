// Shared search-text normalization used by both the ingest side (Convex) and
// the query side (Convex search handlers + BFF keyword expansion), so queries
// tokenize the same way the index was built.

const CJK_RANGE = "\\u4e00-\\u9fff\\u3400-\\u4dbf";
const CJK_CHAR = `[${CJK_RANGE}]`;
const ASCII_WORD = "[a-zA-Z0-9]";

export function addScriptBoundarySpaces(text: string): string {
    return text
        .replace(new RegExp(`(${CJK_CHAR})(${ASCII_WORD})`, "g"), "$1 $2")
        .replace(new RegExp(`(${ASCII_WORD})(${CJK_CHAR})`, "g"), "$1 $2");
}

export function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

/**
 * Query-side normalization: trims, boundary-spaces CJK↔ASCII joins and
 * lowercases, so a raw query like "CNC编程" tokenizes as "cnc 编程" —
 * matching how buildSearchText spaced the index tokens.
 */
export function normalizeSearchQuery(query: string): string {
    return normalizeWhitespace(addScriptBoundarySpaces(query)).toLowerCase();
}
