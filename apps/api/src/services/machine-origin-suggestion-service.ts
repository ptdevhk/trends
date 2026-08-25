/**
 * Machine Origin Suggestion Service
 *
 * AI-powered prefill for suggestedMachineOrigin at proposal creation / research
 * time. The model classifies the company's brand affiliation from evidence
 * source titles, URLs, and excerpts. Human-gated: the suggestion is only
 * committed to verified profiles when a reviewer approves with an explicit
 * machineOrigin.
 *
 * Cost: ~<US$0.0001/call with deepseek-v4-flash (default model); verified via
 * MY-27 live run (2026-08-22): 27 calls, maxTokens=1000, 0 nulls, total
 * ~$0.0027 at ~$0.0001/1K output tokens — per-call cost stays under the
 * cap. Model cost structure: <US$0.0001/1K output tokens, negligible input
 * token cost.
 * Safety: AI config off, network error, or parse failure → silent log, no write.
 */

import { callChatCompletion } from "./ai-chat-client.js";
import { loadAIConfig } from "./ai-config.js";
import { getIndustryProposal } from "./company-industry-proposal-service.js";
import { listIndustryEvidenceSources } from "./company-industry-evidence-service.js";
import { callConvexMutation } from "./convex-utils.js";
import { getConvexWriteSecret } from "./config.js";
import { logger } from "./logger.js";
import type { IndustryEvidenceSource } from "./company-industry-contracts.js";

const VALID_ORIGINS = new Set(["international", "domestic", "unknown"]);

export interface MachineOriginSuggestion {
  suggestedMachineOrigin: "international" | "domestic" | "unknown";
  confidence: number;
  evidenceExcerpt?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  model: string;
}

interface AIOutput {
  suggestedMachineOrigin: string;
  confidence: number;
  evidenceExcerpt: string;
  sourceUrl: string;
  sourceTitle: string;
}

/**
 * Call AI to suggest a machine origin for a given company, seeded with
 * existing evidence sources (titles, URLs, excerpts) and the primary
 * industry class.
 *
 * Returns undefined on any failure (AI off, parse error, network error)
 * — non-fatal, caller logs and continues.
 */
export async function suggestMachineOrigin(
  companyName: string,
  industryClass: string,
  sources: Pick<
    IndustryEvidenceSource,
    "title" | "url" | "evidenceExcerpt" | "sourceType" | "trustTier"
  >[],
): Promise<MachineOriginSuggestion | undefined> {
  const config = loadAIConfig();
  if (!config.enabled) {
    return undefined;
  }

  const model = config.model;
  const cappedSources = sources.slice(0, 15);

  const systemPrompt = `You are a machine-tool industry analyst. Classify the brand affiliation of a company based on the provided evidence sources.

Return a JSON object with these fields:
- suggestedMachineOrigin: "international" (foreign / global brand with HQ outside the company's market), "domestic" (local company in the market — e.g. Malaysian precision shop, CNC machine tool distributor, automation integrator, or local manufacturer), or "unknown" (cannot determine)
- confidence: number between 0 and 1 indicating how sure you are
- evidenceExcerpt: a short sentence (≤2 sentences) quoting the most relevant evidence from the sources
- sourceUrl: the URL of the best evidence source
- sourceTitle: the title of the best evidence source

Rules:
- A company is "international" if it is a known global brand, a subsidiary/partner of a foreign brand (e.g. Haas, Seco, NSK, Ichi Seiki, Sika, Luvata), or a global MNC with HQ outside the company's local market. A "Sdn Bhd" or "Pte Ltd" entity that is a subsidiary of a global brand is still international.
- A company is "domestic" if it is a local company in its market — this includes local precision machine shops, CNC machining service providers, machine tool distributors/dealers, automation integrators, and local manufacturers. Evidence of CNC-related activity (sales roles, machining services, precision engineering) supports "domestic". A Malaysian "Sdn Bhd" or Singapore "Pte Ltd" entity that serves the CNC industry is domestic.
- A company is "unknown" ONLY if the sources truly lack any evidence of the company's industry involvement, brand affiliation, or whether it is a local or international entity. Do NOT default to "unknown" — use the available evidence to classify.
- Base your answer ONLY on the evidence sources provided. Do not infer beyond what the sources indicate.
- Use the evidence source titles, URLs, and excerpts to determine the company's brand affiliation. If a source mentions a global brand name (e.g. Haas, NSK, Sika, Seco), the company is likely international. If a source shows local CNC machining services, precision engineering, or sales roles in Malaysia/Singapore, the company is likely domestic.
- Output ONLY valid JSON. Do NOT include markdown fences, code blocks, or any text before or after the JSON object.`;

  // Build a compact evidence summary for the prompt
  const evidenceText = cappedSources
    .map((s, i) => {
      const title = s.title?.trim() ? `Title: ${s.title.trim()}` : "";
      const url = s.url?.trim() ? `URL: ${s.url.trim()}` : "";
      const excerpt = s.evidenceExcerpt?.trim()
        ? `Excerpt: ${s.evidenceExcerpt.trim().slice(0, 300)}`
        : "";
      return `[Source ${i + 1}] ${[title, url, excerpt].filter(Boolean).join(" | ")}`;
    })
    .join("\n");

  const userMessage = `Company: ${companyName}
Industry: ${industryClass}
Evidence sources:
${evidenceText || "No evidence sources available."}

Classify the machine origin of this company.`;

  try {
    const raw = await callChatCompletion({
      config,
      maxTokens: 1000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      model,
      temperature: 0,
    });

    const parsed = parseAIOutput(raw);
    if (!parsed) {
      return undefined;
    }

    return {
      suggestedMachineOrigin: parsed.suggestedMachineOrigin as "international" | "domestic" | "unknown",
      confidence: parsed.confidence,
      evidenceExcerpt: parsed.evidenceExcerpt || undefined,
      sourceUrl: parsed.sourceUrl || undefined,
      sourceTitle: parsed.sourceTitle || undefined,
      model,
    };
  } catch (error) {
    return undefined;
  }
}

