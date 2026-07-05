import fs from "node:fs";
import path from "node:path";
import { isRecord } from "@trends/shared";


import { findProjectRoot } from "./db.js";


export interface WebVitalMetric {
  name: string;
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  id: string;
  navigationType: string;
  workspace: string;
  timestamp: number;
}

export interface MetricSummary {
  p50: number;
  p75: number;
  p95: number;
  good: number;
  needsImprovement: number;
  poor: number;
}

export interface WebVitalsSummary {
  totalReports: number;
  metrics: Record<string, MetricSummary>;
}


export function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

export function parseMetric(value: unknown): WebVitalMetric | null {
  if (!isRecord(value)) return null;

  const name = readString(value.name);
  const valueNum = readNumber(value.value);
  const rating = readString(value.rating);
  const id = readString(value.id);
  const navigationType = readString(value.navigationType);
  const workspace = readString(value.workspace);
  const timestamp = readNumber(value.timestamp);

  if (
    !name ||
    valueNum === null ||
    !id ||
    !navigationType ||
    !workspace ||
    timestamp === null
  ) {
    return null;
  }

  if (rating !== "good" && rating !== "needs-improvement" && rating !== "poor") {
    return null;
  }

  return { name, value: valueNum, rating, id, navigationType, workspace, timestamp };
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export class WebVitalsLogger {
  readonly projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
  }

  private getOutputDir(): string {
    return path.join(this.projectRoot, "output");
  }

  private getLogPath(): string {
    return path.join(this.getOutputDir(), "web-vitals.jsonl");
  }

  private ensureOutputDir(): void {
    const outputDir = this.getOutputDir();
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  logMetric(metric: WebVitalMetric): void {
    this.ensureOutputDir();
    fs.appendFileSync(
      this.getLogPath(),
      `${JSON.stringify(metric)}\n`,
      "utf8",
    );
  }

  private readMetrics(sinceTimestamp?: number): WebVitalMetric[] {
    const logPath = this.getLogPath();
    if (!fs.existsSync(logPath)) {
      return [];
    }

    const content = fs.readFileSync(logPath, "utf8");
    const metrics: WebVitalMetric[] = [];

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const metric = parseMetric(parsed);
        if (metric) {
          if (!sinceTimestamp || metric.timestamp >= sinceTimestamp) {
            metrics.push(metric);
          }
        }
      } catch (error) {
        console.error("Failed to parse web vitals log line", error);
        // Skip malformed lines.
      }
    }

    return metrics;
  }

  getSummary(hours = 24): WebVitalsSummary {
    const sinceTimestamp = Date.now() - hours * 60 * 60 * 1000;
    const metrics = this.readMetrics(sinceTimestamp);

    const byName = new Map<string, WebVitalMetric[]>();
    for (const metric of metrics) {
      const group = byName.get(metric.name) ?? [];
      group.push(metric);
      byName.set(metric.name, group);
    }

    const result: Record<string, MetricSummary> = {};

    for (const [name, group] of byName) {
      const values = group.map((m) => m.value).sort((a, b) => a - b);
      result[name] = {
        p50: percentile(values, 50),
        p75: percentile(values, 75),
        p95: percentile(values, 95),
        good: group.filter((m) => m.rating === "good").length,
        needsImprovement: group.filter((m) => m.rating === "needs-improvement").length,
        poor: group.filter((m) => m.rating === "poor").length,
      };
    }

    return { totalReports: metrics.length, metrics: result };
  }
}
