#!/usr/bin/env bun
/**
 * Loop-device churn diagnostic + safe cleanup CLI.
 *
 * Measures loop-device attach/detach churn (snapd, container runtimes,
 * udisks2 ISO mounts, AppImage, ad-hoc `mount -o loop`) and detaches stale
 * loop devices. Pure parsing/classification/diffing functions are exported
 * for fixture-driven tests; the CLI is a thin shell that collects live data
 * and feeds the same functions.
 *
 * Usage:
 *   bunx tsx scripts/loop-device-churn.ts snapshot [--json]
 *   bunx tsx scripts/loop-device-churn.ts watch [--interval SEC] [--count N] [--json]
 *   bunx tsx scripts/loop-device-churn.ts cleanup [--apply] [--json]
 *   bunx tsx scripts/loop-device-churn.ts --help
 *
 * Exit codes: 0 = success (including an honest zero-loop report); 1 = hard
 * error (unreadable inputs when no fallback exists, unknown command).
 *
 * Cleanup is dry-run by default. `--apply` detaches ONLY loops classified
 * stale (backing file present, no holder mount, no open fd). A loop with a
 * holder mount or an open fd is never detachable.
 *
 * JSON schema (snapshot; watch emits one report object per sample; cleanup
 * emits a single report object):
 *
 *   {
 *     "schemaVersion": 1,
 *     "command": "snapshot" | "watch" | "cleanup",
 *     "capturedAt": "<ISO-8601 UTC>",
 *     "hostname": "<hostname>",
 *     "loopSubsystem": {
 *       "available": boolean,           // losetup ran OR a sysfs backing file was readable
 *       "maxLoopNodes": number,         // count of /sys/block/loopN nodes
 *       "controlNode": "/dev/loop-control"
 *     },
 *     "loopCount": number,              // attached loop devices
 *     "loops": [{
 *       "name": "loop0", "path": "/dev/loop0",
 *       "backingFile": "<path>" | null, // null = free/unbacked node
 *       "deleted": boolean,             // backing file unlinked (" (deleted)")
 *       "source": "snap" | "container" | "udisks-iso" | "appimage" | "manual",
 *       "sourceReason": "<short reason>",
 *       "holderMounts": [{ "device": "/dev/loop0", "mountPoint": "/snap/...",
 *                          "fstype": "squashfs", "options": "ro,..." }],
 *       "holderPids": [{ "pid": 1234, "fd": "7", "target": "/dev/loop0" }],
 *       "stale": boolean,               // attached, has backing file, no holders
 *       "detachable": boolean           // stale => eligible for cleanup
 *     }],
 *     "freeLoopNodes": ["loop3", ...],  // sysfs nodes with no backing file
 *     "events": [{                      // watch/cleanup: churn events
 *       "device": "loop0", "backingFile": "...", "direction": "attach"|"detach",
 *       "observedAt": "<ISO-8601 UTC>"
 *     }],
 *     "warnings": [string],
 *     "human": "<one-line human summary>"
 *   }
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { hostname } from 'node:os'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LoopSource = 'snap' | 'container' | 'udisks-iso' | 'appimage' | 'manual'
export type LoopDirection = 'attach' | 'detach'

export interface ParsedLosetupEntry {
  /** Device path as printed, e.g. "/dev/loop0". */
  device: string
  /** Backing file path, or null when the line carries no path. */
  backingFile: string | null
  /** True when the backing file has been unlinked (" (deleted)" suffix). */
  deleted: boolean
}

export interface MountHolder {
  device: string
  mountPoint: string
  fstype: string
  options: string
}

export interface FdHolder {
  pid: number
  fd: string
  target: string
}

export interface LoopDeviceInfo {
  name: string
  path: string
  backingFile: string | null
  deleted: boolean
  source: LoopSource
  sourceReason: string
  holderMounts: MountHolder[]
  holderPids: FdHolder[]
  stale: boolean
  detachable: boolean
}

export interface LoopSnapshot {
  schemaVersion: 1
  command: 'snapshot' | 'watch' | 'cleanup'
  capturedAt: string
  hostname: string
  loopSubsystem: {
    available: boolean
    maxLoopNodes: number
    controlNode: string
  }
  loopCount: number
  loops: LoopDeviceInfo[]
  freeLoopNodes: string[]
  warnings: string[]
  human: string
}

export interface ChurnEvent {
  device: string
  backingFile: string | null
  direction: LoopDirection
  observedAt: string
}

