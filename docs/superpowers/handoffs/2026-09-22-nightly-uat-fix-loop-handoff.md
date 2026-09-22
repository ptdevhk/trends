# Handoff: Overnight UAT + fix loop (一路改一路試)

**To:** Claude `term_ad4a27e4-6a99-41b4-abee-4327d0cdba66` (trends workspace)
**From:** Cursor operator session (2026-09-22)
**Repo:** `/root/workspace` (trends)
**Branch:** `main` @ `4662b33e` (ahead 2 of origin — **NO-PUSH**)
**Status:** CMM/3D sample refresh DONE + READY. Stack up. Start overnight full UAT + fix loop now.

---

## Mission (one sentence)

Run continuous overnight UAT on the local stack — gates + browser surfaces — and **fix every confirmed issue as you find it** (TDD → verify → NO-PUSH commit `[nightly-uat]`) until backlog empty or ~09:00; write `/tmp/uat-report-2026-09-22.md` + FINAL SUMMARY.

---

## Canonical runbook (updated tonight)

`docs/agent-runbook.md` → **Nightly UAT & Fix Loop (local stack)**. Read it first.
Key deltas vs Aug handoffs:

- **NO-PUSH** (do not push preview/main).
- Branch may be `main` on pvelxc (OK).
- New surfaces: Runtime Effective AI (`/admin/system/settings/runtime`), CMM/3D SearchHero.
- Gotchas: `--source convex` for live search; `enable_thinking:false` if analyze stalls; CPA key ≠ Poe key.

Prior surface checklist still valid: `docs/superpowers/handoffs/2026-08-19-nightly-full-uat-handoff.md` § UAT surface checklist (industry inbox, policies, unresolved, dedup, audit, search, F1–F5).

---

## State snapshot

```json
{
  "repo": { "dir": "/root/workspace", "branch": "main", "head": "4662b33e",
    "ahead": 2, "note": "dirty tree has unrelated WIP/untracked — leave alone; only stage UAT-fix files" },
  "recent_shipped": [
    "2c1a1dfb feat(ai): hot-config model/base via admin+CLI; fix CMM quickstart polarity",
    "4662b33e feat(settings): effective AI status card (Option 2) + post-save refresh",
    "sample repo 0017b3c CMM/3D 50+50 merged with CNC packs"
  ],
  "dev-stack": { "web": "http://localhost:5173", "bff": ":3000", "convex": ":3210",
    "cdp": "localhost:9222 cmux attach-only", "up": true },
  "ai": { "enabled": true, "model": "openai/deepseek-v4-flash",
    "base": "https://cpa.pt-mes.com/v1", "cpa_key_synced": true },
  "cmm3d": { "search_cmm": "~34", "search_3d": "~6-7", "analyze": "green avgs 56/65" }
}
```

---

## Cadence

1. Memory trim if MemAvailable < 4 GB (F18 convex-only restart).
2. `set -a; source .env; set +a`
3. Gates → browser UAT (hr-demo / demo-admin / uat-reviewer) → log findings.
4. **Fix loop immediately** on each confirmed P0/P1 (do not batch all findings then fix).
5. Append row to `/tmp/uat-report-2026-09-22.md`; evidence `/tmp/uat-evidence/`.
6. Repeat until 09:00 or backlog empty; then FINAL SUMMARY + vault transcript if P1/P2.

Out of scope: prod, preview host, force-push, sample-repo wipe, secrets commits.
