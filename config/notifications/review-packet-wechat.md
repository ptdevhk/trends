# Review Packet {{packetId}}

- Workspace: {{workspaceSlug}}
- Source: {{source}}
- Exported At: {{exportedAt}}
- Feedback Imported At: {{feedbackImportedAt}}
- Total Exported: {{totalExported}}
- Reviewed: {{reviewedCount}}
- Pending: {{pendingCount}}
- Warnings: {{warningCount}}

{{#if statusBreakdown}}
## Status Breakdown
{{#each statusBreakdown}}
- {{this.label}}: {{this.count}}
{{/each}}
{{/if}}

{{#if actionBreakdown}}
## Action Breakdown
{{#each actionBreakdown}}
- {{this.label}}: {{this.count}}
{{/each}}
{{/if}}

{{#if warnings}}
## Attention
{{#each warnings}}
- {{this}}
{{/each}}
{{/if}}

_Generated at {{timestamp}}_
