/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai_summary_cache from "../ai_summary_cache.js";
import type * as ai_tagging_results from "../ai_tagging_results.js";
import type * as analysis_tasks from "../analysis_tasks.js";
import type * as analyze from "../analyze.js";
import type * as audit from "../audit.js";
import type * as bias_audit from "../bias_audit.js";
import type * as candidate_blocks from "../candidate_blocks.js";
import type * as candidate_status from "../candidate_status.js";
import type * as crons from "../crons.js";
import type * as embeddings from "../embeddings.js";
import type * as ingest_agent from "../ingest_agent.js";
import type * as job_descriptions from "../job_descriptions.js";
import type * as lib_age from "../lib/age.js";
import type * as lib_ai_model from "../lib/ai_model.js";
import type * as lib_analysis_config from "../lib/analysis_config.js";
import type * as lib_analysis_normalization from "../lib/analysis_normalization.js";
import type * as lib_analysis_prompts from "../lib/analysis_prompts.js";
import type * as lib_analysis_task_helpers from "../lib/analysis_task_helpers.js";
import type * as lib_bias_metrics from "../lib/bias_metrics.js";
import type * as lib_parallelism from "../lib/parallelism.js";
import type * as lib_resume_identity from "../lib/resume_identity.js";
import type * as lib_resume_task_helpers from "../lib/resume_task_helpers.js";
import type * as lib_resumes_backup from "../lib/resumes_backup.js";
import type * as lib_resumes_diagnostics from "../lib/resumes_diagnostics.js";
import type * as lib_resumes_list_projections from "../lib/resumes_list_projections.js";
import type * as lib_resumes_pagination from "../lib/resumes_pagination.js";
import type * as lib_resumes_tag_expansion from "../lib/resumes_tag_expansion.js";
import type * as llm_cost from "../llm_cost.js";
import type * as migrations from "../migrations.js";
import type * as resume_helpers from "../resume_helpers.js";
import type * as resume_tasks from "../resume_tasks.js";
import type * as resumes from "../resumes.js";
import type * as resumes_diagnostics from "../resumes_diagnostics.js";
import type * as resumes_search from "../resumes_search.js";
import type * as search_alerts from "../search_alerts.js";
import type * as search_profiles from "../search_profiles.js";
import type * as search_text from "../search_text.js";
import type * as seed from "../seed.js";
import type * as sessions from "../sessions.js";
import type * as sync_events from "../sync_events.js";
import type * as taxonomy_clusters from "../taxonomy_clusters.js";
import type * as validators from "../validators.js";
import type * as workspace_config from "../workspace_config.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai_summary_cache: typeof ai_summary_cache;
  ai_tagging_results: typeof ai_tagging_results;
  analysis_tasks: typeof analysis_tasks;
  analyze: typeof analyze;
  audit: typeof audit;
  bias_audit: typeof bias_audit;
  candidate_blocks: typeof candidate_blocks;
  candidate_status: typeof candidate_status;
  crons: typeof crons;
  embeddings: typeof embeddings;
  ingest_agent: typeof ingest_agent;
  job_descriptions: typeof job_descriptions;
  "lib/age": typeof lib_age;
  "lib/ai_model": typeof lib_ai_model;
  "lib/analysis_config": typeof lib_analysis_config;
  "lib/analysis_normalization": typeof lib_analysis_normalization;
  "lib/analysis_prompts": typeof lib_analysis_prompts;
  "lib/analysis_task_helpers": typeof lib_analysis_task_helpers;
  "lib/bias_metrics": typeof lib_bias_metrics;
  "lib/parallelism": typeof lib_parallelism;
  "lib/resume_identity": typeof lib_resume_identity;
  "lib/resume_task_helpers": typeof lib_resume_task_helpers;
  "lib/resumes_backup": typeof lib_resumes_backup;
  "lib/resumes_diagnostics": typeof lib_resumes_diagnostics;
  "lib/resumes_list_projections": typeof lib_resumes_list_projections;
  "lib/resumes_pagination": typeof lib_resumes_pagination;
  "lib/resumes_tag_expansion": typeof lib_resumes_tag_expansion;
  llm_cost: typeof llm_cost;
  migrations: typeof migrations;
  resume_helpers: typeof resume_helpers;
  resume_tasks: typeof resume_tasks;
  resumes: typeof resumes;
  resumes_diagnostics: typeof resumes_diagnostics;
  resumes_search: typeof resumes_search;
  search_alerts: typeof search_alerts;
  search_profiles: typeof search_profiles;
  search_text: typeof search_text;
  seed: typeof seed;
  sessions: typeof sessions;
  sync_events: typeof sync_events;
  taxonomy_clusters: typeof taxonomy_clusters;
  validators: typeof validators;
  workspace_config: typeof workspace_config;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
