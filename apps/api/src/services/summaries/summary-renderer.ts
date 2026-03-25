import type { SummaryCountEntry, SummaryReport } from "@trends/shared";

function renderCountList(entries: SummaryCountEntry[]): string[] {
  if (entries.length === 0) {
    return ["- none"];
  }

  return entries.map((entry) => `- ${entry.label}: ${entry.count}`);
}

export class SummaryRenderer {
  renderMarkdown(report: SummaryReport): string {
    const sharedIngest = report.scopes?.sharedIngest;
    const workspaceActivity = report.scopes?.workspaceActivity;

    return [
      `# Daily Ops Summary`,
      ``,
      `- Workspace: ${report.workspaceSlug}`,
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
      `## Notes`,
      ...report.notes.map((note) => `- ${note}`),
      ``,
    ].join("\n");
  }
}
