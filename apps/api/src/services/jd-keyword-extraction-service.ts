import { callChatCompletion } from "./ai-chat-client.js";
import { loadAIConfig } from "./ai-config.js";

const DEFAULT_JD_KEYWORD_EXTRACTION_MODEL = process.env.JD_KEYWORD_EXTRACTION_MODEL
  || process.env.AI_SUMMARY_MODEL
  || "anthropic/claude-3-haiku-20240307";

const GENERIC_FILLER_KEYWORDS = new Set([
  "communication",
  "communication skills",
  "detail oriented",
  "hard working",
  "responsible",
  "self motivated",
  "team player",
]);

type ExtractKeywordsRequest = {
  text: string;
};

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.includes("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```[a-zA-Z0-9_-]*\s*/, "")
    .replace(/```$/m, "")
    .trim();
}

function cleanKeyword(value: string): string {
  return value
    .trim()
    .replace(/^[-*•\d.)\s]+/, "")
    .replace(/^keywords?\s*:\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeExtractedKeywords(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  values.forEach((value) => {
    const cleaned = cleanKeyword(value);
    const key = cleaned.toLowerCase();
    if (
      cleaned.length < 2
      || cleaned.length > 80
      || seen.has(key)
      || GENERIC_FILLER_KEYWORDS.has(key)
      || /^n\/a$/i.test(cleaned)
      || /^none$/i.test(cleaned)
    ) {
      return;
    }

    seen.add(key);
    normalized.push(cleaned);
  });

  return normalized.slice(0, 12);
}

export function parseKeywordExtractionResponse(content: string): string[] {
  const normalizedContent = stripCodeFence(content);

  try {
    const parsed = JSON.parse(normalizedContent) as unknown;
    if (Array.isArray(parsed)) {
      return normalizeExtractedKeywords(parsed.filter((item): item is string => typeof item === "string"));
    }

    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { keywords?: unknown }).keywords)) {
      return normalizeExtractedKeywords(
        (parsed as { keywords: unknown[] }).keywords.filter((item): item is string => typeof item === "string"),
      );
    }
  } catch {
    // Fall through to the plain-text parser.
  }

  return normalizeExtractedKeywords(
    normalizedContent
      .split(/[\n,;|，、；]+/g)
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
}

function heuristicExtractKeywords(text: string): string[] {
  return normalizeExtractedKeywords(
    text
      .split(/[\n,;|，、；]+/g)
      .map((item) => compactWhitespace(
        item
          .replace(/^[A-Za-z][A-Za-z\s/()-]{0,30}:\s*/, "")
          .replace(/\b(requirements?|responsibilities|job description|about the role)\b/gi, ""),
      ))
      .filter((item) => item.length > 1),
  );
}

export class JdKeywordExtractionService {
  async extractKeywords(request: ExtractKeywordsRequest): Promise<{ keywords: string[]; model: string }> {
    const text = compactWhitespace(request.text);
    if (!text) {
      throw new Error("Job description text is required");
    }

    if (process.env.AI_MOCK_ENABLED === "true") {
      return {
        model: DEFAULT_JD_KEYWORD_EXTRACTION_MODEL,
        keywords: heuristicExtractKeywords(text),
      };
    }

    const config = loadAIConfig();
    if (!config.apiKey) {
      throw new Error("Missing AI_API_KEY environment variable");
    }

    const content = await callChatCompletion({
      config,
      model: DEFAULT_JD_KEYWORD_EXTRACTION_MODEL,
      messages: [
        {
          role: "system",
          content: "You extract concise recruiter search keywords from job descriptions. Return JSON only in the shape {\"keywords\":[\"...\"]}. Prefer 5 to 10 high-signal keywords or short phrases. Do not include explanations.",
        },
        {
          role: "user",
          content: [
            "Extract the most useful resume-search keywords from this job description.",
            "Rules:",
            "- Keep keywords short and practical for recruiter search.",
            "- Include role titles, product or domain terms, core skills, and market terms when they are explicit.",
            "- Preserve meaningful multi-word phrases like machine tools or business development.",
            "- Exclude generic filler such as communication, team player, or responsible.",
            "- Return valid JSON only.",
            "",
            `Job description: ${text.slice(0, 8000)}`,
          ].join("\n"),
        },
      ],
      temperature: 0,
      maxTokens: 400,
    });

    const keywords = parseKeywordExtractionResponse(content);
    if (keywords.length === 0) {
      throw new Error("No keywords could be extracted from the job description");
    }

    return {
      keywords,
      model: DEFAULT_JD_KEYWORD_EXTRACTION_MODEL,
    };
  }
}

export const jdKeywordExtractionService = new JdKeywordExtractionService();
