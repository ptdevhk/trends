import path from "node:path";

import { findProjectRoot } from "./db.js";
import { MatchStorage } from "./match-storage.js";
import { loadRuleWeightsConfig, type RuleWeightsConfig } from "./rule-scoring.js";
import {
  SearchEventLogger,
  type CandidateActionEvent,
  type SearchQueryEvent,
  type SearchZeroResultsEvent,
} from "./search-event-logger.js";
import {
  ndcgAtK,
  scoreDistributionStats,
  shortlistAtK,
  type RankingLabel,
  type ScoreDistributionStatsResult,
} from "./scoring-metrics.js";
import { SkillsKnowledgeService, type SynonymSuggestion } from "./skills-knowledge.js";

type RuleCategoryWeights = RuleWeightsConfig["categoryWeights"];
type CategoryKey = keyof RuleCategoryWeights;

interface LabeledAction {
  resumeId: string;
  query?: string;
  action: "shortlist" | "reject";
  ts: string;
  score?: number;
  jobDescriptionId?: string;
}

export interface QueryMetrics {
  query: string;
  searchCount: number;
  avgResultCount: number;
  actions: number;
  shortlist: number;
  reject: number;
  ndcgAtK: number;
  shortlistAtK: number;
  lastSearchAt?: string;
  lastActionAt?: string;
}

export interface WeightAdjustmentSuggestion {
  category: CategoryKey;
  delta: number;
  confidence: number;
  reason: string;
}

export interface DomainExpansionSuggestion {
  keyword: string;
  count: number;
  queries: string[];
}

export interface AnalysisReport {
  generatedAt: string;
  periodDays: number;
  summary: {
    totalEvents: number;
    searchQueries: number;
    zeroResultQueries: number;
    candidateActions: number;
    labeledActions: number;
    scoredActions: number;
  };
  queryMetrics: QueryMetrics[];
  rankingMetrics: {
    k: number;
    ndcgAtK: number;
    shortlistAtK: number;
    scoredCount: number;
    shortlistCount: number;
    rejectCount: number;
    topJobDescriptionId?: string;
  };
  scoreDistribution: ScoreDistributionStatsResult;
  learningPatterns: {
    shortlistPatterns: Array<{
      keywords: string[];
      priority: string;
      count: number;
    }>;
    rejectPatterns: Array<{
      keyword: string;
      negativeSignal: string;
      count: number;
    }>;
  };
  suggestions: {
    weightAdjustments: WeightAdjustmentSuggestion[];
    synonymSuggestions: SynonymSuggestion[];
    domainExpansionSuggestions: DomainExpansionSuggestion[];
  };
}

export interface JobScoringMetrics {
  jobDescriptionId: string;
  periodDays: number;
  k: number;
  rankedCount: number;
  labeledCount: number;
  shortlistCount: number;
  rejectCount: number;
  ndcgAtK: number;
  shortlistAtK: number;
}

export interface WeightValidationMetrics {
  ndcgAtK: number;
  shortlistAtK: number;
}

export interface WeightValidationReport {
  jobDescriptionId: string;
  periodDays: number;
  k: number;
  sampleSize: number;
  current: WeightValidationMetrics;
  projected: WeightValidationMetrics;
  delta: {
    ndcgAtK: number;
    shortlistAtK: number;
  };
}

function toIsoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeQuery(query: string | undefined): string | undefined {
  if (!query) {
    return undefined;
  }
  const normalized = query.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

function parseIsoToTime(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

function tokenizedQuery(query: string): string[] {
  return query
    .split(/[\s,，、;；|/]+/u)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 2);
}

function roundMetric(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(4));
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.max(0, Math.min(100, score));
}

function buildLabelLookup(actions: LabeledAction[]): Map<string, RankingLabel> {
  const lookup = new Map<string, RankingLabel>();
  for (const action of actions) {
    lookup.set(action.resumeId, action.action);
  }
  return lookup;
}

