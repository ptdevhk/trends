export type KeywordQueryMode = "AND" | "OR";

export type ParsedKeywordQuery = {
  keywords: string[];
  mode: KeywordQueryMode;
  salesDuty?: boolean;
};

export const DEFAULT_SALES_DUTY_MIN_ROLE_YEARS = 1;
export const SALES_DUTY_KEYWORD = "销售";

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

export function isBareSalesDutyKeyword(value: string | undefined): boolean {
  const normalized = normalizeKeywordWhitespace(value ?? "").toLowerCase();
  return normalized === "销售" || normalized === "销售员" || normalized === "sales";
}

function isOrOperatorToken(token: KeywordToken): boolean {
  if (token.quoted) {
    return false;
  }
  const value = token.value.trim();
  return /^OR$/i.test(value) || value === "或";
}

function hasExplicitOrOperator(raw: string): boolean {
  return /\bOR\b/i.test(raw) || /(?:^|[\s,，、])或(?:$|[\s,，、])/.test(raw);
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

function peelTrailingSalesDuty(
  keywords: string[],
  mode: KeywordQueryMode,
  afterOrFlags: boolean[],
): { keywords: string[]; salesDuty?: boolean } {
  if (mode !== "OR" || keywords.length < 2) {
    return { keywords };
  }

  const kept: string[] = [];
  let salesDuty = false;

  keywords.forEach((keyword, index) => {
    const afterOr = afterOrFlags[index] === true;
    if (!afterOr && isBareSalesDutyKeyword(keyword)) {
      salesDuty = true;
      return;
    }
    kept.push(keyword);
  });

  if (!salesDuty || kept.length === 0) {
    return { keywords };
  }

  return { keywords: kept, salesDuty: true };
}

export function parseKeywordQuery(raw: string): ParsedKeywordQuery {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { keywords: [], mode: "AND" };
  }

  const hasPhraseDelimiter = /[\n\r,，、]/.test(trimmed);
  const hasQuotedPhrase = trimmed.includes('"');
  const hasExplicitOr = hasExplicitOrOperator(trimmed);

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
  const afterOrFlags: boolean[] = [];
  let pendingAfterOr = false;

  for (const token of tokens) {
    if (isOrOperatorToken(token)) {
      mode = "OR";
      pendingAfterOr = true;
      continue;
    }

    const pieces = !token.quoted && !hasQuotedPhrase
      ? token.value.split(/\s+/g)
      : [token.value];

    for (const piece of pieces) {
      const normalizedPiece = normalizeKeywordWhitespace(piece);
      if (!normalizedPiece) {
        continue;
      }
      keywords.push(normalizedPiece);
      afterOrFlags.push(pendingAfterOr);
      pendingAfterOr = false;
    }
  }

  const normalizedKeywords: string[] = [];
  const normalizedAfterOr: boolean[] = [];
  const seen = new Set<string>();
  keywords.forEach((keyword, index) => {
    const fingerprint = keyword.toLowerCase();
    if (seen.has(fingerprint)) {
      return;
    }
    seen.add(fingerprint);
    normalizedKeywords.push(keyword);
    normalizedAfterOr.push(afterOrFlags[index] === true);
  });

  const resolvedMode = !hasExplicitOr && hasPhraseDelimiter
    ? inferKeywordQueryMode(normalizedKeywords)
    : mode;
  const peeled = peelTrailingSalesDuty(normalizedKeywords, resolvedMode, normalizedAfterOr);

  return {
    keywords: peeled.keywords,
    mode: resolvedMode,
    ...(peeled.salesDuty ? { salesDuty: true } : {}),
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

export function formatResumeSearchBoxQuery(options: {
  keywords: string[];
  mode?: KeywordQueryMode;
  salesDuty?: boolean;
}): string {
  const normalized = normalizeKeywordPhrases(options.keywords);
  const mode = options.mode ?? inferKeywordQueryMode(normalized);
  const coreQuery = mode === "OR" && !normalized.some((keyword) => /\s/.test(keyword))
    ? normalized.join(" or ")
    : formatKeywordQuery(normalized, mode);

  if (!options.salesDuty || normalized.some((keyword) => isBareSalesDutyKeyword(keyword))) {
    return coreQuery;
  }

  return coreQuery ? `${coreQuery} ${SALES_DUTY_KEYWORD}` : SALES_DUTY_KEYWORD;
}

export function formatQuickStartSearchQuery(input: {
  keywords: string[];
  roleFilterType?: string;
}): string {
  const normalized = normalizeKeywordPhrases(input.keywords);
  const salesRole = (input.roleFilterType ?? "").trim().toLowerCase() === "sales";
  const core = normalized.filter((keyword) => !isBareSalesDutyKeyword(keyword));

  if (salesRole && core.length >= 2) {
    return formatResumeSearchBoxQuery({ keywords: core, mode: "OR", salesDuty: true });
  }

  return formatKeywordQuery(normalized);
}

export function resolveSalesDutyFilters(
  parsed: ParsedKeywordQuery,
  current: { roleFilterType?: string; minRoleYears?: number } = {},
): { roleFilterType?: string; minRoleYears?: number } {
  const explicitRole = current.roleFilterType?.trim();
  const explicitYears = typeof current.minRoleYears === "number" && current.minRoleYears > 0
    ? current.minRoleYears
    : undefined;

  if (!parsed.salesDuty) {
    return {
      ...(explicitRole ? { roleFilterType: explicitRole } : {}),
      ...(typeof explicitYears === "number" ? { minRoleYears: explicitYears } : {}),
    };
  }

  return {
    roleFilterType: explicitRole || "sales",
    minRoleYears: explicitYears ?? DEFAULT_SALES_DUTY_MIN_ROLE_YEARS,
  };
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