function parseAIOutput(raw: string): AIOutput | undefined {
  try {
    // Strip markdown code fences if present
    let json = raw.trim();
    if (json.startsWith("```")) {
      const firstNewline = json.indexOf("\n");
      if (firstNewline !== -1) {
        json = json.slice(firstNewline + 1);
      }
      if (json.endsWith("```")) {
        json = json.slice(0, -3);
      }
      json = json.trim();
    }

    // Try parsing the cleaned string directly
    const parsed = tryParseJson(json);
    if (parsed) {
      return validateAiOutput(parsed);
    }

    // Fallback: extract the first JSON object from the output using regex.
    // This handles cases where the model adds extra text before/after the JSON.
    const jsonMatch = raw.match(/\{[\s\S]*?"suggestedMachineOrigin"[\s\S]*?\}/);
    if (jsonMatch) {
      const fallbackParsed = tryParseJson(jsonMatch[0]);
      if (fallbackParsed) {
        return validateAiOutput(fallbackParsed);
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function tryParseJson(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return parsed;
  } catch {
    return undefined;
  }
}

function validateAiOutput(parsed: Record<string, unknown>): AIOutput | undefined {
  if (
    typeof parsed.suggestedMachineOrigin !== "string" ||
    !VALID_ORIGINS.has(parsed.suggestedMachineOrigin)
  ) {
    return undefined;
  }
  const confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return undefined;
  }

  return {
    suggestedMachineOrigin: parsed.suggestedMachineOrigin,
    confidence,
    evidenceExcerpt:
      typeof parsed.evidenceExcerpt === "string"
        ? parsed.evidenceExcerpt.slice(0, 600)
        : "",
    sourceUrl:
      typeof parsed.sourceUrl === "string"
        ? parsed.sourceUrl.slice(0, 500)
        : "",
    sourceTitle:
      typeof parsed.sourceTitle === "string"
        ? parsed.sourceTitle.slice(0, 300)
        : "",
  };
}

/**
 * Fire-and-forget refresh of the AI machine-origin suggestion for one
 * proposal. Loads the proposal + evidence sources, classifies the company,
 * and patches the proposal via the Convex mutation. Non-fatal: any failure
 * is logged and swallowed so the caller route never blocks on AI.
 *
 * `sourcesOnly` limits the run to proposals that already have evidence
 * sources (lazy refresh from the review packet); otherwise the classification
 * runs from the company name alone.
 */
export async function refreshMachineOriginSuggestion(
  proposalId: string,
  options: { sourcesOnly?: boolean } = {},
): Promise<void> {
  try {
    const proposal = await getIndustryProposal(proposalId);
    if (!proposal) {
      logger.warn("machineOriginSuggestion: proposal not found", { proposalId });
      return;
    }
    if (proposal.suggestedMachineOrigin) {
      return; // already has a suggestion
    }
    const sources = await listIndustryEvidenceSources({ proposalId });
    if (options.sourcesOnly && sources.length === 0) {
      return;
    }
    const companyName = proposal.companyKey ?? proposal.normalizedEmployerSurface;
    if (!companyName) {
      logger.warn("machineOriginSuggestion: no company name", { proposalId });
      return;
    }
    const suggestion = await suggestMachineOrigin(
      companyName,
      proposal.suggestedIndustryClass ?? "unknown",
      sources.map((source) => ({
        title: source.title,
        url: source.url,
        evidenceExcerpt: source.evidenceExcerpt,
        sourceType: source.sourceType,
        trustTier: source.trustTier,
      })),
    );
    if (!suggestion) {
      return;
    }
    await callConvexMutation("industry_proposals:setIndustryProposalMachineOriginSuggestion", {
      proposalId,
      writeSecret: getConvexWriteSecret(),
      suggestedMachineOrigin: suggestion.suggestedMachineOrigin,
      confidence: suggestion.confidence,
      evidenceExcerpt: suggestion.evidenceExcerpt,
      sourceUrl: suggestion.sourceUrl,
      sourceTitle: suggestion.sourceTitle,
      model: suggestion.model,
    });
    logger.info("machineOriginSuggestion: patched", {
      proposalId,
      suggestedMachineOrigin: suggestion.suggestedMachineOrigin,
      confidence: suggestion.confidence,
    });
  } catch (error) {
    logger.warn("machineOriginSuggestion: skipped", {
      proposalId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}