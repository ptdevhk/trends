# Trends

Trends is a multi-source data aggregation platform. Its primary context is resume screening; news aggregation is a supported extension.

## Language

**Resume Screening**:
The workflow for ingesting resumes, evaluating fit, filtering candidates, and notifying humans only when needed.
_Avoid_: HR automation, recruitment bot

**Resume**:
A candidate profile collected from a supported source and normalized enough for search, scoring, and review.
_Avoid_: CV record, profile blob

**Candidate**:
The person represented by one or more resumes or source profiles.
_Avoid_: Applicant, user

**Search Profile**:
A reusable screening configuration that captures the role, filters, and matching intent for candidate discovery.
_Avoid_: Saved search, query preset

**Job Description**:
The role description used to derive or compare screening intent.
_Avoid_: JD text blob, prompt

**JD Auto-Match**:
The workflow that turns a job description into candidate matching criteria and scoreable screening signals.
_Avoid_: Semantic search, embedding match

**Candidate Action**:
A human or workflow action on a candidate, such as star, archive, shortlist, reject, note, or contact.
_Avoid_: Candidate status

**Candidate Status**:
The candidate's pipeline stage.
_Avoid_: Candidate action

**Resume Source**:
An external site or feed that provides resume data.
_Avoid_: Crawler, provider

**News Aggregation**:
The older supported extension path for collecting and processing news items.
_Avoid_: Main product path
