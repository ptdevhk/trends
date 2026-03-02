import fs from "node:fs";
import path from "node:path";

import { findProjectRoot } from "./db.js";
import { type RuleWeightsConfig } from "./rule-scoring.js";
import {
  SearchEventAnalyzer,
  type AnalysisReport,
  type WeightValidationReport,
  type WeightAdjustmentSuggestion,
} from "./search-event-analyzer.js";
import { WeightHistoryService, type WeightHistoryEntry } from "./weight-history.js";
import { workspaceConfigService } from "./workspace-config-service.js";

type RuleCategoryWeights = RuleWeightsConfig["categoryWeights"];
type CategoryKey = keyof RuleCategoryWeights;

interface AutoTuneState {
  lastRunAt?: string;
  lastAppliedAt?: string;
}

type FetchLike = typeof fetch;

export interface ScoringAutoTuneRunOptions {
  workspaceSlug?: string;
  dryRun?: boolean;
  periodDays?: number;
  k?: number;
  jobDescriptionId?: string;
  minLabeledActions?: number;
  ndcgImprovementThreshold?: number;
  reingestLimit?: number;
}

export interface ScoringAutoTuneRunResult {
  status:
    | "applied"
    | "dry_run"
    | "cooldown"
    | "insufficient_data"
    | "no_job_description"
    | "no_suggestions"
    | "no_improvement";
  executedAt: string;
  reason?: string;
  report: AnalysisReport;
  jobDescriptionId?: string;
  proposedCategoryWeights?: RuleCategoryWeights;
  validation?: WeightValidationReport;
  historyEntry?: WeightHistoryEntry;
  synonymsApplied?: number;
  reingestTriggered?: boolean;
}

