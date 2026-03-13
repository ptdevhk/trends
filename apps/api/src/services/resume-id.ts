import { resolveResumeId as resolveSharedResumeId } from "@trends/shared";
import type { ResumeItem } from "../types/resume.js";

export function resolveResumeId(resume: ResumeItem, index: number): string {
  return resolveSharedResumeId(resume, index);
}
