/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analysis_tasks from "../analysis_tasks.js";
import type * as analyze from "../analyze.js";
import type * as ingest_agent from "../ingest_agent.js";
import type * as job_descriptions from "../job_descriptions.js";
import type * as lib_parallelism from "../lib/parallelism.js";
import type * as lib_resume_identity from "../lib/resume_identity.js";
import type * as migrations from "../migrations.js";
import type * as resume_tasks from "../resume_tasks.js";
import type * as resumes from "../resumes.js";
import type * as search_text from "../search_text.js";
import type * as seed from "../seed.js";
import type * as sessions from "../sessions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analysis_tasks: typeof analysis_tasks;
  analyze: typeof analyze;
  ingest_agent: typeof ingest_agent;
  job_descriptions: typeof job_descriptions;
  "lib/parallelism": typeof lib_parallelism;
  "lib/resume_identity": typeof lib_resume_identity;
  migrations: typeof migrations;
  resume_tasks: typeof resume_tasks;
  resumes: typeof resumes;
  search_text: typeof search_text;
  seed: typeof seed;
  sessions: typeof sessions;
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
