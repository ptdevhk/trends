import fs from "node:fs";
import path from "node:path";

import { findProjectRoot } from "./db.js";

export type SearchEventType = "search_query" | "search_zero_results" | "candidate_action";

export interface SearchQueryEvent {
  type: "search_query";
  query: string;
  resultCount: number;
  topScore?: number;
  ts: string;
}

export interface SearchZeroResultsEvent {
  type: "search_zero_results";
  query: string;
  ts: string;
}

export interface CandidateActionEvent {
  type: "candidate_action";
  resumeId: string;
  action: "shortlist" | "reject";
  query?: string;
  ts: string;
}

export type SearchEvent = SearchQueryEvent | SearchZeroResultsEvent | CandidateActionEvent;

export interface ZeroResultSummaryItem {
  query: string;
  count: number;
  lastSeen: string;
}

export interface SearchSummary {
  totalSearches: number;
  zeroResultSearches: number;
  zeroResultRate: number;
  topQueries: Array<{ query: string; count: number }>;
  actionDistribution: Record<string, number>;
  dailyTrend: Array<{
    date: string;
    searches: number;
    zeroResults: number;
    shortlist: number;
    reject: number;
  }>;
}

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function parseSearchEvent(value: unknown): SearchEvent | null {
  if (!isRecord(value)) return null;

  const type = readString(value.type);
  const ts = readString(value.ts);

  if (!type || !ts) {
    return null;
  }

  if (type === "search_query") {
    const query = readString(value.query);
    const resultCount = readNumber(value.resultCount);
    const topScore = readNumber(value.topScore) ?? undefined;
    if (!query || resultCount === null) {
      return null;
    }
    return {
      type,
      query,
      resultCount,
      topScore,
      ts,
    };
  }

  if (type === "search_zero_results") {
    const query = readString(value.query);
    if (!query) {
      return null;
    }
    return {
      type,
      query,
      ts,
    };
  }

  if (type === "candidate_action") {
    const resumeId = readString(value.resumeId);
    const action = readString(value.action);
    const query = readString(value.query) ?? undefined;
    if (!resumeId || (action !== "shortlist" && action !== "reject")) {
      return null;
    }

    return {
      type,
      resumeId,
      action,
      query,
      ts,
    };
  }

  return null;
}

