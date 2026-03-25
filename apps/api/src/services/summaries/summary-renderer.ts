import type { SummaryCountEntry, SummaryReport } from "@trends/shared";

function renderCountList(entries: SummaryCountEntry[]): string[] {
  if (entries.length === 0) {
    return ["- none"];
  }

  return entries.map((entry) => `- ${entry.label}: ${entry.count}`);
}

export class SummaryRenderer {
  renderMarkdown(report: SummaryReport): string {
    return [
      `# Daily Ops Summary`,
      ``,
      `- Workspace: ${report.workspaceSlug}`,
      `- Generated: ${report.generatedAt}`,
      `- Window: ${report.window.startAt} -> ${report.window.endAt}`,
      `- Timezone: ${report.window.timezone}`,
      ``,
      `## Totals`,
      `- New resumes: ${report.totals.newResumes}`,
      `- Candidate status updates: ${report.totals.candidateStatusUpdates}`,
      `- Shortlist actions: ${report.totals.shortlistActions}`,
      `- Reject actions: ${report.totals.rejectActions}`,
      `- Contact actions: ${report.totals.contactActions}`,
      `- Collection tasks completed: ${report.totals.collectionTasksCompleted}`,
      `- Collection tasks failed: ${report.totals.collectionTasksFailed}`,
      ``,
      `## Resume Sources`,
      ...renderCountList(report.breakdowns.resumesBySource),
      ``,
      `## Candidate Status Updates`,
      ...renderCountList(report.breakdowns.candidateStatusByValue),
      ``,
      `## Candidate Actions`,
      ...renderCountList(report.breakdowns.actionsByType),
      ``,
      `## Collection Tasks`,
      ...renderCountList(report.breakdowns.collectionTasksByStatus),
      ``,
      `## Notes`,
      ...report.notes.map((note) => `- ${note}`),
      ``,
    ].join("\n");
  }
}