function dedupeLatestActions(actions: CandidateActionEvent[]): LabeledAction[] {
  const byKey = new Map<string, LabeledAction>();

  for (const action of actions) {
    const normalizedQuery = normalizeQuery(action.query);
    const key = `${normalizedQuery ?? ""}::${action.resumeId}`;
    const existing = byKey.get(key);
    if (!existing || parseIsoToTime(action.ts) > parseIsoToTime(existing.ts)) {
      byKey.set(key, {
        resumeId: action.resumeId,
        query: normalizedQuery,
        action: action.action,
        ts: action.ts,
      });
    }
  }

  return Array.from(byKey.values());
}

export function scoreFromBreakdown(
  breakdown: NonNullable<ReturnType<MatchStorage["getMatchesForJob"]>[number]["breakdown"]>,
  current: RuleCategoryWeights,
  proposed: RuleCategoryWeights
): number {
  const categories: CategoryKey[] = [
    "skillMatch",
    "roleMatch",
    "experienceMatch",
    "educationMatch",
    "locationMatch",
    "industryMatch",
    "brandRelevance",
  ];

  let projectedScore = 0;

  for (const category of categories) {
    const currentWeight = current[category];
    const currentValue = category === "brandRelevance"
      ? breakdown.brandRelevance ?? 0
      : category === "roleMatch"
        ? breakdown.roleMatch ?? 0
        : breakdown[category];
    if (currentWeight <= 0) {
      continue;
    }
    const ratio = Math.max(0, Math.min(1, currentValue / currentWeight));
    projectedScore += ratio * proposed[category];
  }

  return clampScore(projectedScore);
}

