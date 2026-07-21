import {
  evaluateResearchParity,
  isRecord,
  nextGreenStreak,
  type ParityDecisionInput,
} from "@trends/shared";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "yaml";

import { callConvexMutation, callConvexQuery } from "./convex-utils.js";
import { config } from "./config.js";

export type ResearchParityConfig = {
  goldenCompanyKeys: string[];
  aggregateRatioThreshold: number;
  requiredGreenStreak: number;
};

export function loadResearchParityConfig(projectRoot?: string): ResearchParityConfig {
  const root = projectRoot ?? resolve(process.cwd(), "../..");
  const path = resolve(root, "config/research_parity.yaml");
  try {
    const raw = readFileSync(path, "utf8");
    const doc = yaml.parse(raw) as Record<string, unknown>;
    const golden = Array.isArray(doc?.golden_companies)
      ? (doc.golden_companies as Array<Record<string, unknown>>)
          .map((g) => (typeof g.companyKey === "string" ? g.companyKey : ""))
          .filter(Boolean)
      : ["pro-technic-machinery", "polywell"];
    return {
      goldenCompanyKeys: golden,
      aggregateRatioThreshold:
        typeof doc?.aggregate_ratio_threshold === "number" ? doc.aggregate_ratio_threshold : 0.8,
      requiredGreenStreak:
        typeof doc?.required_green_streak === "number" ? doc.required_green_streak : 3,
    };
  } catch {
    return {
      goldenCompanyKeys: ["pro-technic-machinery", "polywell"],
      aggregateRatioThreshold: 0.8,
      requiredGreenStreak: 3,
    };
  }
}

export function decideParity(input: ParityDecisionInput) {
  return evaluateResearchParity(input);
}

export async function recordParityFromComparison(args: {
  parityRunId: string;
  evaluatedAt: number;
  windowStart: number;
  windowEnd: number;
  enabledPlatforms: string[];
  platformBreakdown: Array<{ platform: string; nativeCount: number; shadowCount: number }>;
  goldenCompanies: Array<{ companyKey: string; signalCount: number }>;
  nativeTotal?: number;
  shadowTotal?: number;
}): Promise<{ green: boolean; greenStreak: number; decision: ReturnType<typeof evaluateResearchParity> }> {
  const decision = evaluateResearchParity({
    platformBreakdown: args.platformBreakdown,
    goldenCompanies: args.goldenCompanies,
    nativeTotal: args.nativeTotal,
    shadowTotal: args.shadowTotal,
  });

  const value = await callConvexMutation("research_ops:recordParityRun", {
    writeSecret: config.auth.convexWriteSecret,
    parityRunId: args.parityRunId,
    evaluatedAt: args.evaluatedAt,
    windowStart: args.windowStart,
    windowEnd: args.windowEnd,
    enabledPlatforms: args.enabledPlatforms,
    nativeTotal: decision.nativeTotal,
    shadowTotal: decision.shadowTotal,
    aggregateRatio: decision.aggregateRatio,
    platformBreakdown: decision.platformBreakdown,
    goldenCompanyResults: decision.goldenCompanyResults,
    nativeNonEmpty: decision.nativeNonEmpty,
    green: decision.green,
  });

  const greenStreak =
    isRecord(value) && typeof value.greenStreak === "number"
      ? value.greenStreak
      : nextGreenStreak(0, decision.green);

  return { green: decision.green, greenStreak, decision };
}

export async function fetchLatestParityRow(): Promise<unknown | null> {
  const value = await callConvexQuery("research_ops:latestParity", {
    writeSecret: config.auth.convexWriteSecret,
  });
  return value ?? null;
}
