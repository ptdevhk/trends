import { parseKeywordQuery } from "@trends/shared";

export interface ParsedQuery {
  keywords: string[];
  mode: "AND" | "OR";
}

export function parseSearchQuery(raw: string): ParsedQuery {
  const parsed = parseKeywordQuery(raw);
  return {
    keywords: parsed.keywords.map((keyword) => keyword.toLowerCase()),
    mode: parsed.mode,
  };
}