function parseIsoToTime(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const CATEGORY_KEYS: CategoryKey[] = [
  "skillMatch",
  "experienceMatch",
  "educationMatch",
  "locationMatch",
  "industryMatch",
  "brandRelevance",
];

function sumWeights(weights: RuleCategoryWeights): number {
  return CATEGORY_KEYS.reduce((sum, category) => sum + weights[category], 0);
}

function buildWeightLimits(current: RuleCategoryWeights): Record<CategoryKey, { min: number; max: number }> {
  return {
    skillMatch: {
      min: Math.max(0, current.skillMatch - 3),
      max: current.skillMatch + 3,
    },
    experienceMatch: {
      min: Math.max(0, current.experienceMatch - 3),
      max: current.experienceMatch + 3,
    },
    educationMatch: {
      min: Math.max(0, current.educationMatch - 3),
      max: current.educationMatch + 3,
    },
    locationMatch: {
      min: Math.max(0, current.locationMatch - 3),
      max: current.locationMatch + 3,
    },
    industryMatch: {
      min: Math.max(0, current.industryMatch - 3),
      max: current.industryMatch + 3,
    },
    brandRelevance: {
      min: Math.max(0, current.brandRelevance - 3),
      max: current.brandRelevance + 3,
    },
  };
}

function normalizeWeightBudget(
  candidate: RuleCategoryWeights,
  current: RuleCategoryWeights
): RuleCategoryWeights | null {
  const limits = buildWeightLimits(current);
  const normalized: RuleCategoryWeights = { ...candidate };

  for (const category of CATEGORY_KEYS) {
    normalized[category] = clampInteger(
      normalized[category],
      limits[category].min,
      limits[category].max
    );
  }

  let diff = 100 - sumWeights(normalized);
  let guard = 0;

  while (diff !== 0 && guard < 2000) {
    guard += 1;

    const candidates = CATEGORY_KEYS
      .filter((category) => {
        if (diff > 0) {
          return normalized[category] < limits[category].max;
        }
        return normalized[category] > limits[category].min;
      })
      .sort((left, right) => {
        if (diff > 0) {
          return normalized[right] - normalized[left];
        }
        return normalized[left] - normalized[right];
      });

    if (candidates.length === 0) {
      break;
    }

    const category = candidates[0];
    if (diff > 0) {
      normalized[category] += 1;
      diff -= 1;
      continue;
    }
    normalized[category] -= 1;
    diff += 1;
  }

  if (diff !== 0) {
    return null;
  }

  return normalized;
}

function areCategoryWeightsEqual(left: RuleCategoryWeights, right: RuleCategoryWeights): boolean {
  return CATEGORY_KEYS.every((category) => left[category] === right[category]);
}

export class ScoringAutoTuner {
  private readonly projectRoot: string;
  private readonly analyzer: SearchEventAnalyzer;
  private readonly weightHistory: WeightHistoryService;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  constructor(
    projectRoot?: string,
    deps?: {
      analyzer?: SearchEventAnalyzer;
      weightHistory?: WeightHistoryService;
      fetchImpl?: FetchLike;
      now?: () => Date;
    }
  ) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    this.analyzer = deps?.analyzer ?? new SearchEventAnalyzer(this.projectRoot);
    this.weightHistory = deps?.weightHistory ?? new WeightHistoryService(this.projectRoot);
    this.fetchImpl = deps?.fetchImpl ?? fetch;
    this.now = deps?.now ?? (() => new Date());
  }

  private getStatePath(): string {
    return path.join(this.projectRoot, "output", "auto-tune-state.json");
  }

  private readState(): AutoTuneState {
    const statePath = this.getStatePath();
    if (!fs.existsSync(statePath)) {
      return {};
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as unknown;
      if (!isRecord(parsed)) {
        return {};
      }
      return {
        lastRunAt: typeof parsed.lastRunAt === "string" ? parsed.lastRunAt : undefined,
        lastAppliedAt: typeof parsed.lastAppliedAt === "string" ? parsed.lastAppliedAt : undefined,
      };
    } catch {
      return {};
    }
  }

  private writeState(state: AutoTuneState): void {
    const statePath = this.getStatePath();
    const outputDir = path.dirname(statePath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  private applySuggestions(
    current: RuleCategoryWeights,
    suggestions: WeightAdjustmentSuggestion[]
  ): RuleCategoryWeights | null {
    const merged = new Map<CategoryKey, number>();
    for (const suggestion of suggestions) {
      const existing = merged.get(suggestion.category) ?? 0;
      const delta = clampInteger(suggestion.delta, -3, 3);
      merged.set(suggestion.category, clampInteger(existing + delta, -3, 3));
    }

    const candidate: RuleCategoryWeights = { ...current };
    for (const [category, delta] of merged.entries()) {
      candidate[category] += delta;
    }

    return normalizeWeightBudget(candidate, current);
  }

  private async triggerReingest(limit: number): Promise<boolean> {
    const rawBase = process.env.TRENDS_API_URL?.trim() || "http://localhost:3000";
    const base = rawBase.replace(/\/+$/u, "");
    const response = await this.fetchImpl(`${base}/api/resumes/trigger-reingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit }),
    });

    if (!response.ok) {
      return false;
    }

    const payload = await response.json().catch(() => null);
    return isRecord(payload) && payload.success === true;
  }

  async run(options?: ScoringAutoTuneRunOptions): Promise<ScoringAutoTuneRunResult> {
    const workspaceSlug = options?.workspaceSlug?.trim() || "dev";
    const dryRun = options?.dryRun === true;
    const periodDays = Math.max(1, options?.periodDays ?? 14);
    const k = Math.max(1, options?.k ?? 10);
    const minLabeledActions = Math.max(1, options?.minLabeledActions ?? 20);
    const ndcgImprovementThreshold = options?.ndcgImprovementThreshold ?? 0.02;
    const reingestLimit = Math.max(1, options?.reingestLimit ?? 200);
    const executedAt = this.now().toISOString();

    const state = this.readState();
    const cooldownMs = 24 * 60 * 60 * 1000;
    const elapsed = parseIsoToTime(executedAt) - parseIsoToTime(state.lastRunAt);
    if (!dryRun && state.lastRunAt && elapsed < cooldownMs) {
      const report = this.analyzer.analyze({ periodDays, k });
      return {
        status: "cooldown",
        executedAt,
        reason: "Auto-tune cooldown is active (24h).",
        report,
      };
    }

    const report = this.analyzer.analyze({ periodDays, k });
    if (report.summary.labeledActions < minLabeledActions) {
      if (!dryRun) {
        this.writeState({ ...state, lastRunAt: executedAt });
      }
      return {
        status: "insufficient_data",
        executedAt,
        reason: `Need at least ${minLabeledActions} labeled actions (got ${report.summary.labeledActions}).`,
        report,
      };
    }

    const currentConfig = await workspaceConfigService.getRuleWeights(workspaceSlug);
    const proposedCategoryWeights = this.applySuggestions(
      currentConfig.categoryWeights,
      report.suggestions.weightAdjustments
    );

    if (!proposedCategoryWeights || areCategoryWeightsEqual(proposedCategoryWeights, currentConfig.categoryWeights)) {
      if (!dryRun) {
        this.writeState({ ...state, lastRunAt: executedAt });
      }
      return {
        status: "no_suggestions",
        executedAt,
        reason: "No valid bounded weight suggestions were produced.",
        report,
      };
    }

    const jobDescriptionId = options?.jobDescriptionId ?? report.rankingMetrics.topJobDescriptionId;
    if (!jobDescriptionId) {
      if (!dryRun) {
        this.writeState({ ...state, lastRunAt: executedAt });
      }
      return {
        status: "no_job_description",
        executedAt,
        reason: "No target job description found for weight validation.",
        report,
        proposedCategoryWeights,
      };
    }

    const validation = this.analyzer.validateCategoryWeights({
      jobDescriptionId,
      proposedCategoryWeights,
      periodDays,
      k,
    });

    if (validation.delta.ndcgAtK <= ndcgImprovementThreshold) {
      if (!dryRun) {
        this.writeState({ ...state, lastRunAt: executedAt });
      }
      return {
        status: "no_improvement",
        executedAt,
        reason: `Projected NDCG improvement (${validation.delta.ndcgAtK}) is below threshold (${ndcgImprovementThreshold}).`,
        report,
        jobDescriptionId,
        proposedCategoryWeights,
        validation,
      };
    }

    if (dryRun) {
      return {
        status: "dry_run",
        executedAt,
        report,
        jobDescriptionId,
        proposedCategoryWeights,
        validation,
      };
    }

    const updatedConfig: RuleWeightsConfig = {
      ...currentConfig,
      categoryWeights: proposedCategoryWeights,
    };
    await workspaceConfigService.setWorkspaceRuleWeights(workspaceSlug, updatedConfig);

    const highConfidenceSynonyms = report.suggestions.synonymSuggestions
      .filter((suggestion) => suggestion.confidence >= 0.8)
      .map((suggestion) => ({
        variant: suggestion.variant,
        canonical: suggestion.canonical,
      }));
    const synonymsApplied = highConfidenceSynonyms.length;
    for (const suggestion of highConfidenceSynonyms) {
      await workspaceConfigService.appendLearningLogEntry(
        workspaceSlug,
        `synonym_suggestion: ${suggestion.variant} -> ${suggestion.canonical}`
      );
    }
    await workspaceConfigService.appendLearningLogEntry(
      workspaceSlug,
      `auto_tune_weights: ndcg ${validation.current.ndcgAtK} -> ${validation.projected.ndcgAtK}`
    );

    const historyEntry = this.weightHistory.appendEntry({
      reason: "auto_tune",
      jobDescriptionId,
      before: currentConfig.categoryWeights,
      after: proposedCategoryWeights,
      metrics: {
        currentNdcgAtK: validation.current.ndcgAtK,
        projectedNdcgAtK: validation.projected.ndcgAtK,
        currentShortlistAtK: validation.current.shortlistAtK,
        projectedShortlistAtK: validation.projected.shortlistAtK,
      },
    });

    let reingestTriggered = false;
    try {
      reingestTriggered = await this.triggerReingest(reingestLimit);
    } catch (error) {
      console.error("[ScoringAutoTuner] Failed to trigger re-ingest:", error);
    }

    this.writeState({
      lastRunAt: executedAt,
      lastAppliedAt: executedAt,
    });

    return {
      status: "applied",
      executedAt,
      report,
      jobDescriptionId,
      proposedCategoryWeights,
      validation,
      historyEntry,
      synonymsApplied,
      reingestTriggered,
    };
  }
}