export class SearchEventAnalyzer {
  private readonly projectRoot: string;
  private readonly eventLogger: SearchEventLogger;
  private readonly skillsService: SkillsKnowledgeService;
  private readonly matchStorage: MatchStorage;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    this.eventLogger = new SearchEventLogger(this.projectRoot);
    this.skillsService = new SkillsKnowledgeService(this.projectRoot);
    this.matchStorage = new MatchStorage(this.projectRoot);
  }

  getMatchesForJob(jobDescriptionId: string) {
    return this.matchStorage.getMatchesForJob(jobDescriptionId);
  }

  private enrichWithScores(actions: LabeledAction[]): LabeledAction[] {
    const resumeIds = Array.from(new Set(actions.map((action) => action.resumeId)));
    if (resumeIds.length === 0) {
      return [];
    }

    const latestMatches = this.matchStorage.getLatestMatchesByResumeIds(resumeIds);
    const matchByResumeId = new Map<string, { score: number; jobDescriptionId: string; matchedAt: string }>();

    for (const match of latestMatches) {
      const existing = matchByResumeId.get(match.resumeId);
      if (!existing) {
        matchByResumeId.set(match.resumeId, {
          score: match.score,
          jobDescriptionId: match.jobDescriptionId,
          matchedAt: match.matchedAt,
        });
        continue;
      }

      const existingTs = parseIsoToTime(existing.matchedAt);
      const candidateTs = parseIsoToTime(match.matchedAt);
      if (candidateTs > existingTs || (candidateTs === existingTs && match.score > existing.score)) {
        matchByResumeId.set(match.resumeId, {
          score: match.score,
          jobDescriptionId: match.jobDescriptionId,
          matchedAt: match.matchedAt,
        });
      }
    }

    return actions.map((action) => {
      const match = matchByResumeId.get(action.resumeId);
      if (!match) {
        return action;
      }
      return {
        ...action,
        score: match.score,
        jobDescriptionId: match.jobDescriptionId,
      };
    });
  }

  private buildDomainExpansionSuggestions(zeroResultQueries: string[], limit = 20): DomainExpansionSuggestion[] {
    const vocabulary = this.skillsService.getSkillVocabulary();
    const synonymTable = this.skillsService.getSynonymTable();
    const frequencies = new Map<string, { count: number; queries: Set<string> }>();

    for (const rawQuery of zeroResultQueries) {
      const query = normalizeQuery(rawQuery);
      if (!query) {
        continue;
      }

      for (const token of tokenizedQuery(query)) {
        if (vocabulary.has(token) || synonymTable.has(token)) {
          continue;
        }
        const existing = frequencies.get(token);
        if (existing) {
          existing.count += 1;
          if (existing.queries.size < 5) {
            existing.queries.add(query);
          }
          continue;
        }
        frequencies.set(token, {
          count: 1,
          queries: new Set([query]),
        });
      }
    }

    return Array.from(frequencies.entries())
      .map(([keyword, entry]) => ({
        keyword,
        count: entry.count,
        queries: Array.from(entry.queries),
      }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.keyword.localeCompare(right.keyword);
      })
      .slice(0, Math.max(1, limit));
  }

  private buildWeightSuggestions(
    distribution: ScoreDistributionStatsResult,
    rankingMetrics: AnalysisReport["rankingMetrics"],
    minimumConfidence = 0.5
  ): WeightAdjustmentSuggestion[] {
    const suggestions: WeightAdjustmentSuggestion[] = [];

    if (rankingMetrics.shortlistCount === 0 || rankingMetrics.rejectCount === 0) {
      return suggestions;
    }

    if (distribution.separation.meanGap < 8 || rankingMetrics.ndcgAtK < 0.72) {
      suggestions.push({
        category: "skillMatch",
        delta: 2,
        confidence: 0.82,
        reason: "Shortlisted and rejected scores are too close; increase keyword discrimination.",
      });
    }

    if (distribution.separation.overlapRate > 0.3 || rankingMetrics.shortlistAtK < 0.55) {
      suggestions.push({
        category: "industryMatch",
        delta: 2,
        confidence: 0.77,
        reason: "Top-k shortlist precision is weak; strengthen domain signal weighting.",
      });
    }

    if (distribution.reject.mean > 65) {
      suggestions.push({
        category: "experienceMatch",
        delta: 1,
        confidence: 0.61,
        reason: "Rejected candidates still score high; increase experience penalty impact.",
      });
    }

    if (distribution.separation.shortlistAboveRejectRate < 0.65) {
      suggestions.push({
        category: "brandRelevance",
        delta: 1,
        confidence: 0.56,
        reason: "Brand/context signal is under-separating labels in current data.",
      });
    }

    const merged = new Map<CategoryKey, WeightAdjustmentSuggestion>();
    for (const suggestion of suggestions) {
      if (suggestion.confidence < minimumConfidence) {
        continue;
      }
      const existing = merged.get(suggestion.category);
      if (!existing) {
        merged.set(suggestion.category, { ...suggestion, delta: Math.max(-3, Math.min(3, suggestion.delta)) });
        continue;
      }

      const combinedDelta = Math.max(-3, Math.min(3, existing.delta + suggestion.delta));
      merged.set(suggestion.category, {
        category: suggestion.category,
        delta: combinedDelta,
        confidence: Math.max(existing.confidence, suggestion.confidence),
        reason: `${existing.reason} ${suggestion.reason}`.trim(),
      });
    }

    return Array.from(merged.values()).sort((left, right) => right.confidence - left.confidence);
  }

  analyze(options?: { periodDays?: number; k?: number }): AnalysisReport {
    const periodDays = Math.max(1, options?.periodDays ?? 14);
    const k = Math.max(1, options?.k ?? 10);
    const since = toIsoDaysAgo(periodDays);

    const events = this.eventLogger.getEvents({ since });
    const searchEvents = events.filter((event): event is SearchQueryEvent => event.type === "search_query");
    const zeroResultQueries = events
      .filter((event): event is SearchZeroResultsEvent => event.type === "search_zero_results")
      .map((event) => event.query);
    const candidateActionsRaw = events
      .filter((event): event is CandidateActionEvent => event.type === "candidate_action");
    const candidateActions = dedupeLatestActions(candidateActionsRaw);
    const labeledActions = this.enrichWithScores(candidateActions);

    const querySearchMeta = new Map<string, {
      count: number;
      totalResultCount: number;
      lastSearchAt: string;
    }>();

    for (const event of searchEvents) {
      const normalizedQuery = normalizeQuery(event.query);
      if (!normalizedQuery) {
        continue;
      }
      const existing = querySearchMeta.get(normalizedQuery);
      if (existing) {
        existing.count += 1;
        existing.totalResultCount += event.resultCount;
        if (parseIsoToTime(event.ts) > parseIsoToTime(existing.lastSearchAt)) {
          existing.lastSearchAt = event.ts;
        }
        continue;
      }
      querySearchMeta.set(normalizedQuery, {
        count: 1,
        totalResultCount: event.resultCount,
        lastSearchAt: event.ts,
      });
    }

    const actionsByQuery = new Map<string, LabeledAction[]>();
    for (const action of labeledActions) {
      const query = normalizeQuery(action.query);
      if (!query) {
        continue;
      }
      const items = actionsByQuery.get(query);
      if (items) {
        items.push(action);
      } else {
        actionsByQuery.set(query, [action]);
      }
    }

    const queryMetrics: QueryMetrics[] = Array.from(new Set([
      ...Array.from(querySearchMeta.keys()),
      ...Array.from(actionsByQuery.keys()),
    ]))
      .map((query) => {
        const meta = querySearchMeta.get(query);
        const queryActions = actionsByQuery.get(query) ?? [];
        const shortlistCount = queryActions.filter((action) => action.action === "shortlist").length;
        const rejectCount = queryActions.filter((action) => action.action === "reject").length;
        const scoredActions = queryActions.filter((action) => typeof action.score === "number");
        const ranked = [...scoredActions]
          .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
          .map((action) => action.resumeId);
        const labels = buildLabelLookup(queryActions);
        const lastActionAt = queryActions
          .map((action) => action.ts)
          .sort((left, right) => parseIsoToTime(right) - parseIsoToTime(left))[0];

        return {
          query,
          searchCount: meta?.count ?? 0,
          avgResultCount: meta?.count ? roundMetric(meta.totalResultCount / meta.count) : 0,
          actions: queryActions.length,
          shortlist: shortlistCount,
          reject: rejectCount,
          ndcgAtK: ranked.length > 0 ? ndcgAtK(ranked, labels, k) : 0,
          shortlistAtK: ranked.length > 0 ? shortlistAtK(ranked, labels, k) : 0,
          lastSearchAt: meta?.lastSearchAt,
          lastActionAt,
        };
      })
      .sort((left, right) => {
        if (right.actions !== left.actions) {
          return right.actions - left.actions;
        }
        return right.searchCount - left.searchCount;
      });

    const latestByResume = new Map<string, LabeledAction>();
    for (const action of labeledActions) {
      const existing = latestByResume.get(action.resumeId);
      if (!existing || parseIsoToTime(action.ts) > parseIsoToTime(existing.ts)) {
        latestByResume.set(action.resumeId, action);
      }
    }
    const dedupedForRanking = Array.from(latestByResume.values());
    const rankedGlobal = dedupedForRanking
      .filter((action) => typeof action.score === "number")
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
      .map((action) => action.resumeId);
    const labelsGlobal = buildLabelLookup(dedupedForRanking);
    const shortlistCount = dedupedForRanking.filter((action) => action.action === "shortlist").length;
    const rejectCount = dedupedForRanking.filter((action) => action.action === "reject").length;
    const topJobDescriptionId = (() => {
      const counts = new Map<string, number>();
      for (const action of dedupedForRanking) {
        if (!action.jobDescriptionId) {
          continue;
        }
        counts.set(action.jobDescriptionId, (counts.get(action.jobDescriptionId) ?? 0) + 1);
      }
      return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0];
    })();

    const scoreDistribution = scoreDistributionStats(
      dedupedForRanking
        .filter((action): action is LabeledAction & { score: number } => typeof action.score === "number")
        .map((action) => ({
          score: action.score,
          label: action.action,
        }))
    );

    const actionablePatterns = this.skillsService.extractActionablePatterns();
    const shortlistPatterns = new Map<string, { keywords: string[]; priority: string; count: number }>();
    const rejectPatterns = new Map<string, { keyword: string; negativeSignal: string; count: number }>();

    for (const pattern of actionablePatterns) {
      if (pattern.type === "shortlist_pattern") {
        const key = `${pattern.keywords.join("+")}=>${pattern.priority}`;
        const existing = shortlistPatterns.get(key);
        if (existing) {
          existing.count += pattern.count;
        } else {
          shortlistPatterns.set(key, {
            keywords: pattern.keywords,
            priority: pattern.priority,
            count: pattern.count,
          });
        }
      }

      if (pattern.type === "reject_pattern") {
        const key = `${pattern.keyword}=>${pattern.negativeSignal}`;
        const existing = rejectPatterns.get(key);
        if (existing) {
          existing.count += pattern.count;
        } else {
          rejectPatterns.set(key, {
            keyword: pattern.keyword,
            negativeSignal: pattern.negativeSignal,
            count: pattern.count,
          });
        }
      }
    }

    const rankingMetrics: AnalysisReport["rankingMetrics"] = {
      k,
      ndcgAtK: rankedGlobal.length > 0 ? ndcgAtK(rankedGlobal, labelsGlobal, k) : 0,
      shortlistAtK: rankedGlobal.length > 0 ? shortlistAtK(rankedGlobal, labelsGlobal, k) : 0,
      scoredCount: rankedGlobal.length,
      shortlistCount,
      rejectCount,
      topJobDescriptionId,
    };

    const synonymSuggestions = this.skillsService.generateSynonymSuggestions(zeroResultQueries);
    const domainExpansionSuggestions = this.buildDomainExpansionSuggestions(zeroResultQueries);
    const weightAdjustments = this.buildWeightSuggestions(scoreDistribution, rankingMetrics);

    return {
      generatedAt: new Date().toISOString(),
      periodDays,
      summary: {
        totalEvents: events.length,
        searchQueries: searchEvents.length,
        zeroResultQueries: zeroResultQueries.length,
        candidateActions: candidateActionsRaw.length,
        labeledActions: labeledActions.length,
        scoredActions: rankedGlobal.length,
      },
      queryMetrics,
      rankingMetrics,
      scoreDistribution,
      learningPatterns: {
        shortlistPatterns: Array.from(shortlistPatterns.values()).sort((left, right) => right.count - left.count),
        rejectPatterns: Array.from(rejectPatterns.values()).sort((left, right) => right.count - left.count),
      },
      suggestions: {
        weightAdjustments,
        synonymSuggestions,
        domainExpansionSuggestions,
      },
    };
  }

  computeJobMetrics(params: {
    jobDescriptionId: string;
    periodDays?: number;
    k?: number;
  }): JobScoringMetrics {
    const periodDays = Math.max(1, params.periodDays ?? 14);
    const k = Math.max(1, params.k ?? 10);
    const sinceIso = toIsoDaysAgo(periodDays);

    const matches = this.matchStorage
      .getMatchesForJob(params.jobDescriptionId)
      .filter((match) => parseIsoToTime(match.matchedAt) >= parseIsoToTime(sinceIso));
    const ranked = matches.map((match) => match.resumeId);

    const actionEvents = this.eventLogger.getEvents({
      since: sinceIso,
      types: ["candidate_action"],
    });
    const latestActionByResume = new Map<string, CandidateActionEvent>();
    for (const event of actionEvents) {
      if (event.type !== "candidate_action") {
        continue;
      }
      const existing = latestActionByResume.get(event.resumeId);
      if (!existing || parseIsoToTime(event.ts) > parseIsoToTime(existing.ts)) {
        latestActionByResume.set(event.resumeId, event);
      }
    }

    const labels = new Map<string, RankingLabel>();
    for (const [resumeId, action] of latestActionByResume.entries()) {
      labels.set(resumeId, action.action);
    }

    const labeledCount = ranked.filter((resumeId) => labels.has(resumeId)).length;
    const shortlistCount = ranked.filter((resumeId) => labels.get(resumeId) === "shortlist").length;
    const rejectCount = ranked.filter((resumeId) => labels.get(resumeId) === "reject").length;

    return {
      jobDescriptionId: params.jobDescriptionId,
      periodDays,
      k,
      rankedCount: ranked.length,
      labeledCount,
      shortlistCount,
      rejectCount,
      ndcgAtK: ndcgAtK(ranked, labels, k),
      shortlistAtK: shortlistAtK(ranked, labels, k),
    };
  }

  validateCategoryWeights(params: {
    jobDescriptionId: string;
    proposedCategoryWeights: RuleCategoryWeights;
    periodDays?: number;
    k?: number;
  }): WeightValidationReport {
    const periodDays = Math.max(1, params.periodDays ?? 14);
    const k = Math.max(1, params.k ?? 10);
    const sinceIso = toIsoDaysAgo(periodDays);
    const currentWeights = loadRuleWeightsConfig(this.projectRoot).categoryWeights;

    const matches = this.matchStorage
      .getMatchesForJob(params.jobDescriptionId)
      .filter((match) => parseIsoToTime(match.matchedAt) >= parseIsoToTime(sinceIso))
      .filter((match) => Boolean(match.breakdown));

    const actionEvents = this.eventLogger.getEvents({
      since: sinceIso,
      types: ["candidate_action"],
    });
    const latestActionByResume = new Map<string, CandidateActionEvent>();
    for (const event of actionEvents) {
      if (event.type !== "candidate_action") {
        continue;
      }
      const existing = latestActionByResume.get(event.resumeId);
      if (!existing || parseIsoToTime(event.ts) > parseIsoToTime(existing.ts)) {
        latestActionByResume.set(event.resumeId, event);
      }
    }

    const labels = new Map<string, RankingLabel>();
    for (const [resumeId, action] of latestActionByResume.entries()) {
      labels.set(resumeId, action.action);
    }

    const scoredCurrent = matches
      .map((match) => ({
        resumeId: match.resumeId,
        score: match.score,
        hasLabel: labels.has(match.resumeId),
      }))
      .filter((item) => item.hasLabel);
    const scoredProjected = matches
      .filter((match): match is typeof match & { breakdown: NonNullable<typeof match.breakdown> } => Boolean(match.breakdown))
      .map((match) => ({
        resumeId: match.resumeId,
        score: scoreFromBreakdown(match.breakdown, currentWeights, params.proposedCategoryWeights),
        hasLabel: labels.has(match.resumeId),
      }))
      .filter((item) => item.hasLabel);

    const currentRanked = [...scoredCurrent]
      .sort((left, right) => right.score - left.score)
      .map((item) => item.resumeId);
    const projectedRanked = [...scoredProjected]
      .sort((left, right) => right.score - left.score)
      .map((item) => item.resumeId);

    const currentMetrics: WeightValidationMetrics = {
      ndcgAtK: ndcgAtK(currentRanked, labels, k),
      shortlistAtK: shortlistAtK(currentRanked, labels, k),
    };
    const projectedMetrics: WeightValidationMetrics = {
      ndcgAtK: ndcgAtK(projectedRanked, labels, k),
      shortlistAtK: shortlistAtK(projectedRanked, labels, k),
    };

    return {
      jobDescriptionId: params.jobDescriptionId,
      periodDays,
      k,
      sampleSize: currentRanked.length,
      current: currentMetrics,
      projected: projectedMetrics,
      delta: {
        ndcgAtK: roundMetric(projectedMetrics.ndcgAtK - currentMetrics.ndcgAtK),
        shortlistAtK: roundMetric(projectedMetrics.shortlistAtK - currentMetrics.shortlistAtK),
      },
    };
  }
}
