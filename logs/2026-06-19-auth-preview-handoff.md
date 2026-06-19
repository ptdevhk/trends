# Handoff: Auth Features Preview Verification (2026-06-19)

**Purpose:** A fresh agent needs to examine all latest auth features on the preview site (`https://preview.pt-mes.com`). This document provides context on what was deployed, how to verify, and known issues.

**Prod status:** Pinned at `v0.4.6-hotfix` (`4ce93b90`). **No prod deploys** — all work is on `main`, deployed to preview only. Step 4 (prod tag cut) is a **human gate** per memory entry `step-4-human-gate.md`.

---

## What shipped to `main` today (4 PRs)

| PR | Commit | Title |
|---|---|---|
| #1299 | `5c664b92` | feat(auth): admin user CRUD + memberships UI (scope C) |
| #1300 | `6e445eca` | fix(auth): default AUTH_ADMIN_RESET_ENABLED to true |
| #1301 | `640a8b7b` | fix(auth): skip CSRF check on stale session cookie |
| #1302 | `87a51971` | feat(web): self-service password change page for normal users |

## Preview environment

- **URL:** `https://preview.pt-mes.com`
- **Admin login:** `admin` / `admin123` (seeded by `setup-preview.sh` step [8/8] via `BOOTSTRAP_ADMIN_USERS` + `AUTH_BOOTSTRAP_PASSWORD` env vars in `.env.preview`)
- **Convex:** Docker on ptcloud, ports 4210/4211, healthy (HTTP 200)
- **API:** systemd `trends-preview-api` on port 3002, healthy
- **Rebuild command:** `ssh ptcloud 'bash /opt/trends/deploy/setup-preview.sh'` then `systemctl restart trends-preview-api`
- **Seeding:** `setup-preview.sh` step [8/8] auto-seeds the admin. If the DB is empty after rebuild (seeder missed), manually run: `ssh ptcloud 'cd /home/ubuntu/trends-preview && sudo -u ubuntu bash -c "set -a && source .env.preview && set +a && bunx tsx scripts/auth/manage-user.ts --username admin --workspace dev --role admin --password-env AUTH_BOOTSTRAP_PASSWORD --output agent"'`

## Features to verify

### 1. Admin user CRUD UI (PR #1299)

**URL:** `https://preview.pt-mes.com/dev/system/settings/auth` (login as `admin`/`admin123`)

What to check:
- "用户管理" (Users) heading visible with user table
- "+ 新增用户" button → opens create-user dialog
- Create a user (e.g. username=`testuser`, displayName=`Test User`, workspace=`hr`, role=`user`) → modal shows temp password ONCE with copy button
- Per-row actions: 停用 (Disable), 重置密码 (Reset password), 解除锁定 (Unlock), 查看审计记录 (View audit), 编辑工作区 (Edit memberships)
- Disable → re-enable round-trip works
- Edit memberships → add `dev`/`admin` → table updates (onChanged callback)
- Self-disable blocked (400 toast)
- Self-demotion blocked (400 toast when removing own `dev`/`admin`)
- Access denied from `/hr/system/settings/auth` (system-admin gate: `dev` workspace + `admin` role only per ADR D4)

### 2. Admin reset-password default-on (PR #1300)

What to check:
- Click "重置密码" on any user row → temp password modal appears (NOT "Not found")
- No `AUTH_ADMIN_RESET_ENABLED` env var needed — default is ON; opt-out only via explicit `=false`

### 3. CSRF stale-cookie fix (PR #1301)

What to check:
- Open incognito → set a stale `trends_session` cookie (e.g. via DevTools: `document.cookie = "trends_session=stale-fake-token"`)
- Navigate to `/dev/login`, fill `admin`/`admin123`, click login
- **Expected:** login succeeds (page navigates to `/admin/system/settings/auth`)
- **Before fix:** 403 "CSRF token required" + "用户名或密码错误" error

### 4. Self-service password change (PR #1302)

**URL:** `https://preview.pt-mes.com/dev/settings/account` (any logged-in user)

What to check:
- "Account" page visible in workspace settings sidebar (Key icon)
- Form: current password + new password + confirm new password
- Validation: min 6 chars, confirm must match
- Success: toast "Password changed successfully", fields cleared
- Wrong current password: inline error "Current password is incorrect"
- Login with new password works after change

**Known limitation:** OAuth-only users (no local password) see the form but get "current password incorrect" on submit. Deferred followup — should show SSO info message.

### 5. Lockout/unlock (pre-existing, PR #1296)

What to check:
- Fail login 5x for any username → 6th attempt returns 429 (locked out)
- Admin clicks "解除锁定" (Unlock) on that user → user can attempt login again
- `POST /api/admin/auth/unlock` endpoint live and gated (401 without auth, 403 from non-dev workspace)

## Known issues

1. **Preview seeder doesn't reliably populate on every rebuild.** `setup-preview.sh` moves the old preview dir to `.bak` and rsyncs fresh — the `--exclude 'output/*.db'` means the DB starts empty. The seeder block (step [8/8]) sometimes doesn't surface output. Workaround: manually re-seed via `manage-user.ts` (see seeding command above).

2. **OAuth-only users see unusable change-password form.** Casdoor/SSO users with no local password get "current password incorrect" on submit. Should show "Your account uses SSO login" message. Deferred.

## Vault artifacts

| Path | Content |
|------|---------|
| `projects/trends/work/2026-06-19-admin-auth-ui-scope-c/spec.md` | Locked spec (8 grill-me decisions) |
| `projects/trends/work/2026-06-19-admin-auth-ui-scope-c/plan.md` | 12-task TDD implementation plan (all complete) |
| `projects/trends/compound/2026-06-19-v0.4.6-to-main-lessons.md` | Cycle 4 preview deploy retro |
| `raw/transcripts/2026-06-19-task-admin-auth-cli-gap.md` | CLI gap capture (no dedicated reset/unlock/disable CLI mode) |
| `raw/transcripts/2026-06-19-task-self-service-password-change-ui.md` | Self-service password change capture |

## Auto-memory entries (in `~/.claude/projects/.../memory/`)

| File | Key fact |
|------|----------|
| `step-4-human-gate.md` | Never autonomously cut prod tags; Step 4 is human gate |
| `admin-auth-ui-scope.md` | Vault-tracked spec pointer + 8 locked decisions summary |
| `preview-seeder-gap.md` | `setup-preview.sh` seeder gap + manual seed command |

## Suggested skills

- **`/playwright-cli`** — Drive browser verification of all 5 features above against `https://preview.pt-mes.com`
- **`/dev-loop`** — If the seeder gap or OAuth UX followup needs implementation
- **`/wiki-add-task`** — Capture any new findings during verification
- **`/wiki-query`** — Search vault for related prior art if issues surface
