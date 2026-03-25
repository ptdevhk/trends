---
subject: "Daily Ops Summary {{workspaceSlug}}"
---

# Daily Ops Summary

- Workspace: {{workspaceSlug}}
- Generated: {{generatedAt}}
- Window Start: {{window.startAt}}
- Window End: {{window.endAt}}
- Timezone: {{window.timezone}}

{{#if scopes.sharedIngest}}
## Shared Ingest Totals
- New resumes: {{scopes.sharedIngest.totals.newResumes}}
- Collection tasks completed: {{scopes.sharedIngest.totals.collectionTasksCompleted}}
- Collection tasks failed: {{scopes.sharedIngest.totals.collectionTasksFailed}}
{{/if}}

{{#if scopes.sharedIngest.breakdowns.resumesBySource}}
## Resume Sources
{{#each scopes.sharedIngest.breakdowns.resumesBySource}}
- {{this.label}}: {{this.count}}
{{/each}}
{{/if}}

{{#if scopes.sharedIngest.breakdowns.collectionTasksByStatus}}
## Collection Tasks
{{#each scopes.sharedIngest.breakdowns.collectionTasksByStatus}}
- {{this.label}}: {{this.count}}
{{/each}}
{{/if}}

{{#if scopes.workspaceActivity}}
## Workspace Activity
- Candidate status updates: {{scopes.workspaceActivity.totals.candidateStatusUpdates}}
- Shortlist actions: {{scopes.workspaceActivity.totals.shortlistActions}}
- Reject actions: {{scopes.workspaceActivity.totals.rejectActions}}
- Contact actions: {{scopes.workspaceActivity.totals.contactActions}}
{{/if}}

{{#if scopes.workspaceActivity.breakdowns.candidateStatusByValue}}
## Candidate Status Updates
{{#each scopes.workspaceActivity.breakdowns.candidateStatusByValue}}
- {{this.label}}: {{this.count}}
{{/each}}
{{/if}}

{{#if scopes.workspaceActivity.breakdowns.actionsByType}}
## Candidate Actions
{{#each scopes.workspaceActivity.breakdowns.actionsByType}}
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
