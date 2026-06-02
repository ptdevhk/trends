# Seek (HK/MY Market)

Source for Hong Kong and Malaysia resumes via the Seek employer portal. Unlike 51job and job5156, Seek has two distinct collection endpoints.

## Prerequisites

- Logged into the appropriate Seek employer portal in Chrome
- Employer account selection must be complete (not stuck on `/account/select`)
- The browser extension must be loaded and active

---

## Path A: Recommended Candidates (HK)

jobId-based collection from an existing job posting's recommended candidates list.

### Default URL

```
https://hk.employer.seek.com/candidates/recommended?jobId=92216704
```

### Collection mechanism

Navigates to a specific job's recommended candidates page. The collector validates the page is on `/candidates/recommended` (not `/jobs` or `/account/select`). Results are tied to the job posting — changing the `jobId` changes which candidates appear.

### Best for
- Quick snapshots tied to a known job posting
- Reproducible samples (same jobId = same candidate pool)

### Known issues
- If redirected to `/jobs` (jobs list), the collector reports "SEEK redirected to the jobs list instead of the recommended candidates page"
- If redirected to `/account/select`, complete account selection first

---

## Path B: Talent Search (MY)

Keyword-based collection that mirrors how recruiters actually search.

### Default URL (not set in snapshot-source-backups.ts defaults — use `--seek-url` override)

```
https://hk.employer.seek.com/talentsearch?searchQuery=CNC+Sales&market=MY&pageNumber=1&roleTitles=Sales&salaryType=MONTHLY&minSalary=0&salaryUnspecified=true&keywords=CNC&matchAll=false&sortBy=RELEVANCE
```

### URL parameters

| Param | Example | Description |
|---|---|---|
| `keywords` | `CNC+sales` | Search keywords |
| `market` | `MY` | Market code |
| `roleTitles` | `Sales+Manager` | Narrow by role title |

### Collection command

```bash
bun run scripts/resume/snapshot-source-backups.ts \
  --source seek --count 20 \
  --seek-url "https://hk.employer.seek.com/talentsearch?searchQuery=CNC+Sales&market=MY&pageNumber=1&roleTitles=Sales&salaryType=MONTHLY&minSalary=0&salaryUnspecified=true&keywords=CNC&matchAll=false&sortBy=RELEVANCE"
```

### Best for
- Keyword-targeted samples that reflect actual recruiter search behavior
- MY market specifically

---

## Path Selection

| Criterion | Recommended | Talent Search |
|---|---|---|
| Market | HK | MY |
| Input | jobId | keywords + market |
| Reproducibility | High (fixed jobId) | Medium (search results change) |
| Recruiter realism | Low (pre-filtered by job) | High (matches real search flow) |

For a full refresh that covers both markets, run both paths with different `--seek-url` values. Note that both use alias `seek`, so the second run overwrites the first's snapshot file unless you rename or use separate directories.
