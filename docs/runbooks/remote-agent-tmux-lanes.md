# Remote agent dev-lane runbook (LXC tmux + claude --resume)

How to run long-lived Claude Code dev-lane sessions on remote hosts (LXC
`pvelxc-3adc3628`, ptcloud) from a laptop without losing work to network drops.
Origin: 2026-09-06 JOB12 lane died when the Mac→LXC ssh connection reset mid-task
(`ssh → exec claude` with no server-side persistence). Vault knowledge:
`projects/trends/compound/2026-09-07-remote-agent-lane-launch-recipe.md`.

## Launch a lane

```bash
ssh -t pvelxc-3adc3628 "tmux new-session -As job12"   # -A: attach if exists, create if not
# inside tmux:
cd /root/workspace && /root/.local/bin/claude
```

Kickoff prompt: point at a spec FILE on disk (scp'd work item or repo doc), state the
jobs, restate the locks (NO-PUSH / preview-only / never prod / no candidate PII), and
require "report BLOCKED explicitly". File-based prompts survive compacts and resumes.

## Reattach and supervise

| Need | Command |
| --- | --- |
| Reattach from any device | `ssh -t pvelxc-3adc3628 "tmux new-session -As job12"` |
| Headless peek | `ssh pvelxc-3adc3628 tmux capture-pane -pt job12` |
| Resume dead conversation | `claude --resume <sessionId>` (newest `/root/.claude/projects/-root-workspace/*.jsonl`) |
| Orca screen read / keys | `orca terminal read --terminal <handle> --screen --json` / `orca terminal send --terminal <handle> --text … --enter` |

## Rules

1. The agent process must live server-side (tmux on the target host). An orca
   terminal's default shell is Mac-local — a bare `tmux` there creates the session on
   the Mac; verify the hostname in the tmux status bar.
2. A screen read that is byte-identical across two polls (same cursor offsets, same
   spinner seconds) means the process is dead — confirm with `ps` before classifying
   as working.
3. Laptop shutdown is safe (tmux client just detaches). A target-host reboot is not:
   tmux does not auto-start; relaunch and `claude --resume`.
4. ssh keepalives (`-o ServerAliveInterval=30 -o ServerAliveCountMax=3`) help
   ergonomics; only tmux guarantees survival.
5. Auto-mode sessions never need keystrokes, but will wait silently at a
   human-decision prompt — reattach before assuming a stall.
