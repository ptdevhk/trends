/**
 * Types and parser for AI screening checklist with deterministic rules-layer priorities.
 */
import { isRecord } from "@trends/shared";
import { getResumeIngestData } from "./analysis_normalization.js";

export type ChecklistVerdict<T extends string = string> = {
    verdict: T;
    evidence?: string;
};

export interface ScreeningChecklistItem {
    verdict: string;
    evidence?: string;
}

export type ScreeningChecklistGeneratedBy = "rules" | "ai" | "rules+ai";

export interface ScreeningChecklist {
    generatedBy?: ScreeningChecklistGeneratedBy;
    sellsMachines: ScreeningChecklistItem;   // yes|no|unclear
    machineOrigin: ScreeningChecklistItem;   // international|domestic|unknown
    channel: ScreeningChecklistItem;         // direct|distributor|unclear
    region: ScreeningChecklistItem;          // verdict = free text (region), empty string when unknown
    contactStatus: ScreeningChecklistItem;   // valid|problem|unclear
}

const VALID_SELLS_MACHINES = new Set(["yes", "no", "unclear"]);
const VALID_MACHINE_ORIGIN = new Set(["international", "domestic", "unknown"]);
const VALID_CHANNEL = new Set(["direct", "distributor", "unclear"]);
const VALID_CONTACT_STATUS = new Set(["valid", "problem", "unclear"]);

const MAX_EVIDENCE_LENGTH = 120;

export function cleanEvidence(evidence: unknown): string | undefined {
    if (typeof evidence !== "string") {
        return undefined;
    }
    const flattened = evidence.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
    if (flattened.length === 0) {
        return undefined;
    }
    return flattened.length > MAX_EVIDENCE_LENGTH ? flattened.slice(0, MAX_EVIDENCE_LENGTH) : flattened;
}

function parseRawItem(item: unknown): { verdict?: string; evidence?: string } | null {
    if (!isRecord(item)) {
        return null;
    }
    const verdict = typeof item.verdict === "string" ? item.verdict.trim() : undefined;
    const evidence = cleanEvidence(item.evidence);
    return { verdict, evidence };
}

function hasCompleteMachineBrandHit(ingestData: Record<string, unknown>): boolean {
    const brandHits = Array.isArray(ingestData.brandHits) ? ingestData.brandHits : [];
    const hitMatch = brandHits.some((hit) => {
        if (!isRecord(hit)) return false;
        const pc = typeof hit.productClass === "string"
            ? hit.productClass.trim().toLowerCase()
            : (typeof hit.product_class === "string" ? hit.product_class.trim().toLowerCase() : undefined);
        return pc === "complete_machine";
    });
    if (hitMatch) return true;

    if (typeof ingestData.productClass === "string" && ingestData.productClass.trim().toLowerCase() === "complete_machine") {
        return true;
    }
    return false;
}

