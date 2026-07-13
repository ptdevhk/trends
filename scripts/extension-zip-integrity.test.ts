import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CHECKER_PATH = path.join(REPO_ROOT, 'scripts/check-extension-zip-integrity.sh')
const DEV_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/dev.sh')
const VERSION = '1.3.0'

const tempDirs: string[] = []

interface Fixture {
  root: string
  manifestPath: string
  metadataPath: string
  outputDir: string
  versionedZipPath: string
  latestZipPath: string
}

function createArchive(
  root: string,
  archivePath: string,
  manifestVersion = VERSION,
  manifestEntry = 'manifest.json',
): void {
  const stagingDir = mkdtempSync(path.join(root, 'archive-'))
  const stagedManifestPath = path.join(stagingDir, manifestEntry)
  mkdirSync(path.dirname(stagedManifestPath), { recursive: true })
  writeFileSync(
    stagedManifestPath,
    JSON.stringify({ manifest_version: 3, name: 'Test extension', version: manifestVersion }),
  )

  const result = spawnSync('zip', ['-q', archivePath, manifestEntry], {
    cwd: stagingDir,
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(`Failed to create ZIP fixture: ${result.stderr}`)
  }
}

function createFixture(options: { metadataVersion?: string; metadataFilename?: string } = {}): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'trends-extension-zip-'))
  tempDirs.push(root)

  const manifestPath = path.join(root, 'manifest.json')
  const metadataPath = path.join(root, 'extension-meta.json')
  const outputDir = path.join(root, 'extension')
  const versionedFilename = `trends-resume-collector-v${VERSION}.zip`
  const versionedZipPath = path.join(outputDir, versionedFilename)
  const latestZipPath = path.join(outputDir, 'trends-resume-collector-latest.zip')

  mkdirSync(outputDir, { recursive: true })
  writeFileSync(
    manifestPath,
    JSON.stringify({ manifest_version: 3, name: 'Source extension', version: VERSION }),
  )
  writeFileSync(
    metadataPath,
    JSON.stringify({
      version: options.metadataVersion ?? VERSION,
      filename: options.metadataFilename ?? versionedFilename,
      updatedAt: '2026-07-14T00:00:00Z',
    }),
  )
  createArchive(root, versionedZipPath)
  copyFileSync(versionedZipPath, latestZipPath)

  return {
    root,
    manifestPath,
    metadataPath,
    outputDir,
    versionedZipPath,
    latestZipPath,
  }
}

function runChecker(fixture: Fixture) {
  return spawnSync(
    CHECKER_PATH,
    [fixture.manifestPath, fixture.metadataPath, fixture.outputDir],
    { encoding: 'utf8' },
  )
}

function checkerOutput(result: ReturnType<typeof runChecker>): string {
  return [result.stdout, result.stderr].filter(Boolean).join('\n')
}

function expectCheckerToPass(fixture: Fixture): void {
  const result = runChecker(fixture)
  expect(result.error).toBeUndefined()
  expect(result.status, checkerOutput(result)).toBe(0)
}

function expectCheckerToFail(fixture: Fixture): void {
  const result = runChecker(fixture)
  expect(result.error).toBeUndefined()
  expect(result.status, checkerOutput(result)).not.toBe(0)
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('browser extension ZIP integrity checker', () => {
  it('accepts metadata and archives that match the source manifest', () => {
    expectCheckerToPass(createFixture())
  })

  it('accepts the relative latest symlink created by the canonical builder', () => {
    const fixture = createFixture()
    rmSync(fixture.latestZipPath)
    symlinkSync(path.basename(fixture.versionedZipPath), fixture.latestZipPath)

    expectCheckerToPass(fixture)
  })

  it('rejects a missing latest archive', () => {
    const fixture = createFixture()
    rmSync(fixture.latestZipPath)

    expectCheckerToFail(fixture)
  })

  it('rejects a missing versioned archive', () => {
    const fixture = createFixture()
    rmSync(fixture.versionedZipPath)

    expectCheckerToFail(fixture)
  })

  it('rejects a corrupt versioned archive', () => {
    const fixture = createFixture()
    writeFileSync(fixture.versionedZipPath, 'not a zip archive')

    expectCheckerToFail(fixture)
  })

  it('rejects an HTML response saved as the latest archive', () => {
    const fixture = createFixture()
    writeFileSync(fixture.latestZipPath, '<!doctype html><title>Not found</title>')

    expectCheckerToFail(fixture)
  })

  it.each(['versioned', 'latest'] as const)(
    'rejects a %s archive whose embedded manifest version is stale',
    (archive) => {
      const fixture = createFixture()
      const archivePath = archive === 'versioned' ? fixture.versionedZipPath : fixture.latestZipPath
      rmSync(archivePath)
      createArchive(fixture.root, archivePath, '1.2.9')

      expectCheckerToFail(fixture)
    },
  )

  it('rejects an archive that has only a nested manifest.json', () => {
    const fixture = createFixture()
    rmSync(fixture.versionedZipPath)
    createArchive(fixture.root, fixture.versionedZipPath, VERSION, 'nested/manifest.json')

    expectCheckerToFail(fixture)
  })

  it('rejects metadata whose version differs from the source manifest', () => {
    const fixture = createFixture({ metadataVersion: '1.2.9' })

    expectCheckerToFail(fixture)
  })

  it('rejects metadata that names a different versioned archive', () => {
    const fixture = createFixture({ metadataFilename: 'trends-resume-collector-v1.2.9.zip' })

    expectCheckerToFail(fixture)
  })
})

describe('browser extension ZIP integrity wiring', () => {
  it('makes dev startup check archive integrity and rebuild through the canonical builder', () => {
    const devScript = readFileSync(DEV_SCRIPT_PATH, 'utf8')
    const startWebStart = devScript.indexOf('start_web() {')
    const startApiStart = devScript.indexOf('\n# Start BFF API', startWebStart)
    const startWeb = devScript.slice(startWebStart, startApiStart)
    const checkerIndex = startWeb.indexOf('if ! "$extension_integrity_checker"')
    const builderIndex = startWeb.indexOf('"$PROJECT_ROOT/scripts/build-extension-zip.sh"')

    expect(startWebStart).toBeGreaterThanOrEqual(0)
    expect(startApiStart).toBeGreaterThan(startWebStart)
    expect(startWeb).toContain(
      'local extension_integrity_checker="$PROJECT_ROOT/scripts/check-extension-zip-integrity.sh"',
    )
    expect(checkerIndex).toBeGreaterThanOrEqual(0)
    expect(builderIndex).toBeGreaterThan(checkerIndex)
  })
})
