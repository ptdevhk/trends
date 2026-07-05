import fs from "node:fs";
import path from "node:path";

import { z } from "@hono/zod-openapi";
import { isRecord } from "@trends/shared";

import { config } from "./config.js";

export const ProfileRunStatusSchema = z.object({
  profileId: z.string(),
  taskId: z.string(),
  taskStatus: z.enum(["pending", "processing", "completed", "failed", "cancelled", "unknown"]),
  startedAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
  resultCount: z.number().int().optional(),
  extracted: z.number().int().optional(),
  submitted: z.number().int().optional(),
  error: z.string().optional(),
});

export type ProfileRunStatus = z.infer<typeof ProfileRunStatusSchema>;

function getRunStatusFilePath(projectRoot: string = config.projectRoot): string {
  return path.join(projectRoot, "output", "search-profile-runs.json");
}

export function readRunStatusStore(projectRoot: string = config.projectRoot): Record<string, ProfileRunStatus> {
  try {
    const content = fs.readFileSync(getRunStatusFilePath(projectRoot), "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }

    const store: Record<string, ProfileRunStatus> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const validated = ProfileRunStatusSchema.safeParse(value);
      if (!validated.success) {
        continue;
      }
      store[key] = validated.data;
    }
    return store;
  } catch (error) {
    console.error("search-profile-run-status read failed:", error);
    return {};
  }
}

function writeRunStatusStore(
  store: Record<string, ProfileRunStatus>,
  projectRoot: string = config.projectRoot,
): void {
  const filePath = getRunStatusFilePath(projectRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
}

export function toScopedProfileKey(workspaceSlug: string, profileId: string): string {
  return `${workspaceSlug}:${profileId}`;
}

export function upsertRunStatus(
  workspaceSlug: string,
  status: ProfileRunStatus,
  projectRoot: string = config.projectRoot,
): void {
  const store = readRunStatusStore(projectRoot);
  store[toScopedProfileKey(workspaceSlug, status.profileId)] = status;
  writeRunStatusStore(store, projectRoot);
}

export function recordSearchProfileSubmitRunStatus(args: {
  workspaceSlug: string;
  profileId: string;
  submitted: number;
}): ProfileRunStatus {
  const now = new Date().toISOString();
  const status: ProfileRunStatus = {
    profileId: args.profileId,
    taskId: `browser-submit:${args.profileId}:${Date.now()}`,
    taskStatus: "completed",
    startedAt: now,
    updatedAt: now,
    completedAt: now,
    resultCount: args.submitted,
    extracted: args.submitted,
    submitted: args.submitted,
  };
  upsertRunStatus(args.workspaceSlug, status);
  return status;
}
