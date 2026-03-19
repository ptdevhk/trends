export type KeywordQueryMode = "AND" | "OR";

export type ParsedKeywordQuery = {
  keywords: string[];
  mode: KeywordQueryMode;
};

type KeywordToken = {
  value: string;
  quoted: boolean;
};

function normalizeKeywordWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeKeywordPhrases(keywords: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const keyword of keywords) {
    const trimmed = normalizeKeywordWhitespace(keyword);
    if (!trimmed) {
      continue;
    }

    const fingerprint = trimmed.toLowerCase();
    if (seen.has(fingerprint)) {
      continue;
    }

    seen.add(fingerprint);
    normalized.push(trimmed);
  }

  return normalized;
}

function tokenizeKeywordQuery(raw: string): KeywordToken[] {
  const tokens: KeywordToken[] = [];
  let current = "";
  let inQuotes = false;

  const pushCurrent = (quoted: boolean) => {
    const value = normalizeKeywordWhitespace(current);
    current = "";
    if (!value) {
      return;
    }
    tokens.push({ value, quoted });
  };

  for (const char of raw) {
    if (char === '"') {
      if (inQuotes) {
        pushCurrent(true);
        inQuotes = false;
      } else {
        pushCurrent(false);
        inQuotes = true;
      }
      continue;
    }

    if (!inQuotes && (/\s/.test(char) || /[\n\r,，、]/.test(char))) {
      pushCurrent(false);
      continue;
    }

    current += char;
  }

  pushCurrent(inQuotes);
  return tokens;
}

export function inferKeywordQueryMode(keywords: string[]): KeywordQueryMode {
  const normalized = normalizeKeywordPhrases(keywords);
  if (normalized.length > 1 && normalized.some((keyword) => /\s/.test(keyword))) {
    return "OR";
  }
  return "AND";
}

export function parseKeywordQuery(raw: string): ParsedKeywordQuery {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { keywords: [], mode: "AND" };
  }

  const hasPhraseDelimiter = /[\n\r,，、]/.test(trimmed);
  const hasQuotedPhrase = trimmed.includes('"');
  const hasExplicitOr = /\bOR\b/i.test(trimmed);

  if (!hasQuotedPhrase && !hasExplicitOr && hasPhraseDelimiter) {
    const keywords = normalizeKeywordPhrases(trimmed.split(/[\n\r,，、]+/g));
    return {
      keywords,
      mode: inferKeywordQueryMode(keywords),
    };
  }

  const tokens = tokenizeKeywordQuery(trimmed);
  let mode: KeywordQueryMode = "AND";
  const keywords: string[] = [];

  for (const token of tokens) {
    if (!token.quoted && /^OR$/i.test(token.value)) {
      mode = "OR";
      continue;
    }

    if (!token.quoted && !hasQuotedPhrase) {
      keywords.push(...token.value.split(/\s+/g));
      continue;
    }

    keywords.push(token.value);
  }

  const normalizedKeywords = normalizeKeywordPhrases(keywords);

  return {
    keywords: normalizedKeywords,
    mode: !hasExplicitOr && hasPhraseDelimiter
      ? inferKeywordQueryMode(normalizedKeywords)
      : mode,
  };
}

function quoteKeywordPhrase(keyword: string): string {
  return `"${keyword.replace(/"/g, '\\"')}"`;
}

export function formatKeywordQuery(
  keywords: string[],
  mode: KeywordQueryMode = inferKeywordQueryMode(keywords),
): string {
  const normalized = normalizeKeywordPhrases(keywords);
  if (normalized.length === 0) {
    return "";
  }

  if (mode === "OR") {
    return normalized.map(quoteKeywordPhrase).join(" OR ");
  }

  if (normalized.some((keyword) => /\s/.test(keyword))) {
    return normalized.map(quoteKeywordPhrase).join(" ");
  }

  return normalized.join(" ");
}

export function formatKeywordInput(keywords: string[]): string {
  const normalized = normalizeKeywordPhrases(keywords);
  if (normalized.length === 0) {
    return "";
  }

  if (normalized.length === 1 && /\s/.test(normalized[0] ?? "")) {
    return quoteKeywordPhrase(normalized[0] ?? "");
  }

  return inferKeywordQueryMode(normalized) === "OR"
    ? normalized.join(", ")
    : normalized.join(" ");
}
