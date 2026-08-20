import { describe, it, expect } from 'vitest'
import {
  assembleSnapshot,
  classifyLoop,
  diffSnapshots,
  fdTargetLoopName,
  parseLosetupOutput,
  parseProcMounts,
  parseSysfsBackingFile,
  resolveFdHolders,
  type LoopSnapshot,
  type RawSources,
} from './loop-device-churn'

// ---------------------------------------------------------------------------
// Fixtures: real-format inputs captured from busy hosts (Ubuntu desktop with
// snapd + docker devicemapper + udisks2 ISO mount + AppImage + ad-hoc loops).
// ---------------------------------------------------------------------------

const LOSETUP_TEXT = [
  '/dev/loop0: [1048578]:2252800 (/var/lib/snapd/snaps/core20_2318.snap)',
  '/dev/loop1: [1048578]:2252801 (/var/lib/snapd/snaps/snapd_21465.snap)',
  '/dev/loop2: [1048576]:1048577 (/var/lib/docker/devicemapper/devicemapper/data)',
  '/dev/loop3: [1048576]:1048578 (/var/lib/docker/devicemapper/devicemapper/metadata)',
  '/dev/loop4: [64768]:1046532 (/home/user/Downloads/ubuntu-24.04-desktop-amd64.iso)',
  '/dev/loop5: [1048579]:1048577 (/home/user/Downloads/SomeTool-2.5.0-x86_64.AppImage)',
  '/dev/loop6: [1048580]:65536 (/srv/backup/disk.img)',
  '/dev/loop7: [1048580]:65537 (/srv/vm/win11.qcow2)',
  '/dev/loop9: [1048576]:1048579 (/var/lib/snapd/snaps/core20_1234.snap (deleted))',
].join('\n')

const MOUNTS_TEXT = [
  '/dev/loop0 /snap/core20/2318 squashfs ro,nodev,relatime,errors=continue 0 0',
  '/dev/loop2 /var/lib/docker/devicemapper/mnt/abc123 ext4 rw,relatime 0 0',
  '/dev/loop4 /media/user/Ubuntu\\04024.04 iso9660 ro,nosuid,nodev,relatime 0 0',
  '/dev/loop5 /tmp/.mount_AppImaXXXXXX squashfs ro,nodev,relatime 0 0',
  '/dev/loop7p1 /mnt/legacy-data ext4 rw,relatime 0 0',
].join('\n')

const SYSFS_BACKING: Record<string, string | null> = {
  loop0: '/var/lib/snapd/snaps/core20_2318.snap',
  loop1: '/var/lib/snapd/snaps/snapd_21465.snap',
  loop2: '/var/lib/docker/devicemapper/devicemapper/data',
  loop3: '/var/lib/docker/devicemapper/devicemapper/metadata',
  loop4: '/home/user/Downloads/ubuntu-24.04-desktop-amd64.iso',
  loop5: '/home/user/Downloads/SomeTool-2.5.0-x86_64.AppImage',
  loop6: '/srv/backup/disk.img',
  loop7: '/srv/vm/win11.qcow2',
  loop8: null, // free/unbacked node
  loop9: '/var/lib/snapd/snaps/core20_1234.snap (deleted)',
}

const FD_TARGETS: Record<string, Array<{ fd: string; target: string }>> = {
  '1234': [{ fd: '7', target: '/dev/loop7' }],
}

function makeRaw(overrides: Partial<RawSources> = {}): RawSources {
  return {
    losetupText: LOSETUP_TEXT,
    sysfsBackingFiles: SYSFS_BACKING,
    mountsText: MOUNTS_TEXT,
    fdTargetsByPid: FD_TARGETS,
    sysfsLoopNames: Object.keys(SYSFS_BACKING),
    controlNodePresent: true,
    ...overrides,
  }
}

const T0 = '2026-08-20T00:00:00.000Z'