export interface ChurnReport {
  schemaVersion: 1
  command: 'watch' | 'cleanup'
  capturedAt: string
  hostname: string
  loopSubsystem: {
    available: boolean
    maxLoopNodes: number
    controlNode: string
  }
  loopCount: number
  loops: LoopDeviceInfo[]
  freeLoopNodes: string[]
  events: ChurnEvent[]
  detachAttempts: number
  detached: string[]
  skipped: string[]
  warnings: string[]
  human: string
}

/** Raw inputs collected from the live host; every field is testable. */
export interface RawSources {
  losetupText: string
  /** loop name -> raw backing_file content (trimmed), or null when unreadable/absent. */
  sysfsBackingFiles: Record<string, string | null>
  mountsText: string
  /** pid -> [fd targets] that reference loop devices. */
  fdTargetsByPid: Record<string, Array<{ fd: string; target: string }>>
  /** Names of loop nodes present under /sys/block (e.g. ["loop0", ...]). */
  sysfsLoopNames: string[]
  /** Whether the /dev/loop-control node exists on this host. */
  controlNodePresent: boolean
}

// ---------------------------------------------------------------------------
// Parsers (pure)
// ---------------------------------------------------------------------------

const LOSETUP_MODERN =
  /^(\S+):\s+\[(\d+)\]:(\d+)\s+\((.+?)(\s+\(deleted\))?\)\s*$/
const LOSETUP_LEGACY = /^(\S+):\s+(.+)$/

/**
 * Parse `losetup -a` output (text form). Modern util-linux prints
 * "/dev/loop0: [64768]:1046532 (/var/lib/snapd/snaps/core20_2318.snap)" and
 * appends " (deleted)" when the backing file has been unlinked. Pre-2.22
 * losetup printed "/dev/loop0: /path". Lines that match neither shape are
 * skipped (they are typically informational messages, not devices).
 */
export function parseLosetupOutput(text: string): ParsedLosetupEntry[] {
  const entries: ParsedLosetupEntry[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const modern = LOSETUP_MODERN.exec(line)
    if (modern) {
      entries.push({
        device: modern[1],
        backingFile: modern[4],
        deleted: modern[5] !== undefined,
      })
      continue
    }
    const legacy = LOSETUP_LEGACY.exec(line)
    if (legacy && legacy[1].startsWith('/dev/loop')) {
      entries.push({ device: legacy[1], backingFile: legacy[2], deleted: false })
    }
  }
  return entries
}

/** Parse the sysfs `backing_file` content ("/path" or "/path (deleted)"). */
export function parseSysfsBackingFile(content: string): {
  backingFile: string | null
  deleted: boolean
} {
  const trimmed = content.trim()
  if (!trimmed) return { backingFile: null, deleted: false }
  const deleted = trimmed.endsWith(' (deleted)')
  return {
    backingFile: deleted ? trimmed.slice(0, -' (deleted)'.length) : trimmed,
    deleted,
  }
}

/** Decode octal escapes used by /proc/mounts (e.g. \040 for space, \011 tab). */
export function decodeMountEscape(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_m, oct: string) =>
    String.fromCharCode(parseInt(oct, 8)),
  )
}

/**
 * Parse `/proc/mounts` (or `/proc/self/mounts`) text. Returns every mount
 * line whose source device references a loop device, i.e. /dev/loopN or a
 * partition of one (/dev/loopNpM).
 */
export function parseProcMounts(text: string): MountHolder[] {
  const holders: MountHolder[] = []
  for (const rawLine of text.split('\n')) {
    if (!rawLine.includes('loop')) continue
    const fields = rawLine.split(/\s+/)
    if (fields.length < 4) continue
    const [device, mountPoint, fstype, options] = fields
    const m = /^\/dev\/loop(\d+)(?:p\d+)?$/.exec(device)
    if (!m) continue
    holders.push({
      device,
      mountPoint: decodeMountEscape(mountPoint),
      fstype,
      options,
    })
  }
  return holders
}

/**
 * Normalize a `/proc/<pid>/fd/<n>` readlink target to the loop device name
 * it references, or null when it is not a loop reference.
 */
export function fdTargetLoopName(target: string): string | null {
  const m = /^\/dev\/loop(\d+)(?: \(deleted\))?$/.exec(target.trim())
  return m ? 'loop' + m[1] : null
}

