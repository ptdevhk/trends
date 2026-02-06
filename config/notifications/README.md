# Notification Templates

This directory contains message templates for automated notifications.

## Template Format

Templates use Markdown with variable substitution:

```markdown
# Subject: {{title}}

Hello {{recipientName}},

New candidate matched for **{{jobTitle}}**:

- **Name**: {{candidateName}}
- **Score**: {{matchScore}}
- **Experience**: {{experience}}

{{#if aiSummary}}
AI评语: {{aiSummary}}
{{/if}}

[View Details]({{detailsUrl}})
```

## Available Variables

### Candidate Variables
- `{{candidateName}}` - Candidate's name
- `{{matchScore}}` - AI match score (0-100)
- `{{experience}}` - Years of experience
- `{{education}}` - Education level
- `{{currentCompany}}` - Current/last company
- `{{expectedSalary}}` - Expected salary
- `{{location}}` - Candidate location
- `{{aiSummary}}` - AI-generated summary
- `{{aiRecommendation}}` - AI recommendation (recommended/conditional/notRecommended)

### Job Variables
- `{{jobTitle}}` - Job title
- `{{jobId}}` - Job description ID
- `{{jobLocation}}` - Job location

### Context Variables
- `{{detailsUrl}}` - Link to candidate details
- `{{actionUrl}}` - Link to take action
- `{{recipientName}}` - Notification recipient
- `{{timestamp}}` - Notification time

## Files

- `shortlist-wechat.md` - WeChat Work notification for shortlisted candidates
- `shortlist-email.md` - Email notification for shortlisted candidates
- `daily-summary.md` - Daily summary report
- `weekly-report.md` - Weekly analytics report
