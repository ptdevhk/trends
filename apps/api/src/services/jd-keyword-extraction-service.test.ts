import { describe, expect, it } from "vitest";

import {
  normalizeExtractedKeywords,
  parseKeywordExtractionResponse,
} from "./jd-keyword-extraction-service.js";

describe("jdKeywordExtractionService helpers", () => {
  it("parses fenced JSON keyword output and deduplicates values", () => {
    const keywords = parseKeywordExtractionResponse(`\`\`\`json
{"keywords":["Machine Tools","Business Development","machine tools","Team Player"]}
\`\`\``);

    expect(keywords).toEqual([
      "Machine Tools",
      "Business Development",
    ]);
  });

  it("normalizes plain-text keyword lists", () => {
    const keywords = normalizeExtractedKeywords([
      "keywords: CNC",
      " machine tools ",
      "Business Development",
      "business development",
      "communication skills",
      "N/A",
    ]);

    expect(keywords).toEqual([
      "CNC",
      "machine tools",
      "Business Development",
    ]);
  });
});