/**
 * Resolve holder PIDs for each loop device from fd scans.
 * `fdTargetsByPid` maps pid -> [{fd, target}].
 */
export function resolveFdHolders(
  fdTargetsByPid: Record<string, Array<{ fd: string; target: string }>>,
): Record<string, FdHolder[]> {
  const holders: Record<string, FdHolder[]> = {}
  for (const [pid, refs] of Object.entries(fdTargetsByPid)) {
    for (const ref of refs) {
      const name = fdTargetLoopName(ref.target)
      if (!name) continue
      ;(holders[name] ??= []).push({
        pid: Number(pid),
        fd: ref.fd,
        target: ref.target,
      })
    }
  }
  return holders
}

// ---------------------------------------------------------------------------
// Classification (pure)
// ---------------------------------------------------------------------------

const CONTAINER_MARKERS = [
  '/var/lib/docker/',
  '/var/lib/containerd/',
  '/var/lib/containers/storage/',
  '/var/lib/kubelet/',
  '/var/lib/lxc/',
]

/**
 * Classify the source of an attached loop device from its backing file and
 * holder mounts. First matching rule wins.
 */
export function classifyLoop(
  backingFile: string | null,
  holderMounts: MountHolder[],
): { source: LoopSource; reason: string } {
  if (backingFile === null) {
    return { source: 'manual', reason: 'no backing file (unattached node)' }
  }
  if (backingFile.includes('/snap/') || backingFile.includes('/var/lib/snapd/snaps/')) {
    return { source: 'snap', reason: 'backing file under /snap or /var/lib/snapd/snaps' }
  }
  for (const marker of CONTAINER_MARKERS) {
    if (backingFile.includes(marker)) {
      return { source: 'container', reason: `backing file under ${marker}` }
    }
  }
  const isoByPath = /\.iso$/i.test(backingFile)
  const isoByMount = holderMounts.some(
    (m) => m.mountPoint.startsWith('/media/') || m.mountPoint.startsWith('/run/media/'),
  )
  if (isoByPath || isoByMount) {
    return {
      source: 'udisks-iso',
      reason: isoByPath
        ? 'backing file is an .iso image'
        : 'holder mount under /media or /run/media (udisks2 ISO mount)',
    }
  }
  if (/\.appimage$/i.test(backingFile) || holderMounts.some((m) => m.mountPoint.startsWith('/tmp/.mount_'))) {
    return {
      source: 'appimage',
      reason: /\.appimage$/i.test(backingFile)
        ? 'backing file is an AppImage'
        : 'holder mount under /tmp/.mount_ (AppImage runtime)',
    }
  }
  return { source: 'manual', reason: 'no known runtime marker (ad-hoc mount -o loop)' }
}

// ---------------------------------------------------------------------------
// Snapshot assembly (pure)
// ---------------------------------------------------------------------------

/**
 * Assemble a loop snapshot from raw sources. Attached loops come from
 * `losetup -a` output; sysfs backing files supplement it (used when losetup
 * is missing or reports nothing). A sysfs loop node without a backing file
 * is a free/unbacked node — never attached, never detachable.
 */