function snapOf(raw: RawSources): LoopSnapshot {
  return assembleSnapshot(raw, T0)
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

describe('parseLosetupOutput', () => {
  it('parses modern losetup -a lines with inode column', () => {
    const entries = parseLosetupOutput('/dev/loop0: [1048578]:2252800 (/var/lib/snapd/snaps/core20_2318.snap)\n')
    expect(entries).toEqual([
      {
        device: '/dev/loop0',
        backingFile: '/var/lib/snapd/snaps/core20_2318.snap',
        deleted: false,
      },
    ])
  })

  it('parses the "(deleted)" backing-file suffix', () => {
    const entries = parseLosetupOutput(
      '/dev/loop9: [1048576]:1048579 (/var/lib/snapd/snaps/core20_1234.snap (deleted))\n',
    )
    expect(entries).toEqual([
      {
        device: '/dev/loop9',
        backingFile: '/var/lib/snapd/snaps/core20_1234.snap',
        deleted: true,
      },
    ])
  })

  it('parses pre-2.22 legacy format without inode column', () => {
    const entries = parseLosetupOutput('/dev/loop3: /srv/legacy.img\n')
    expect(entries).toEqual([
      { device: '/dev/loop3', backingFile: '/srv/legacy.img', deleted: false },
    ])
  })

  it('returns no entries for empty output (zero loops)', () => {
    expect(parseLosetupOutput('')).toEqual([])
    expect(parseLosetupOutput('losetup: cannot open /dev/loop-control: No such file or directory\n')).toEqual([])
  })

  it('handles a path containing parentheses', () => {
    const entries = parseLosetupOutput('/dev/loop2: [1048576]:1048577 (/data/archive (2024).img)\n')
    expect(entries).toEqual([
      { device: '/dev/loop2', backingFile: '/data/archive (2024).img', deleted: false },
    ])
  })
})

describe('parseSysfsBackingFile', () => {
  it('parses a plain backing path', () => {
    expect(parseSysfsBackingFile('/var/lib/snapd/snaps/core20_2318.snap\n')).toEqual({
      backingFile: '/var/lib/snapd/snaps/core20_2318.snap',
      deleted: false,
    })
  })

  it('parses the "(deleted)" suffix', () => {
    expect(parseSysfsBackingFile('/srv/vm/win11.qcow2 (deleted)\n')).toEqual({
      backingFile: '/srv/vm/win11.qcow2',
      deleted: true,
    })
  })

  it('returns null backing for empty content', () => {
    expect(parseSysfsBackingFile('')).toEqual({ backingFile: null, deleted: false })
  })
})

describe('parseProcMounts', () => {
  it('extracts loop holder mounts with decoded octal escapes', () => {
    const holders = parseProcMounts(
      '/dev/loop4 /media/user/Ubuntu\\04024.04 iso9660 ro,nosuid,nodev,relatime 0 0\n',
    )
    expect(holders).toEqual([
      {
        device: '/dev/loop4',
        mountPoint: '/media/user/Ubuntu 24.04',
        fstype: 'iso9660',
        options: 'ro,nosuid,nodev,relatime',
      },
    ])
  })

  it('treats a loop partition mount as a holder of the loop device', () => {
    const holders = parseProcMounts('/dev/loop7p1 /mnt/legacy-data ext4 rw,relatime 0 0\n')
    expect(holders).toEqual([
      {
        device: '/dev/loop7p1',
        mountPoint: '/mnt/legacy-data',
        fstype: 'ext4',
        options: 'rw,relatime',
      },
    ])
  })

  it('ignores non-loop mounts', () => {
    expect(parseProcMounts('/dev/sda1 /boot ext4 rw 0 0\n')).toEqual([])
  })
})

describe('fdTargetLoopName / resolveFdHolders', () => {
  it('recognizes a direct /dev/loopN reference', () => {
    expect(fdTargetLoopName('/dev/loop7')).toBe('loop7')
  })

  it('recognizes a deleted-node reference', () => {
    expect(fdTargetLoopName('/dev/loop7 (deleted)')).toBe('loop7')
  })

  it('rejects non-loop targets', () => {
    expect(fdTargetLoopName('/dev/sda1')).toBeNull()
    expect(fdTargetLoopName('socket:[12345]')).toBeNull()
    expect(fdTargetLoopName('/dev/loop-control')).toBeNull()
  })

  it('maps pid+fd references onto loop names', () => {
    const holders = resolveFdHolders({
      '1234': [{ fd: '7', target: '/dev/loop7' }],
      '5678': [{ fd: '3', target: '/dev/loop0 (deleted)' }],
      '9999': [{ fd: '4', target: '/dev/sda1' }],
    })
    expect(holders['loop7']).toEqual([{ pid: 1234, fd: '7', target: '/dev/loop7' }])
    expect(holders['loop0']).toEqual([{ pid: 5678, fd: '3', target: '/dev/loop0 (deleted)' }])
    expect(holders['loop9999']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

describe('classifyLoop', () => {
  it('classifies snap backing files', () => {
    const { source, reason } = classifyLoop('/var/lib/snapd/snaps/core20_2318.snap', [])
    expect(source).toBe('snap')
    expect(reason).toContain('snap')
  })

  it('classifies container-runtime backing files', () => {
    expect(classifyLoop('/var/lib/docker/devicemapper/devicemapper/data', []).source).toBe('container')
    expect(classifyLoop('/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/xyz', []).source).toBe('container')
  })

  it('classifies ISO backing files as udisks-iso', () => {
    expect(classifyLoop('/home/user/Downloads/ubuntu-24.04-desktop-amd64.iso', []).source).toBe('udisks-iso')
  })

  it('classifies udisks2 /media mounts as udisks-iso even without .iso path', () => {
    const { source, reason } = classifyLoop('/data/backup.img', [
      { device: '/dev/loop4', mountPoint: '/media/user/backup', fstype: 'iso9660', options: 'ro' },
    ])
    expect(source).toBe('udisks-iso')
    expect(reason).toContain('/media')
  })

  it('classifies AppImage backing files', () => {
    expect(classifyLoop('/home/user/Downloads/SomeTool-2.5.0-x86_64.AppImage', []).source).toBe('appimage')
  })

  it('classifies /tmp/.mount_ mounts as appimage', () => {
    const { source } = classifyLoop('/home/user/Downloads/SomeTool.AppImage', [
      { device: '/dev/loop5', mountPoint: '/tmp/.mount_AppImaXXXXXX', fstype: 'squashfs', options: 'ro' },
    ])
    expect(source).toBe('appimage')
  })

  it('classifies anything else as manual', () => {
    const { source } = classifyLoop('/srv/backup/disk.img', [])
    expect(source).toBe('manual')
  })
})

// ---------------------------------------------------------------------------
// Snapshot assembly over the full fixture
// ---------------------------------------------------------------------------

describe('assembleSnapshot (full fixture)', () => {
  const snap = snapOf(makeRaw())

  it('reports exactly the attached loop devices with correct backing files', () => {
    expect(snap.loopCount).toBe(9)
    expect(snap.loops.map((l) => l.name)).toEqual([
      'loop0', 'loop1', 'loop2', 'loop3', 'loop4', 'loop5', 'loop6', 'loop7', 'loop9',
    ])
    expect(snap.loops.find((l) => l.name === 'loop6')!.backingFile).toBe('/srv/backup/disk.img')
  })

  it('keeps the free/unbacked node out of the attached list', () => {
    expect(snap.freeLoopNodes).toEqual(['loop8'])
    expect(snap.loops.find((l) => l.name === 'loop8')).toBeUndefined()
  })

  it('reports the deleted-backing snap loop with deleted=true', () => {
    const loop9 = snap.loops.find((l) => l.name === 'loop9')!
    expect(loop9.deleted).toBe(true)
    expect(loop9.backingFile).toBe('/var/lib/snapd/snaps/core20_1234.snap')
    expect(loop9.source).toBe('snap')
  })

  it('attaches holder mount points with decoded paths', () => {
    const loop4 = snap.loops.find((l) => l.name === 'loop4')!
    expect(loop4.holderMounts.map((m) => m.mountPoint)).toEqual(['/media/user/Ubuntu 24.04'])
    expect(loop4.holderMounts[0].fstype).toBe('iso9660')
  })

  it('attaches holder PIDs', () => {
    const loop7 = snap.loops.find((l) => l.name === 'loop7')!
    expect(loop7.holderPids).toEqual([{ pid: 1234, fd: '7', target: '/dev/loop7' }])
  })

  it('maps a partition holder mount onto the parent loop device', () => {
    const loop7 = snap.loops.find((l) => l.name === 'loop7')!
    expect(loop7.holderMounts.map((m) => m.mountPoint)).toEqual(['/mnt/legacy-data'])
    expect(loop7.holderMounts[0].device).toBe('/dev/loop7p1')
  })

  it('classifies every source correctly', () => {
    const byName = new Map(snap.loops.map((l) => [l.name, l.source]))
    expect(byName.get('loop0')).toBe('snap')
    expect(byName.get('loop1')).toBe('snap')
    expect(byName.get('loop2')).toBe('container')
    expect(byName.get('loop3')).toBe('container')
    expect(byName.get('loop4')).toBe('udisks-iso')
    expect(byName.get('loop5')).toBe('appimage')
    expect(byName.get('loop6')).toBe('manual')
    expect(byName.get('loop7')).toBe('manual')
    expect(byName.get('loop9')).toBe('snap')
  })

  it('marks exactly the holder-free loops as stale/detachable', () => {
    const byName = new Map(snap.loops.map((l) => [l.name, l]))
    for (const name of ['loop1', 'loop3', 'loop6', 'loop9']) {
      expect(byName.get(name)!.stale).toBe(true)
      expect(byName.get(name)!.detachable).toBe(true)
    }
    for (const name of ['loop0', 'loop2', 'loop4', 'loop5', 'loop7']) {
      expect(byName.get(name)!.stale).toBe(false)
      expect(byName.get(name)!.detachable).toBe(false)
    }
  })

  it('never classifies an in-use loop as detachable — holder mount case', () => {
    const loop0 = snap.loops.find((l) => l.name === 'loop0')!
    expect(loop0.holderMounts.length).toBeGreaterThan(0)
    expect(loop0.detachable).toBe(false)
  })

  it('never classifies an in-use loop as detachable — open fd case', () => {
    const loop7 = snap.loops.find((l) => l.name === 'loop7')!
    expect(loop7.holderPids.length).toBeGreaterThan(0)
    expect(loop7.detachable).toBe(false)
  })

  it('emits the documented JSON schema fields', () => {
    const json = JSON.parse(JSON.stringify(snap))
    expect(Object.keys(json).sort()).toEqual([
      'capturedAt', 'command', 'freeLoopNodes', 'hostname', 'human', 'loopCount',
      'loopSubsystem', 'loops', 'schemaVersion', 'warnings',
    ])
    expect(json.schemaVersion).toBe(1)
    expect(json.command).toBe('snapshot')
    expect(json.loopSubsystem.controlNode).toBe('/dev/loop-control')
    expect(typeof json.capturedAt).toBe('string')
  })
})

describe('assembleSnapshot (zero-loop host)', () => {
  const zeroRaw: RawSources = {
    losetupText: '',
    sysfsBackingFiles: { loop0: null, loop1: null },
    mountsText: '',
    fdTargetsByPid: {},
    sysfsLoopNames: ['loop0', 'loop1'],
    controlNodePresent: false,
  }

  it('reports an honest zero-loop state instead of erroring', () => {
    const snap = snapOf(zeroRaw)
    expect(snap.loopCount).toBe(0)
    expect(snap.loops).toEqual([])
    expect(snap.freeLoopNodes).toEqual(['loop0', 'loop1'])
    expect(snap.human).toContain('no loop devices attached')
    expect(snap.human).toContain('no /dev/loop-control')
    expect(snap.warnings.join(' ')).toContain('/dev/loop-control')
  })

  it('reports the subsystem as unavailable when no nodes exist either', () => {
    const snap = snapOf({
      ...zeroRaw,
      sysfsBackingFiles: {},
      sysfsLoopNames: [],
    })
    expect(snap.loopSubsystem.available).toBe(false)
    expect(snap.warnings.join(' ')).toContain('loop module may be unloaded')
  })

  it('is structurally identical across runs', () => {
    const a = snapOf(zeroRaw)
    const b = assembleSnapshot(zeroRaw, T0)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

// ---------------------------------------------------------------------------
// Churn diffing
// ---------------------------------------------------------------------------

describe('diffSnapshots', () => {
  function snapshotWith(loops: Array<[string, string | null]>, capturedAt: string): LoopSnapshot {
    return assembleSnapshot(
      {
        losetupText: loops
          .map(([name, backing]) =>
            backing === null ? '' : `/dev/${name}: [1048576]:1048577 (${backing})`,
          )
          .join('\n'),
        sysfsBackingFiles: Object.fromEntries(loops.map(([name, backing]) => [name, backing])),
        mountsText: '',
        fdTargetsByPid: {},
        sysfsLoopNames: loops.map(([name]) => name),
        controlNodePresent: true,
      },
      capturedAt,
    )
  }

  it('reports exactly one attach + one detach for a churn pair', () => {
    const before = snapshotWith(
      [['loop0', '/var/lib/snapd/snaps/core20_2318.snap'], ['loop2', '/srv/disk.img']],
      '2026-08-20T00:00:00.000Z',
    )
    const after = snapshotWith(
      [['loop0', '/var/lib/snapd/snaps/core20_2318.snap'], ['loop4', '/srv/new.img']],
      '2026-08-20T00:05:00.000Z',
    )
    const events = diffSnapshots(before, after)
    expect(events).toEqual([
      { device: 'loop2', backingFile: '/srv/disk.img', direction: 'detach', observedAt: '2026-08-20T00:05:00.000Z' },
      { device: 'loop4', backingFile: '/srv/new.img', direction: 'attach', observedAt: '2026-08-20T00:05:00.000Z' },
    ])
  })

  it('reports a rebind of the same loop number as detach + attach', () => {
    const before = snapshotWith([['loop2', '/srv/a.img']], '2026-08-20T00:00:00.000Z')
    const after = snapshotWith([['loop2', '/srv/b.img']], '2026-08-20T00:05:00.000Z')
    const events = diffSnapshots(before, after)
    expect(events).toEqual([
      { device: 'loop2', backingFile: '/srv/a.img', direction: 'detach', observedAt: '2026-08-20T00:05:00.000Z' },
      { device: 'loop2', backingFile: '/srv/b.img', direction: 'attach', observedAt: '2026-08-20T00:05:00.000Z' },
    ])
  })

  it('reports zero events for identical snapshots', () => {
    const a = snapshotWith([['loop0', '/srv/a.img']], '2026-08-20T00:00:00.000Z')
    const b = snapshotWith([['loop0', '/srv/a.img']], '2026-08-20T00:05:00.000Z')
    expect(diffSnapshots(a, b)).toEqual([])
  })

  it('ignores free/unbacked node transitions (not attach/detach events)', () => {
    const before = snapshotWith([], '2026-08-20T00:00:00.000Z')
    const after = snapshotWith([['loop3', null]], '2026-08-20T00:05:00.000Z')
    expect(diffSnapshots(before, after)).toEqual([])
  })
})
