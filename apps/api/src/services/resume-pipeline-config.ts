import fs from "node:fs";
import path from "node:path";

import JSON5 from "json5";
import { z } from "zod";

import { findProjectRoot } from "./db.js";

const ResumePipelineConfigSchema = z.object({
  aiMatching: z
    .object({
      concurrency: z.number().int().min(1).max(50).optional(),
    })
    .optional(),
  ruleScoring: z
    .object({
      topCandidatesForAi: z.number().int().min(1).max(500).optional(),
      minRuleScoreForAi: z.number().int().min(0).max(100).optional(),
    })
    .optional(),
}).passthrough();

export type ResumePipelineConfig = z.infer<typeof ResumePipelineConfigSchema>;

type CachedConfig = {
  mtimeMs: number;
  config: ResumePipelineConfig;
};

export class ResumePipelineConfigService {
  readonly projectRoot: string;
  private cache: CachedConfig | null = null;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
  }

  private getConfigPath(): string {
    return path.join(this.projectRoot, "config", "resume", "agents.json5");
  }

  private loadConfig(): ResumePipelineConfig {
    const configPath = this.getConfigPath();
    if (!fs.existsSync(configPath)) {
      return {};
    }

    const stat = fs.statSync(configPath);
    const mtimeMs = stat.mtimeMs;
    if (this.cache && this.cache.mtimeMs === mtimeMs) {
      return this.cache.config;
    }

    const content = fs.readFileSync(configPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON5.parse(content);
    } catch (error) {
      console.error("[ResumePipelineConfig] Failed to parse agents.json5", error);
      this.cache = { mtimeMs, config: {} };
      return {};
    }

    const validated = ResumePipelineConfigSchema.safeParse(parsed);
    if (!validated.success) {
      console.error("[ResumePipelineConfig] Invalid agents.json5 shape", validated.error);
      this.cache = { mtimeMs, config: {} };
      return {};
    }

    this.cache = { mtimeMs, config: validated.data };
    return validated.data;
  }

  getAiMatchingConcurrency(): number {
    const config = this.loadConfig();
    return config.aiMatching?.concurrency ?? 5;
  }

  getRuleTopCandidatesForAi(): number {
    const config = this.loadConfig();
    return config.ruleScoring?.topCandidatesForAi ?? 20;
  }

  getRuleMinScoreForAi(): number {
    const config = this.loadConfig();
    return config.ruleScoring?.minRuleScoreForAi ?? 60;
  }
}

