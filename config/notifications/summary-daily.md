---
subject: "Daily Ops Summary {{workspaceSlug}}"
---

# Daily Ops Summary

- Workspace: {{workspaceSlug}}
- Generated: {{generatedAt}}
- Window Start: {{window.startAt}}
- Window End: {{window.endAt}}
- Timezone: {{window.timezone}}

## Totals
- New resumes: {{totals.newResumes}}
- Candidate status updates: {{totals.candidateStatusUpdates}}
- Shortlist actions: {{totals.shortlistActions}}
- Reject actions: {{totals.rejectActions}}
- Contact actions: {{totals.contactActions}}
- Collection tasks completed: {{totals.collectionTasksCompleted}}
- Collection tasks failed: {{totals.collectionTasksFailed}}

{{#if breakdowns.resumesBySource}}
## Resume Sources
{{#each breakdowns.resumesBySource}}
- {{this.label}}: {{this.count}}
{{/each}}
{{/if}}

{{#if breakdowns.candidateStatusByValue}}
## Candidate Status Updates
{{#each breakdowns.candidateStatusByValue}}
- {{this.label}}: {{this.count}}
{{/each}}
{{/if}}

{{#if breakdowns.actionsByType}}
## Candidate Actions
{{#each breakdowns.actionsByType}}
- {{this.label}}: {{this.count}}
{{/each}}
{{/if}}

{{#if breakdowns.collectionTasksByStatus}}
## Collection Tasks
{{#each breakdowns.collectionTasksByStatus}}
- {{this.label}}: {{this.count}}
{{/each}}
{{/if}}

{{#if notes}}
## Notes
{{#each notes}}
- {{this}}
{{/each}}
{{/if}}

_Generated at {{timestamp}}_
