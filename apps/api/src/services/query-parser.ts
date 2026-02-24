export interface ParsedQuery {
  keywords: string[];
  mode: "AND" | "OR";
}

export function parseSearchQuery(raw: string): ParsedQuery {
  const tokens = raw
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  let mode: ParsedQuery["mode"] = "AND";
  const dedupe = new Set<string>();

  for (const token of tokens) {
    if (token === "or" || token === "OR") {
      mode = "OR";
      continue;
    }

    const normalized = token.toLowerCase();
    if (normalized.length === 0) {
      continue;
    }

    dedupe.add(normalized);
  }

  return {
    keywords: Array.from(dedupe),
    mode,
  };
}
