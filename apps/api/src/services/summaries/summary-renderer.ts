import type { SummaryCountEntry, SummaryNewCandidate, SummaryReport } from "@trends/shared";

import { getSummaryTitle } from "./summary-shared.js";

function renderCountList(entries: SummaryCountEntry[]): string[] {
  if (entries.length === 0) {
    return ["- none"];
  }

  return entries.map((entry) => `- ${entry.label}: ${entry.count}`);
}

function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function renderCandidateList(candidates: SummaryNewCandidate[]): string[] {
  if (candidates.length === 0) {
    return ["- No new candidates in this period"];
  }
  const lines: string[] = [];
  for (const c of candidates) {
    const parts = [c.name || c.resumeId, c.source];
    if (c.location) parts.push(c.location);
    if (c.experience) parts.push(`${c.experience}yr`);
    if (typeof c.score === "number") parts.push(`score:${c.score}`);
    lines.push(`- ${parts.join(" | ")}`);
  }
  return lines;
}

export class SummaryRenderer {
  renderMarkdown(report: SummaryReport): string {
    const sharedIngest = report.scopes?.sharedIngest;
    const workspaceActivity = report.scopes?.workspaceActivity;
    const comparison = report.comparison;

    return [
      `# ${getSummaryTitle(report.period)}`,
      ``,
      `- Workspace: ${report.workspaceSlug}`,
      `- Period: ${report.period}`,
      `- Generated: ${report.generatedAt}`,
      `- Window: ${report.window.startAt} -> ${report.window.endAt}`,
      `- Timezone: ${report.window.timezone}`,
      ``,
      `## Shared Ingest Totals`,
      `- New resumes: ${sharedIngest?.totals.newResumes ?? report.totals.newResumes}`,
      `- Collection tasks completed: ${sharedIngest?.totals.collectionTasksCompleted ?? report.totals.collectionTasksCompleted}`,
      `- Collection tasks failed: ${sharedIngest?.totals.collectionTasksFailed ?? report.totals.collectionTasksFailed}`,
      ``,
      `## Resume Sources`,
      ...renderCountList(sharedIngest?.breakdowns.resumesBySource ?? report.breakdowns.resumesBySource),
      ``,
      `## Collection Tasks`,
      ...renderCountList(sharedIngest?.breakdowns.collectionTasksByStatus ?? report.breakdowns.collectionTasksByStatus),
      ``,
      `## Workspace Activity`,
      `- Candidate status updates: ${workspaceActivity?.totals.candidateStatusUpdates ?? report.totals.candidateStatusUpdates}`,
      `- Shortlist actions: ${workspaceActivity?.totals.shortlistActions ?? report.totals.shortlistActions}`,
      `- Reject actions: ${workspaceActivity?.totals.rejectActions ?? report.totals.rejectActions}`,
      `- Contact actions: ${workspaceActivity?.totals.contactActions ?? report.totals.contactActions}`,
      ``,
      `## Candidate Status Updates`,
      ...renderCountList(workspaceActivity?.breakdowns.candidateStatusByValue ?? report.breakdowns.candidateStatusByValue),
      ``,
      `## Candidate Actions`,
      ...renderCountList(workspaceActivity?.breakdowns.actionsByType ?? report.breakdowns.actionsByType),
      ``,
      ...(comparison
        ? [
          `## Previous Period Comparison`,
          `- Previous Window: ${comparison.previousWindow.startAt} -> ${comparison.previousWindow.endAt}`,
          `- Shared ingest new resumes delta: ${formatDelta(comparison.totalsDelta.sharedIngest.newResumes)}`,
          `- Shared ingest completed tasks delta: ${formatDelta(comparison.totalsDelta.sharedIngest.collectionTasksCompleted)}`,
          `- Shared ingest failed tasks delta: ${formatDelta(comparison.totalsDelta.sharedIngest.collectionTasksFailed)}`,
          `- Workspace activity candidate status delta: ${formatDelta(comparison.totalsDelta.workspaceActivity.candidateStatusUpdates)}`,
          `- Workspace activity shortlist delta: ${formatDelta(comparison.totalsDelta.workspaceActivity.shortlistActions)}`,
          `- Workspace activity reject delta: ${formatDelta(comparison.totalsDelta.workspaceActivity.rejectActions)}`,
          `- Workspace activity contact delta: ${formatDelta(comparison.totalsDelta.workspaceActivity.contactActions)}`,
          ``,
        ]
        : []),
      ...(report.newCandidates
        ? [
          `## New Candidates (${report.newCandidates.length})`,
          ...renderCandidateList(report.newCandidates),
          ``,
        ]
        : []),
      `## Notes`,
      ...report.notes.map((note) => `- ${note}`),
      ``,
    ].join("\n");
  }
}
