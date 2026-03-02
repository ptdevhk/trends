import fs from "node:fs";
import path from "node:path";

import { findProjectRoot } from "./db.js";
import { type RuleWeightsConfig } from "./rule-scoring.js";
import { workspaceConfigService } from "./workspace-config-service.js";

type RuleCategoryWeights = RuleWeightsConfig["categoryWeights"];

export interface WeightHistoryEntry {
  ts: string;
  reason: string;
  jobDescriptionId?: string;
  before: RuleCategoryWeights;
  after: RuleCategoryWeights;
  metrics?: {
    currentNdcgAtK?: number;
    projectedNdcgAtK?: number;
    currentShortlistAtK?: number;
    projectedShortlistAtK?: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseCategoryWeights(value: unknown): RuleCategoryWeights | null {
  if (!isRecord(value)) {
    return null;
  }

  const weights: RuleCategoryWeights = {
    skillMatch: Number(value.skillMatch ?? NaN),
    experienceMatch: Number(value.experienceMatch ?? NaN),
    educationMatch: Number(value.educationMatch ?? NaN),
    locationMatch: Number(value.locationMatch ?? NaN),
    industryMatch: Number(value.industryMatch ?? NaN),
    brandRelevance: Number(value.brandRelevance ?? NaN),
  };

  const allFinite = Object.values(weights).every((weight) => isFiniteNumber(weight));
  return allFinite ? weights : null;
}

function parseEntry(value: unknown): WeightHistoryEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const ts = typeof value.ts === "string" ? value.ts : "";
  const reason = typeof value.reason === "string" ? value.reason : "";
  const before = parseCategoryWeights(value.before);
  const after = parseCategoryWeights(value.after);

  if (!ts || !reason || !before || !after) {
    return null;
  }

  const metrics = isRecord(value.metrics)
    ? {
      currentNdcgAtK: isFiniteNumber(value.metrics.currentNdcgAtK) ? value.metrics.currentNdcgAtK : undefined,
      projectedNdcgAtK: isFiniteNumber(value.metrics.projectedNdcgAtK) ? value.metrics.projectedNdcgAtK : undefined,
      currentShortlistAtK: isFiniteNumber(value.metrics.currentShortlistAtK) ? value.metrics.currentShortlistAtK : undefined,
      projectedShortlistAtK: isFiniteNumber(value.metrics.projectedShortlistAtK) ? value.metrics.projectedShortlistAtK : undefined,
    }
    : undefined;

  return {
    ts,
    reason,
    jobDescriptionId: typeof value.jobDescriptionId === "string" ? value.jobDescriptionId : undefined,
    before,
    after,
    metrics,
  };
}

export class WeightHistoryService {
  readonly projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
  }

  private getOutputDir(): string {
    return path.join(this.projectRoot, "output");
  }

  private getHistoryPath(): string {
    return path.join(this.getOutputDir(), "weight-history.jsonl");
  }

  private ensureOutputDir(): void {
    const outputDir = this.getOutputDir();
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  appendEntry(entry: Omit<WeightHistoryEntry, "ts"> & { ts?: string }): WeightHistoryEntry {
    this.ensureOutputDir();
    const normalized: WeightHistoryEntry = {
      ...entry,
      ts: entry.ts ?? new Date().toISOString(),
    };

    fs.appendFileSync(this.getHistoryPath(), `${JSON.stringify(normalized)}\n`, "utf8");
    return normalized;
  }

  getHistory(limit = 100): WeightHistoryEntry[] {
    const historyPath = this.getHistoryPath();
    if (!fs.existsSync(historyPath)) {
      return [];
    }

    const entries: WeightHistoryEntry[] = [];
    const lines = fs.readFileSync(historyPath, "utf8").split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = parseEntry(JSON.parse(trimmed));
        if (parsed) {
          entries.push(parsed);
        }
      } catch {
        // Ignore malformed lines to preserve append-only behavior.
      }
    }

    return entries
      .sort((left, right) => right.ts.localeCompare(left.ts))
      .slice(0, Math.max(1, limit));
  }

  async rollback(
    entryTs: string,
    workspaceSlug: string
  ): Promise<{ restored: WeightHistoryEntry; rollbackEntry: WeightHistoryEntry }> {
    const target = this.getHistory(5000).find((entry) => entry.ts === entryTs);
    if (!target) {
      throw new Error(`Weight history entry not found: ${entryTs}`);
    }

    const current = await workspaceConfigService.getRuleWeights(workspaceSlug);
    const rollbackConfig: RuleWeightsConfig = {
      ...current,
      categoryWeights: target.before,
    };
    await workspaceConfigService.setWorkspaceRuleWeights(workspaceSlug, rollbackConfig);

    const rollbackEntry = this.appendEntry({
      reason: `rollback:${entryTs}`,
      jobDescriptionId: target.jobDescriptionId,
      before: current.categoryWeights,
      after: target.before,
      metrics: {
        currentNdcgAtK: target.metrics?.projectedNdcgAtK,
        projectedNdcgAtK: target.metrics?.currentNdcgAtK,
        currentShortlistAtK: target.metrics?.projectedShortlistAtK,
        projectedShortlistAtK: target.metrics?.currentShortlistAtK,
      },
    });

    return {
      restored: target,
      rollbackEntry,
    };
  }
}