export class SearchEventLogger {
  readonly projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
  }

  private getOutputDir(): string {
    return path.join(this.projectRoot, "output");
  }

  private getLogPath(): string {
    return path.join(this.getOutputDir(), "search-events.jsonl");
  }

  private ensureOutputDir(): void {
    const outputDir = this.getOutputDir();
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  private appendEvent(event: SearchEvent): void {
    this.ensureOutputDir();
    fs.appendFileSync(this.getLogPath(), `${JSON.stringify(event)}\n`, "utf8");
  }

  private readEvents(): SearchEvent[] {
    const logPath = this.getLogPath();
    if (!fs.existsSync(logPath)) {
      return [];
    }

    const content = fs.readFileSync(logPath, "utf8");
    const events: SearchEvent[] = [];

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const event = parseSearchEvent(parsed);
        if (event) {
          events.push(event);
        }
      } catch {
        // Skip malformed lines to keep the log append-only.
      }
    }

    return events;
  }

  getEvents(options?: {
    since?: string | Date;
    types?: SearchEventType[];
  }): SearchEvent[] {
    const sinceIso = options?.since instanceof Date
      ? options.since.toISOString()
      : typeof options?.since === "string"
        ? options.since
        : null;
    const typeSet = options?.types?.length ? new Set(options.types) : null;

    return this.readEvents().filter((event) => {
      if (sinceIso && event.ts < sinceIso) {
        return false;
      }
      if (typeSet && !typeSet.has(event.type)) {
        return false;
      }
      return true;
    });
  }

  logSearchQuery(params: {
    query: string;
    resultCount: number;
    topScore?: number;
  }): void {
    const query = normalizeQuery(params.query);
    if (!query) {
      return;
    }

    const resultCount = Number.isFinite(params.resultCount)
      ? Math.max(0, Math.round(params.resultCount))
      : 0;

    const topScore = typeof params.topScore === "number" && Number.isFinite(params.topScore)
      ? params.topScore
      : undefined;

    const queryEvent: SearchQueryEvent = {
      type: "search_query",
      query,
      resultCount,
      topScore,
      ts: new Date().toISOString(),
    };

    this.appendEvent(queryEvent);

    if (resultCount === 0) {
      const zeroResultEvent: SearchZeroResultsEvent = {
        type: "search_zero_results",
        query,
        ts: queryEvent.ts,
      };
      this.appendEvent(zeroResultEvent);
    }
  }

  logCandidateAction(params: {
    resumeId: string;
    action: "shortlist" | "reject";
    query?: string;
  }): void {
    const resumeId = params.resumeId.trim();
    if (!resumeId) {
      return;
    }

    const actionEvent: CandidateActionEvent = {
      type: "candidate_action",
      resumeId,
      action: params.action,
      query: params.query ? normalizeQuery(params.query) : undefined,
      ts: new Date().toISOString(),
    };

    this.appendEvent(actionEvent);
  }

  getZeroResultSummary(limit = 50): ZeroResultSummaryItem[] {
    const frequencies = new Map<string, { count: number; lastSeen: string }>();

    for (const event of this.readEvents()) {
      if (event.type !== "search_zero_results") {
        continue;
      }

      const current = frequencies.get(event.query);
      if (current) {
        current.count += 1;
        if (event.ts > current.lastSeen) {
          current.lastSeen = event.ts;
        }
      } else {
        frequencies.set(event.query, { count: 1, lastSeen: event.ts });
      }
    }

    return Array.from(frequencies.entries())
      .map(([query, meta]) => ({ query, count: meta.count, lastSeen: meta.lastSeen }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return right.lastSeen.localeCompare(left.lastSeen);
      })
      .slice(0, Math.max(1, limit));
  }

  getZeroResultQueries(limit = 200): string[] {
    return this.getZeroResultSummary(limit).map((item) => item.query);
  }

  getSummary(options?: { topQueryLimit?: number; dailyLimit?: number }): SearchSummary {
    const topQueryLimit = Math.max(1, options?.topQueryLimit ?? 10);
    const dailyLimit = Math.max(1, options?.dailyLimit ?? 14);
    const events = this.readEvents();

    const queryFrequency = new Map<string, number>();
    const actionDistribution: Record<string, number> = {
      shortlist: 0,
      reject: 0,
    };

    const daily = new Map<string, {
      searches: number;
      zeroResults: number;
      shortlist: number;
      reject: number;
    }>();

    let totalSearches = 0;
    let zeroResultSearches = 0;

    for (const event of events) {
      const date = event.ts.slice(0, 10);
      const day = daily.get(date) ?? { searches: 0, zeroResults: 0, shortlist: 0, reject: 0 };

      if (event.type === "search_query") {
        totalSearches += 1;
        day.searches += 1;
        queryFrequency.set(event.query, (queryFrequency.get(event.query) ?? 0) + 1);
      }

      if (event.type === "search_zero_results") {
        zeroResultSearches += 1;
        day.zeroResults += 1;
      }

      if (event.type === "candidate_action") {
        if (event.action === "shortlist") {
          actionDistribution.shortlist += 1;
          day.shortlist += 1;
        }
        if (event.action === "reject") {
          actionDistribution.reject += 1;
          day.reject += 1;
        }
      }

      daily.set(date, day);
    }

    const topQueries = Array.from(queryFrequency.entries())
      .map(([query, count]) => ({ query, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, topQueryLimit);

    const dailyTrend = Array.from(daily.entries())
      .map(([date, values]) => ({
        date,
        searches: values.searches,
        zeroResults: values.zeroResults,
        shortlist: values.shortlist,
        reject: values.reject,
      }))
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, dailyLimit)
      .reverse();

    return {
      totalSearches,
      zeroResultSearches,
      zeroResultRate: totalSearches > 0
        ? Number((zeroResultSearches / totalSearches).toFixed(4))
        : 0,
      topQueries,
      actionDistribution,
      dailyTrend,
    };
  }
}

export const searchEventLogger = new SearchEventLogger();
