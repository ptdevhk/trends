# Seek MY Service Engineer refine (~500) — owner-gated collect

Supporting collect plan for restoring MY usable volume toward the
**prod v0.4.16 ~427 bar** after the quoted-phrase soft-match search fix.

> **Human gate.** Do not invent prod fixtures. Do not write candidate-status.
> Live Seek collect runs only after explicit operator approval.

## Why

- Search soft-match unblocks `"CNC" "Service Engineer"` AND on existing rows.
- Current prod MY AND (~26) is still far below the 0.4.16 usable bar (~427).
- Owner target: refine Talent Search so a live run can add **~500**
  service-engineer-adjacent MY resumes without re-flooding operators /
  electricians (rev1 OR noise).

## Baseline recipe (already in profile YAML)

`config/search-profiles/seek-malaysia-talent-search-service-engineer.yaml`:

- Host: `hk.employer.seek.com/talentsearch`
- `searchQuery=CNC`
- `keywords=CNC`
- `matchAll=false`
- roleTitles (picker stack): Services Engineer, Service Technician,
  Service Manager, Service Coordinator, Service Supervisor
- `market=MY`

## Investigate before collect (read-only)

1. Open Talent Search with the baseline URL; note estimated result count.
2. Compare tighten options (document chosen one):
   - Keep CNC + 5-stack; raise `collectLimit` / pages toward ~500.
   - Drop Supervisor/Coordinator if they pull non-CNC noise.
   - Optional second pass: `searchQuery=CNC` + fewer roleTitles that
     matched high-intent rows in local/prod UAT (Services Engineer /
     Service Technician first).
3. Spot-check first page titles: reject if dominated by CNC operator /
   electrician / QMS without service language.
4. Record recommended `collectLimit`, `maxPages`, and final jobUrl in the
   work item log before any live run.

## Acceptance for the collect leg

- Recipe documented with expected yield ~500 and a noise rationale.
- Operator approves before any live collect.
- After collect (separate attended session): MY AND golden usable volume
  moves toward the 0.4.16 bar; no candidate-status batch writes as part of
  collect.

## Prod soft-match reliability check (no collect)

After soft-match ships to prod, re-run **hr-demo** read-only UAT on
`https://trends.pt-mes.com` against **current** MY rows (no fixtures, no
candidate-status writes).

Exact golden URL (quoted AND — must stay quoted):

```
/hr/resumes?q=%22CNC%22+%22Service+Engineer%22&mode=AND&roleType=engineer&minRoleYears=1&market=MY
```

Pass criteria (existing corpus only):

- API `summary.total` for the exact quoted URL is **> 0** (local post-fix was 9 on a thin seed; prod should be at least the former unquoted-leg recall order of magnitude when soft-match is live).
- Response `expandedTo` still lists the phrase group; soft-match must not require operators to drop quotes.
- CNC CN goldens (sales CNC / CMM) do not regress to empty.

### Fallback if exact quoted AND stays 0 on prod

Do **not** invent fixtures. Escalate in this order:

1. **Confirm deploy**: prod BFF/Convex git SHA includes soft-match; restart API + Convex if code is present but process is stale.
2. **Operator workaround (same session)**: unquoted two-token form
   `q="CNC" service engineer` (mode AND) — historically returned ~11 local / ~26 prod before soft-match. Use only as a temporary UI/API probe, not as the golden profile change.
3. **OR contrast**: `mode=OR` with the same quoted q — confirms CNC leg still hits; if OR also collapses, the issue is not soft-match.
4. **Code rollback**: revert the soft-match PR / redeploy previous SHA if soft-match causes false-positive floods (e.g. generic "service"+"engineer" noise dominating page 1). Keep quoted AND profiles unchanged until a fix lands.
5. **Volume follow-up (separate human gate)**: only after quoted AND is non-zero, run the Seek ~500 refine collect above toward the ~427 bar.

## Related

- Work item: `projects/trends/work/2026-10-05-my-service-engineer-phrase-soft-match/spec.md`
- Rank-then-collect (approach C): `projects/trends/work/2026-10-06-my-th-service-engineer-rank-then-collect/spec.md`
- Local TH ingest + AI UAT 2026-10-06: `docs/runbooks/seek-th-my-service-engineer-rank-collect-uat-2026-10-06.md`
- UAT: `queries/2026-10-05-prod-five-search-uat-hr-demo-rev2.md`
- Local walk: `/tmp/goldens-2-5-local-uat.md`
