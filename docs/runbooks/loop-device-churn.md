# Loop-device churn diagnosis & safe cleanup

Runbook for measuring loop-device attach/detach churn, identifying the source
of each loop device, and detaching only stale loops (no holder mount, no open
fd). Tool: `scripts/loop-device-churn.ts` (bunx tsx), colocated vitest suite
`scripts/loop-device-churn.test.ts`.

## When to use

- A host accumulates loop devices (`losetup -a` shows many entries) or emits
  `loop0: detected capacity change from 0 to ...` dmesg spam.
- `mount` fails with "couldn't find any free loop devices" / `loop-control`
  exhaustion.
- You need to prove *which* subsystem (snapd, container runtime, udisks2,
  AppImage, ad-hoc script) attaches loops, before deciding what to disable.

## Quick reference

```bash
bunx tsx scripts/loop-device-churn.ts snapshot              # one snapshot
bunx tsx scripts/loop-device-churn.ts snapshot --json       # machine-readable
bunx tsx scripts/loop-device-churn.ts watch --interval 5 --count 3
bunx tsx scripts/loop-device-churn.ts cleanup               # dry-run: list stale
bunx tsx scripts/loop-device-churn.ts cleanup --apply       # detach stale only
```

Exit codes: `0` = success (including an honest zero-loop report), `1` = hard
error. `--apply` detaches **only** loops classified stale: backing file
present, no holder mount (`/proc/mounts`), no open fd (`/proc/*/fd`). A
belt-and-suspenders `isStillStale()` re-check runs immediately before each
detach. Dry-run is the default.

Source classification (first match wins): `snap` (backing under `/snap/` or
`/var/lib/snapd/snaps/`), `container` (`/var/lib/docker/`, `/var/lib/
containerd/`, `/var/lib/containers/storage/`, `/var/lib/kubelet/`,
`/var/lib/lxc/`), `udisks-iso` (`.iso` backing or holder under `/media/`,
`/run/media/`), `appimage` (`.AppImage` backing or holder under
`/tmp/.mount_`), `manual` (anything else — ad-hoc `mount -o loop`).

## Measurement

### One-off snapshot

```bash
bunx tsx scripts/loop-device-churn.ts snapshot --json
```

Fields: `loopCount`, per-loop `backingFile` / `source` / `stale` /
`detachable`, `freeLoopNodes`, `warnings`, `human`. `loopSubsystem.available`
is true when losetup ran or a sysfs backing file was readable.

### Churn over time (watch)

```bash
bunx tsx scripts/loop-device-churn.ts watch --interval 60 --count 60   # 1h
```

Emits one report per sample; the `events` array carries attach/detach deltas
between consecutive samples. A loop number reused with a different backing
file is reported as detach + attach (rebind). Free/unbacked nodes are never
events.

### Raw primitives (for cross-checking with other tools)

```bash
losetup -a                                 # attached devices + backing files
ls -l /sys/block/loop*/loop/backing_file   # sysfs truth (losetup-independent)
cat /proc/mounts | grep loop               # holder mounts (partition mounts included)
ls -l /proc/*/fd 2>/dev/null | grep loop   # open fds holding loop devices
cat /sys/module/loop/parameters/max_loop   # number of loop nodes (0 = dynamic)
```

## Root causes of high churn

| Source | Backing pattern | Mechanism | Typical host |
|---|---|---|---|
| `snap` | `/var/lib/snapd/snaps/*.snap` | every snapd refresh + first run of a snap attaches a loop for the squashfs image; each refresh detaches the old one | Ubuntu desktop/server with snapd |
| `container` | `/var/lib/docker/devicemapper/*` | legacy docker devicemapper storage driver uses loop-backed thin pools (data + metadata) | old docker installs |
| `container` | `/var/lib/containerd/`, `/var/lib/containers/storage/` | overlay/snapshotter layers occasionally loop-backed (rare on modern runtimes) | containerd/podman hosts |
| `udisks-iso` | `*.iso` + mount under `/media/` or `/run/media/` | desktop "double-click the ISO" mounts attach a loop per image and detach on unmount/eject | Ubuntu desktop with GNOME Files |
| `appimage` | `*.AppImage`, mount under `/tmp/.mount_*` | AppImage runtime mounts the image read-only on run, detaches on exit; crashed AppImages leak loops | desktop users |
| `manual` | anything else | ad-hoc `mount -o loop file.img`, CI scripts, backup scripts that forget `losetup -d` / `umount` | servers, CI runners |

Churn ≠ leak. snapd and AppImage attach/detach loops continuously by design;
only *stale* loops (attached, no holder) are cleanup candidates. `manual`
loops with no holder are the most common genuine leak (scripts that attach and
never detach).

## Permanent mitigations

1. **snapd churn**: on servers that do not use snaps, remove snapd
   (`apt purge snapd` + remove `/var/lib/snapd`); otherwise keep it — the
   loops are short-lived by design. Tune refresh timing
   (`snap refresh --hold`, refresh.timer override) if you just want fewer
   attach/detach events.
2. **docker devicemapper**: migrate the storage driver to overlay2 or a
   dedicated thin pool; the devicemapper loop devices are a known cause of
   `max loop devices reached` and I/O stalls.
3. **udisks2 ISO mounts**: when a desktop user leaves ISOs mounted, unmount
   via GNOME Files (or `udisksctl unmount -b /dev/loopN`). For servers,
   disable the udisks2 service if it is not needed.
4. **AppImage leaks**: fix the wrapping script to `umount` on exit, or run
   AppImages under `--appimage-extract` alternatives when they crash
   repeatedly.
5. **Ad-hoc `mount -o loop`**: always pair with `umount` (which auto-detaches
   the loop) or explicit `losetup -d` in a trap/`finally`; check
   `mount | grep loop` in CI teardown.
6. **Loop node exhaustion**: `max_loop` (module param, sysfs above) counts
   nodes; modern kernels use dynamic loop allocation, so "no free loop
   devices" is usually stale loops, not a small `max_loop`. Clean stale loops
   (below) first; only then consider raising `max_loop`.
7. **Periodic sweep**: `bunx tsx scripts/loop-device-churn.ts cleanup --apply`
   in a cron/systemd timer (dry-run first, review the `skipped` list for
   loops the re-check refused).

## Safe cleanup

```bash
bunx tsx scripts/loop-device-churn.ts cleanup        # what would be detached
bunx tsx scripts/loop-device-churn.ts cleanup --apply
```

`--apply` detaches only loops with a backing file **and** no holder mount
**and** no open fd; a mount of a loop partition (`/dev/loop7p1`) counts as a
holder, so partitioned images are never detached while mounted. In-use loops
are never touched. The pre-detach re-check makes the tool safe to run while
the host is busy.

## Zero-loop hosts

On hosts with no loop subsystem (unprivileged containers without
`/dev/loop-control`, kernels with the loop module unloaded) the tool reports
the state honestly: `loopCount: 0`, a `loopSubsystem.available` flag, a
warning naming the missing node, exit `0` — not an error. `freeLoopNodes`
lists the (unbacked) `/sys/block/loopN` nodes when present.