export function parseScreeningChecklist(raw: unknown, resume: unknown): ScreeningChecklist {
    const rawObj = isRecord(raw) ? raw : {};

    const rawSellsMachines = parseRawItem(rawObj.sellsMachines);
    const rawMachineOrigin = parseRawItem(rawObj.machineOrigin);
    const rawChannel = parseRawItem(rawObj.channel);
    const rawRegion = parseRawItem(rawObj.region);
    const rawContactStatus = parseRawItem(rawObj.contactStatus);

    let aiSellsMachines: ScreeningChecklistItem | undefined;
    if (rawSellsMachines?.verdict && VALID_SELLS_MACHINES.has(rawSellsMachines.verdict.toLowerCase())) {
        aiSellsMachines = {
            verdict: rawSellsMachines.verdict.toLowerCase(),
            ...(rawSellsMachines.evidence ? { evidence: rawSellsMachines.evidence } : {}),
        };
    }

    let aiMachineOrigin: ScreeningChecklistItem | undefined;
    if (rawMachineOrigin?.verdict && VALID_MACHINE_ORIGIN.has(rawMachineOrigin.verdict.toLowerCase())) {
        aiMachineOrigin = {
            verdict: rawMachineOrigin.verdict.toLowerCase(),
            ...(rawMachineOrigin.evidence ? { evidence: rawMachineOrigin.evidence } : {}),
        };
    }

    let aiChannel: ScreeningChecklistItem | undefined;
    if (rawChannel?.verdict && VALID_CHANNEL.has(rawChannel.verdict.toLowerCase())) {
        aiChannel = {
            verdict: rawChannel.verdict.toLowerCase(),
            ...(rawChannel.evidence ? { evidence: rawChannel.evidence } : {}),
        };
    }

    let aiRegion: ScreeningChecklistItem | undefined;
    if (rawRegion?.verdict) {
        const flattenedRegion = rawRegion.verdict.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
        if (flattenedRegion.length > 0) {
            aiRegion = {
                verdict: flattenedRegion.length > MAX_EVIDENCE_LENGTH ? flattenedRegion.slice(0, MAX_EVIDENCE_LENGTH) : flattenedRegion,
                ...(rawRegion.evidence ? { evidence: rawRegion.evidence } : {}),
            };
        }
    }

    let aiContactStatus: ScreeningChecklistItem | undefined;
    if (rawContactStatus?.verdict && VALID_CONTACT_STATUS.has(rawContactStatus.verdict.toLowerCase())) {
        aiContactStatus = {
            verdict: rawContactStatus.verdict.toLowerCase(),
            ...(rawContactStatus.evidence ? { evidence: rawContactStatus.evidence } : {}),
        };
    }

    let rulesOverrodeAi = false;
    let survivingAiCount = 0;

    const ingestData = getResumeIngestData(resume);

    // Rule 1: machineOrigin Tier-1/3 reuse from resume.ingestData.brandOrigin
    let finalMachineOrigin: ScreeningChecklistItem;
    const rawBrandOrigin = typeof ingestData.brandOrigin === "string"
        ? ingestData.brandOrigin.trim().toLowerCase()
        : undefined;

    if (rawBrandOrigin === "international" || rawBrandOrigin === "domestic") {
        if (aiMachineOrigin !== undefined && aiMachineOrigin.verdict !== rawBrandOrigin) {
            rulesOverrodeAi = true;
        } else if (aiMachineOrigin !== undefined) {
            rulesOverrodeAi = true;
        }
        finalMachineOrigin = {
            verdict: rawBrandOrigin,
            evidence: cleanEvidence(`来源: ingestData.brandOrigin=${rawBrandOrigin}`),
        };
    } else if (aiMachineOrigin !== undefined) {
        survivingAiCount++;
        finalMachineOrigin = aiMachineOrigin;
    } else {
        finalMachineOrigin = { verdict: "unknown" };
    }

    // Rule 2: sellsMachines hint from ingestData.brandHits complete_machine
    let finalSellsMachines: ScreeningChecklistItem;
    const hasCompleteMachine = hasCompleteMachineBrandHit(ingestData);

    if (hasCompleteMachine && aiSellsMachines?.verdict === "no") {
        rulesOverrodeAi = true;
        finalSellsMachines = {
            verdict: "unclear",
            evidence: cleanEvidence("规则修正: AI判定为no，但brandHits中存在complete_machine整机记录"),
        };
    } else if (aiSellsMachines !== undefined) {
        survivingAiCount++;
        finalSellsMachines = aiSellsMachines;
    } else {
        finalSellsMachines = { verdict: "unclear" };
    }

    // Channel
    let finalChannel: ScreeningChecklistItem;
    if (aiChannel !== undefined) {
        survivingAiCount++;
        finalChannel = aiChannel;
    } else {
        finalChannel = { verdict: "unclear" };
    }

    // Region
    let finalRegion: ScreeningChecklistItem;
    if (aiRegion !== undefined) {
        survivingAiCount++;
        finalRegion = aiRegion;
    } else {
        finalRegion = { verdict: "" };
    }

    // ContactStatus
    let finalContactStatus: ScreeningChecklistItem;
    if (aiContactStatus !== undefined) {
        survivingAiCount++;
        finalContactStatus = aiContactStatus;
    } else {
        finalContactStatus = { verdict: "unclear" };
    }

    let generatedBy: ScreeningChecklistGeneratedBy;
    if (rulesOverrodeAi) {
        generatedBy = "rules+ai";
    } else if (survivingAiCount > 0) {
        generatedBy = "ai";
    } else {
        generatedBy = "rules";
    }

    return {
        generatedBy,
        sellsMachines: finalSellsMachines,
        machineOrigin: finalMachineOrigin,
        channel: finalChannel,
        region: finalRegion,
        contactStatus: finalContactStatus,
    };
}
