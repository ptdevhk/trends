/**
 * Soft-match for quoted Latin multi-word AND keyword groups.
 *
 * Problem: `"CNC" "Service Engineer"` keeps "service engineer" as one phrase
 * token. MY Seek titles often have the words split ("Service" / "Engineer" /
 * "Services Engineer") with no contiguous "service engineer" substring, so
 * AND collapses to zero while CNC alone still hits.
 *
 * Rule: a Latin multi-word group hits if any variant is a substring, OR if
 * every whitespace token of the phrase appears in searchText (order-free).
 * CJK / single-token groups are unchanged.
 */

const LATIN_MULTI_WORD_RE =
  /^[A-Za-z][A-Za-z0-9+./-]*(?:\s+[A-Za-z][A-Za-z0-9+./-]*)+$/;

export type SoftMatchKeywordGroup = {
  original: string;
  variants: string[];
};

export function isLatinMultiWordPhrase(value: string): boolean {
  return LATIN_MULTI_WORD_RE.test(value.trim());
}

export function latinPhraseTokens(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function matchesLatinPhraseSoft(searchText: string, phrase: string): boolean {
  const text = searchText.toLowerCase();
  const tokens = latinPhraseTokens(phrase);
  if (tokens.length < 2) {
    return false;
  }
  return tokens.every((token) => text.includes(token));
}

export function matchesKeywordGroupSoft(
  searchText: string,
  group: SoftMatchKeywordGroup,
): boolean {
  const text = searchText.toLowerCase();

  for (const variant of group.variants) {
    const normalized = variant.trim().toLowerCase();
    if (normalized.length >= 2 && text.includes(normalized)) {
      return true;
    }
  }

  const original = group.original.trim();
  if (isLatinMultiWordPhrase(original) && matchesLatinPhraseSoft(text, original)) {
    return true;
  }

  for (const variant of group.variants) {
    if (isLatinMultiWordPhrase(variant) && matchesLatinPhraseSoft(text, variant)) {
      return true;
    }
  }

  return false;
}

/**
 * Expand Latin multi-word terms into index tokens so Convex FTS / digest
 * AND intersection can discover candidates that soft-match will accept.
 */
export function expandLatinPhraseIndexTerms(terms: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    const normalized = term.trim().toLowerCase();
    if (normalized.length < 2 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);

    if (!isLatinMultiWordPhrase(normalized)) {
      continue;
    }
    for (const token of latinPhraseTokens(normalized)) {
      if (seen.has(token)) {
        continue;
      }
      seen.add(token);
      out.push(token);
    }
  }

  return out;
}
