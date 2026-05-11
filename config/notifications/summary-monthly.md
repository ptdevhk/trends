---
subject: "{{summaryTitle}} {{workspaceSlug}}"
---

# {{summaryTitle}}

- Workspace: {{workspaceSlug}}
- Period: {{period}}
- Generated: {{generatedAt}}
- Window: {{window.startAt}} → {{window.endAt}}
- Timezone: {{window.timezone}}

{{#if scopes.sharedIngest}}
## Ingest Summary
- New resumes: {{scopes.sharedIngest.totals.newResumes}}
{{/if}}

{{#if newCandidates}}
## New Candidates ({{newCandidates.length}})
{{#each newCandidates}}
- **{{this.name}}** | {{this.source}}{{#if this.location}} | {{this.location}}{{/if}}{{#if this.experience}} | {{this.experience}}yr{{/if}}{{#if this.education}} | {{this.education}}{{/if}}{{#if this.score}} | score: {{this.score}}{{/if}}
{{/each}}
{{/if}}

{{#if scopes.workspaceActivity}}
## Workspace Activity
- Status updates: {{scopes.workspaceActivity.totals.candidateStatusUpdates}}
- Shortlisted: {{scopes.workspaceActivity.totals.shortlistActions}}
- Rejected: {{scopes.workspaceActivity.totals.rejectActions}}
- Contacted: {{scopes.workspaceActivity.totals.contactActions}}
{{/if}}

{{#if comparison}}
## Previous Period Comparison
- New resumes delta: {{comparison.totalsDelta.sharedIngest.newResumes}}
{{/if}}

{{#if notes}}
## Notes
{{#each notes}}
- {{this}}
{{/each}}
{{/if}}

_Generated at {{timestamp}}_
