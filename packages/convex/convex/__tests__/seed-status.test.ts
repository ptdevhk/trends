import { describe, expect, it } from "vitest";

import { status } from "../seed";

type StatusResult = {
  jobDescriptions: number;
  resumes: number;
  collectionTasks: number;
  searchProfiles: number;
  screeningSessions: number;
  searchHistory: number;
  workspaceConfig: number;
  isEmpty: boolean;
};

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

type StatusTable =
  | "job_descriptions"
  | "resumes"
  | "collection_tasks"
  | "search_profiles"
  | "screening_sessions"
  | "search_history"
  | "workspace_config";

type StatusRecord = Record<string, unknown>;

const statusHandler = (status as unknown as ConvexHandler<
  Record<string, never>,
  StatusResult
>)._handler;

function createStatusCtx(
  tables: Partial<Record<StatusTable, StatusRecord[]>> = {},
) {
  const records: Record<StatusTable, StatusRecord[]> = {
    job_descriptions: [],
    resumes: [],
    collection_tasks: [],
    search_profiles: [],
    screening_sessions: [],
    search_history: [],
    workspace_config: [],
    ...tables,
  };
  const queryCalls: StatusTable[] = [];
  const collectCalls: StatusTable[] = [];

  const ctx = {
    db: {
      query(tableName: StatusTable) {
        queryCalls.push(tableName);
        return {
          async first() {
            return records[tableName][0] ?? null;
          },
          async collect() {
            collectCalls.push(tableName);
            throw new Error(`collect() should not be called for ${tableName}`);
          },
        };
      },
    },
  };

  return { ctx, queryCalls, collectCalls };
}

describe("seed:status", () => {
  it("uses constant-size probes and reports presence as 0/1", async () => {
    const { ctx, queryCalls, collectCalls } = createStatusCtx({
      job_descriptions: [{ _id: "job_descriptions-1" }],
      resumes: [{ _id: "resumes-1" }],
      search_profiles: [{ _id: "search_profiles-1" }],
    });

    await expect(statusHandler(ctx as never, {})).resolves.toEqual({
      jobDescriptions: 1,
      resumes: 1,
      collectionTasks: 0,
      searchProfiles: 1,
      screeningSessions: 0,
      searchHistory: 0,
      workspaceConfig: 0,
      isEmpty: false,
    });

    expect(queryCalls).toEqual([
      "job_descriptions",
      "resumes",
      "collection_tasks",
      "search_profiles",
      "screening_sessions",
      "search_history",
      "workspace_config",
    ]);
    expect(collectCalls).toEqual([]);
  });

  it("reports an empty database without collecting full tables", async () => {
    const { ctx } = createStatusCtx();

    await expect(statusHandler(ctx as never, {})).resolves.toEqual({
      jobDescriptions: 0,
      resumes: 0,
      collectionTasks: 0,
      searchProfiles: 0,
      screeningSessions: 0,
      searchHistory: 0,
      workspaceConfig: 0,
      isEmpty: true,
    });
  });
});