export function assembleSnapshot(raw: RawSources, capturedAt: string): LoopSnapshot {
  const warnings: string[] = []

  const losetupByName = new Map<string, ParsedLosetupEntry>()
  for (const entry of parseLosetupOutput(raw.losetupText)) {
    const name = entry.device.replace(/^\/dev\//, '')
    losetupByName.set(name, entry)
  }

  const sysfsByName = new Map<string, { backingFile: string | null; deleted: boolean }>()
  for (const name of Object.keys(raw.sysfsBackingFiles)) {
    const content = raw.sysfsBackingFiles[name]
    if (content === null) {
      sysfsByName.set(name, { backingFile: null, deleted: false })
    } else {
      sysfsByName.set(name, parseSysfsBackingFile(content))
    }
  }

  const holdersByMount = new Map<string, MountHolder[]>()
  for (const holder of parseProcMounts(raw.mountsText)) {
    const name = holder.device.replace(/^\/dev\//, '').replace(/^(loop\d+)p\d+$/, '$1')
    if (!holdersByMount.has(name)) holdersByMount.set(name, [])
    holdersByMount.get(name)!.push(holder)
  }

  const fdHoldersByName = resolveFdHolders(raw.fdTargetsByPid)

  // Attached device names: union of losetup entries and sysfs entries with a
  // backing file (losetup may be absent or may not see the device).
  const attachedNames = new Set<string>()
  for (const name of losetupByName.keys()) attachedNames.add(name)
  for (const [name, sys] of sysfsByName) {
    if (sys.backingFile !== null) attachedNames.add(name)
  }

  const loops: LoopDeviceInfo[] = []
  const freeLoopNodes: string[] = []
  for (const name of [...new Set([...sysfsByName.keys(), ...attachedNames])].sort()) {
    const losetupEntry = losetupByName.get(name)
    const sysfsEntry = sysfsByName.get(name)
    const backingFile =
      losetupEntry?.backingFile ?? sysfsEntry?.backingFile ?? null
    const deleted = losetupEntry?.deleted ?? sysfsEntry?.deleted ?? false

    if (backingFile === null) {
      freeLoopNodes.push(name)
      continue
    }
    const holderMounts = holdersByMount.get(name) ?? []
    const holderPids = fdHoldersByName[name] ?? []
    const { source, reason } = classifyLoop(backingFile, holderMounts)
    const stale = holderMounts.length === 0 && holderPids.length === 0
    loops.push({
      name,
      path: '/dev/' + name,
      backingFile,
      deleted,
      source,
      sourceReason: reason,
      holderMounts,
      holderPids,
      stale,
      detachable: stale,
    })
  }

  const loopSubsystem = {
    available:
      raw.losetupText !== '' || sysfsByName.size > 0,
    maxLoopNodes: sysfsByName.size,
    controlNode: CONTROL_NODE,
  }
  if (!raw.controlNodePresent) {
    warnings.push(
      'no /dev/loop-control node — loop attach unavailable (common in unprivileged containers); state observed via /sys/block and /proc',
    )
  }
  if (loopSubsystem.maxLoopNodes === 0) {
    warnings.push('no /sys/block/loopN nodes found; loop module may be unloaded')
  }
  if (raw.losetupText === '' && Object.keys(raw.sysfsBackingFiles).length === 0) {
    warnings.push('losetup unavailable and sysfs loop nodes unreadable')
  }

  const human = buildSnapshotHuman(loops, freeLoopNodes, loopSubsystem, capturedAt, raw.controlNodePresent)
  return {
    schemaVersion: 1,
    command: 'snapshot',
    capturedAt,
    hostname: hostname(),
    loopSubsystem,
    loopCount: loops.length,
    loops,
    freeLoopNodes,
    warnings,
    human,
  }
}

function buildSnapshotHuman(
  loops: LoopDeviceInfo[],
  freeLoopNodes: string[],
  loopSubsystem: { available: boolean; maxLoopNodes: number },
  capturedAt: string,
  controlNodePresent: boolean,
): string {
  if (loops.length === 0) {
    const avail = !controlNodePresent
      ? 'loop subsystem unavailable: no /dev/loop-control'
      : loopSubsystem.available
        ? 'none attached'
        : 'loop subsystem unavailable'
    return `Loop devices: 0 attached — no loop devices attached (${avail}; ${freeLoopNodes.length} free /sys/block nodes) @ ${capturedAt}`
  }
  const bySource = new Map<string, number>()
  for (const loop of loops) bySource.set(loop.source, (bySource.get(loop.source) ?? 0) + 1)
  const breakdown = [...bySource.entries()]
    .map(([source, count]) => `${source}:${count}`)
    .join(', ')
  const stale = loops.filter((l) => l.detachable).length
  return `Loop devices: ${loops.length} attached (${breakdown}), ${stale} stale (detachable), ${freeLoopNodes.length} free @ ${capturedAt}`
}

// ---------------------------------------------------------------------------
// Churn differ (pure)
// ---------------------------------------------------------------------------

/**
 * Diff two snapshots into attach/detach events. A device present in `before`
 * but not `after` is a detach; present in `after` but not `before` is an
 * attach. A device present in both with a different backing file is reported
 * as a detach of the old binding followed by an attach of the new binding
 * (the loop number was reused). Events are observed at `after.capturedAt`,
 * ordered by device name with detach before attach per device.
 */
export function diffSnapshots(before: LoopSnapshot, after: LoopSnapshot): ChurnEvent[] {
  const beforeByName = new Map(before.loops.map((l) => [l.name, l.backingFile]))
  const afterByName = new Map(after.loops.map((l) => [l.name, l.backingFile]))
  const events: ChurnEvent[] = []
  for (const [name, backingFile] of afterByName) {
    if (!beforeByName.has(name)) {
      events.push({
        device: name,
        backingFile,
        direction: 'attach',
        observedAt: after.capturedAt,
      })
    } else if (beforeByName.get(name) !== backingFile) {
      events.push({
        device: name,
        backingFile: beforeByName.get(name) ?? null,
        direction: 'detach',
        observedAt: after.capturedAt,
      })
      events.push({
        device: name,
        backingFile,
        direction: 'attach',
        observedAt: after.capturedAt,
      })
    }
  }
  for (const [name, backingFile] of beforeByName) {
    if (!afterByName.has(name)) {
      events.push({
        device: name,
        backingFile,
        direction: 'detach',
        observedAt: after.capturedAt,
      })
    }
  }
  events.sort((a, b) => {
    if (a.device !== b.device) return a.device < b.device ? -1 : 1
    return a.direction === 'detach' ? -1 : 1
  })
  return events
}

// ---------------------------------------------------------------------------
// Live collection (I/O)
// ---------------------------------------------------------------------------

const CONTROL_NODE = '/dev/loop-control'

/** Collect raw sources from the live host. Never throws on missing pieces. */
export function collectRawSources(): RawSources {
  const warnings: string[] = []
  let losetupText = ''
  if (existsSync(CONTROL_NODE)) {
    try {
      const out = execFileSync('losetup', ['-a'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      losetupText = out
    } catch (err) {
      warnings.push('losetup -a failed: ' + (err as Error).message)
    }
  } else {
    // No control node: losetup -a still succeeds and prints nothing; run it
    // anyway so `available` reflects reality, but tolerate failure.
    try {
      losetupText = execFileSync('losetup', ['-a'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      /* keep empty */
    }
  }

  const sysfsBackingFiles: Record<string, string | null> = {}
  const sysfsLoopNames: string[] = []
  let sysfsEntries: string[] = []
  try {
    sysfsEntries = readdirSync('/sys/block')
  } catch {
    sysfsEntries = []
  }
  for (const entry of sysfsEntries) {
    if (!/^loop\d+$/.test(entry)) continue
    sysfsLoopNames.push(entry)
    const backingPath = `/sys/block/${entry}/loop/backing_file`
    if (!existsSync(backingPath)) {
      sysfsBackingFiles[entry] = null
      continue
    }
    try {
      sysfsBackingFiles[entry] = readFileSync(backingPath, 'utf8').trim()
    } catch {
      sysfsBackingFiles[entry] = null
    }
  }

  let mountsText = ''
  try {
    mountsText = readFileSync('/proc/mounts', 'utf8')
  } catch (err) {
    warnings.push('cannot read /proc/mounts: ' + (err as Error).message)
  }

  const fdTargetsByPid: Record<string, Array<{ fd: string; target: string }>> = {}
  let procEntries: string[] = []
  try {
    procEntries = readdirSync('/proc')
  } catch {
    procEntries = []
  }
  for (const entry of procEntries) {
    if (!/^\d+$/.test(entry)) continue
    let fdEntries: string[] = []
    try {
      fdEntries = readdirSync(`/proc/${entry}/fd`)
    } catch {
      continue // process exited or not readable; not an error
    }
    const refs: Array<{ fd: string; target: string }> = []
    for (const fd of fdEntries) {
      let target: string
      try {
        target = readlinkSync(`/proc/${entry}/fd/${fd}`)
      } catch {
        continue
      }
      if (fdTargetLoopName(target) !== null) refs.push({ fd, target })
    }
    if (refs.length > 0) fdTargetsByPid[entry] = refs
  }

  return {
    losetupText,
    sysfsBackingFiles,
    mountsText,
    fdTargetsByPid,
    sysfsLoopNames,
    controlNodePresent: existsSync(CONTROL_NODE),
  }
}

// ---------------------------------------------------------------------------
// Cleanup (I/O)
// ---------------------------------------------------------------------------

/** Detach one stale loop device; returns true when losetup -d succeeded. */
export function detachLoopDevice(path: string): boolean {
  const result = spawnSync('losetup', ['-d', path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return result.status === 0
}

/**
 * Re-check immediately before detaching that the loop is still stale (no
 * holder mount, no open fd). Belt-and-suspenders against the snapshot going
 * stale between collection and action.
 */
export function isStillStale(name: string): boolean {
  const device = '/dev/' + name
  const re = new RegExp('^' + device.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:p\\d+)?\\s')
  let mountsText = ''
  try {
    mountsText = readFileSync('/proc/mounts', 'utf8')
  } catch {
    return false
  }
  for (const line of mountsText.split('\n')) {
    if (re.test(line)) return false
  }
  let procEntries: string[] = []
  try {
    procEntries = readdirSync('/proc')
  } catch {
    return false
  }
  for (const entry of procEntries) {
    if (!/^\d+$/.test(entry)) continue
    let fdEntries: string[] = []
    try {
      fdEntries = readdirSync(`/proc/${entry}/fd`)
    } catch {
      continue
    }
    for (const fd of fdEntries) {
      try {
        if (readlinkSync(`/proc/${entry}/fd/${fd}`).trim().startsWith(device)) {
          return false
        }
      } catch {
        continue
      }
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  command: 'snapshot' | 'watch' | 'cleanup' | 'help'
  json: boolean
  intervalSec: number
  count: number
  apply: boolean
}

const HELP_TEXT = `loop-device-churn — diagnose and remediate loop-device churn

Commands:
  snapshot               Capture one loop-device snapshot (default command).
  watch                  Sample snapshots on an interval and report attach/detach
                         events between consecutive samples.
  cleanup                List stale loop devices (dry-run). With --apply, detach
                         ONLY loops that have a backing file and no holder mount
                         and no open fd. Never touches in-use loops.

Options:
  --json                 Machine-readable JSON output (schema in header comment).
  --interval SECONDS     Watch sampling interval (default 5).
  --count N              Watch number of samples (default 3; N-1 intervals).
  --apply                Cleanup: actually detach stale loops. Default is dry-run.
  --help                 Show this help.

Exit codes: 0 = success (including an honest zero-loop report), 1 = hard error.

JSON schema (snapshot):
{
  "schemaVersion": 1,
  "command": "snapshot",
  "capturedAt": "<ISO-8601 UTC>",
  "hostname": "<hostname>",
  "loopSubsystem": { "available": bool, "maxLoopNodes": int, "controlNode": "/dev/loop-control" },
  "loopCount": int,
  "loops": [{ "name": "loop0", "path": "/dev/loop0", "backingFile": string|null,
              "deleted": bool, "source": "snap|container|udisks-iso|appimage|manual",
              "sourceReason": string,
              "holderMounts": [{ "device", "mountPoint", "fstype", "options" }],
              "holderPids": [{ "pid": int, "fd", "target" }],
              "stale": bool, "detachable": bool }],
  "freeLoopNodes": ["loop3", ...],
  "warnings": [string],
  "human": string
}
watch emits one report object per sample (with "events": [...]); cleanup emits
one report object (with "events", "detachAttempts", "detached", "skipped").
`

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: 'snapshot',
    json: false,
    intervalSec: 5,
    count: 3,
    apply: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      args.command = 'help'
    } else if (arg === 'snapshot' || arg === 'watch' || arg === 'cleanup') {
      args.command = arg
    } else if (arg === '--json') {
      args.json = true
    } else if (arg === '--interval' && i + 1 < argv.length) {
      const n = Number(argv[++i])
      if (!Number.isFinite(n) || n < 1) {
        console.error('invalid --interval: ' + argv[i])
        process.exit(1)
      }
      args.intervalSec = n
    } else if (arg === '--count' && i + 1 < argv.length) {
      const n = Number(argv[++i])
      if (!Number.isFinite(n) || n < 1) {
        console.error('invalid --count: ' + argv[i])
        process.exit(1)
      }
      args.count = n
    } else if (arg === '--apply') {
      args.apply = true
    } else {
      console.error('unknown argument: ' + arg)
      console.error('run with --help for usage')
      process.exit(1)
    }
  }
  return args
}

function nowIso(): string {
  return new Date().toISOString()
}

function toStableJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function runSnapshot(raw: RawSources, json: boolean): number {
  const snapshot = assembleSnapshot(raw, nowIso())
  if (json) {
    process.stdout.write(toStableJson(snapshot))
  } else {
    process.stdout.write(snapshot.human + '\n')
    for (const loop of snapshot.loops) {
      process.stdout.write(
        `  ${loop.path} <- ${loop.backingFile ?? '(none)'} [${loop.source}] ` +
          `mounts=${loop.holderMounts.length} fds=${loop.holderPids.length} ` +
          (loop.detachable ? 'STALE (detachable)' : 'in use') + '\n',
      )
    }
    for (const warning of snapshot.warnings) {
      process.stdout.write(`WARN ${warning}\n`)
    }
  }
  return 0
}

async function runWatch(args: CliArgs, raw: RawSources): Promise<number> {
  let prev = assembleSnapshot(raw, nowIso())
  const allEvents: ChurnEvent[] = []
  const sampleCount = args.count
  for (let sample = 1; sample <= sampleCount; sample++) {
    const cur = sample === 1 ? prev : assembleSnapshot(collectRawSources(), nowIso())
    const events = sample === 1 ? [] : diffSnapshots(prev, cur)
    allEvents.push(...events)
    if (args.json) {
      const report: ChurnReport = {
        ...cur,
        command: 'watch',
        events,
        detachAttempts: 0,
        detached: [],
        skipped: [],
      }
      process.stdout.write(toStableJson(report))
    } else {
      process.stdout.write(
        `sample ${sample}/${sampleCount}: ${cur.loopCount} loop devices attached, ` +
          `${events.length} churn event(s) since previous sample\n`,
      )
      for (const event of events) {
        process.stdout.write(
          `  ${event.direction.toUpperCase()} ${event.device} <- ${event.backingFile ?? '(none)'} @ ${event.observedAt}\n`,
        )
      }
    }
    if (sample < sampleCount) await sleep(args.intervalSec * 1000)
    prev = cur
  }
  const summary = allEvents.length === 0
    ? `Watch complete: 0 attach/detach events observed across ${sampleCount - 1} interval(s) — no loop-device churn`
    : `Watch complete: ${allEvents.length} attach/detach event(s) observed across ${sampleCount - 1} interval(s)`
  if (args.json) {
    process.stdout.write(toStableJson({ command: 'watch-summary', events: allEvents, human: summary }))
  } else {
    process.stdout.write(summary + '\n')
  }
  return 0
}

function runCleanup(args: CliArgs, raw: RawSources): number {
  const snapshot = assembleSnapshot(raw, nowIso())
  const candidates = snapshot.loops.filter((l) => l.detachable)
  const detached: string[] = []
  const skipped: string[] = []
  if (args.apply) {
    for (const loop of candidates) {
      if (!isStillStale(loop.name)) {
        skipped.push(loop.path)
        continue
      }
      if (detachLoopDevice(loop.path)) {
        detached.push(loop.path)
      } else {
        skipped.push(loop.path)
      }
    }
  }

  const human =
    candidates.length === 0
      ? `Cleanup: no stale loop devices to detach (${snapshot.loopCount} attached, all in use or none)`
      : args.apply
        ? `Cleanup: detached ${detached.length} stale loop device(s)` +
          (skipped.length > 0 ? ` (skipped ${skipped.length}: re-check failed)` : '')
        : `Cleanup (dry-run): would detach ${candidates.length} stale loop device(s): ` +
          candidates.map((l) => l.path).join(', ')

  const report: ChurnReport = {
    ...snapshot,
    command: 'cleanup',
    events: candidates.map((l) => ({
      device: l.name,
      backingFile: l.backingFile,
      direction: 'detach' as const,
      observedAt: snapshot.capturedAt,
    })),
    detachAttempts: args.apply ? candidates.length : 0,
    detached,
    skipped,
    warnings: snapshot.warnings,
    human,
  }
  if (args.json) {
    process.stdout.write(toStableJson(report))
  } else {
    process.stdout.write(human + '\n')
    for (const loop of candidates) {
      process.stdout.write(
        `  ${loop.path} <- ${loop.backingFile} [${loop.source}] ${args.apply ? 'DETACHED' : 'would detach'}\n`,
      )
    }
  }
  return 0
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.command === 'help') {
    process.stdout.write(HELP_TEXT)
    return
  }
  const raw = collectRawSources()
  switch (args.command) {
    case 'snapshot':
      runSnapshot(raw, args.json)
      return
    case 'watch':
      await runWatch(args, raw)
      return
    case 'cleanup':
      runCleanup(args, raw)
      return
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('/loop-device-churn.ts') ||
    process.argv[1].endsWith('\\loop-device-churn.ts') ||
    process.argv[1].includes('loop-device-churn'))
if (isDirectRun) {
  main().then(
    () => {
      process.exitCode = 0
    },
    (err) => {
      console.error('loop-device-churn: ' + (err as Error).message)
      process.exitCode = 1
    },
  )
}
