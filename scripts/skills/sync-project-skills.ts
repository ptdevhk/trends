#!/usr/bin/env -S npx tsx

import { execFile } from 'node:child_process';
import { mkdir, readdir, readlink, lstat, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadSkillInstallConfig } from './manifest.ts';
import { validateSkillFromRepo } from './skill-validation.ts';

const execFileAsync = promisify(execFile);

type ParsedArgs = {
  check: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  let check = false;

  for (const arg of argv) {
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.error('Usage: scripts/skills/sync-project-skills.ts [--check]');
      process.exit(2);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { check };
}

async function ensureTool(name: string): Promise<void> {
  try {
    await execFileAsync('sh', ['-lc', `command -v ${name}`]);
  } catch {
    throw new Error(`Missing required tool: ${name}`);
  }
}

async function runRsync(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('rsync', args, {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

async function syncDirectory(sourceDir: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  await runRsync(['-a', '--delete', `${sourceDir}/`, `${destDir}/`]);
}

async function checkDirectoryDrift(sourceDir: string, destDir: string): Promise<void> {
  const output = await runRsync([
    '--dry-run',
    '--itemize-changes',
    '--recursive',
    '--links',
    '--perms',
    '--checksum',
    '--delete',
    `${sourceDir}/`,
    `${destDir}/`,
  ]);

  if (output.length > 0) {
    throw new Error(`Installed project skill drift detected at ${destDir}\n${output}`);
  }
}

async function removeEntry(targetPath: string): Promise<void> {
  await rm(targetPath, { recursive: true, force: true });
}

async function syncManagedDir(baseDir: string, expectedNames: Set<string>, check: boolean): Promise<void> {
  const entries = await readdir(baseDir, { withFileTypes: true }).catch((error: unknown) => {
    if (check) {
      throw error;
    }
    return [];
  });

  for (const entry of entries) {
    if (expectedNames.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(baseDir, entry.name);
    if (check) {
      throw new Error(`Unexpected managed skill entry: ${entryPath}`);
    }
    await removeEntry(entryPath);
  }
}

function expectedClaudeSymlinkTarget(skill: string): string {
  return path.join('..', '..', '.agents', 'skills', skill);
}

async function syncClaudeSymlink(linkPath: string, targetPath: string): Promise<void> {
  try {
    const stats = await lstat(linkPath);
    if (stats.isSymbolicLink()) {
      const currentTarget = await readlink(linkPath);
      if (currentTarget === targetPath) {
        return;
      }
    }
    await removeEntry(linkPath);
  } catch {
    // Create a fresh symlink below.
  }

  await symlink(targetPath, linkPath);
}

async function checkClaudeSymlink(linkPath: string): Promise<void> {
  const expectedLink = expectedClaudeSymlinkTarget(path.basename(linkPath));
  const stats = await lstat(linkPath).catch(() => null);
  if (!stats) {
    throw new Error(`Missing Claude skill symlink: ${linkPath}`);
  }
  if (!stats.isSymbolicLink()) {
    throw new Error(`Claude skill entry must be a symlink: ${linkPath}`);
  }
  const currentTarget = await readlink(linkPath);
  if (currentTarget !== expectedLink) {
    throw new Error(
      `Claude skill symlink mismatch at ${linkPath}: expected ${expectedLink}, found ${currentTarget}`,
    );
  }
}

async function main(): Promise<void> {
  const { check } = parseArgs(process.argv.slice(2));
  await ensureTool('rsync');

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..', '..');
  const config = await loadSkillInstallConfig(repoRoot);

  const projectSourceRoot = path.join(repoRoot, config.project.sourceDir);
  const canonicalRoot = path.join(repoRoot, config.project.canonicalDir);
  const claudeRoot = path.join(repoRoot, config.project.claudeDir);

  if (!check) {
    await mkdir(canonicalRoot, { recursive: true });
    await mkdir(claudeRoot, { recursive: true });
  }

  const expectedSkills = new Set(config.project.skills);
  await syncManagedDir(canonicalRoot, expectedSkills, check);
  await syncManagedDir(claudeRoot, expectedSkills, check);

  for (const skill of config.project.skills) {
    await validateSkillFromRepo(repoRoot, skill);

    const sourceDir = path.join(projectSourceRoot, skill);
    const canonicalDir = path.join(canonicalRoot, skill);
    const claudeLinkPath = path.join(claudeRoot, skill);

    if (check) {
      await checkDirectoryDrift(sourceDir, canonicalDir);
      await checkClaudeSymlink(claudeLinkPath);
      continue;
    }

    await syncDirectory(sourceDir, canonicalDir);
    await syncClaudeSymlink(claudeLinkPath, expectedClaudeSymlinkTarget(skill));
  }

  console.log(
    check
      ? `Project skills are in sync: ${config.project.skills.join(', ')}`
      : `Synced project skills: ${config.project.skills.join(', ')}`,
  );
}

main().catch((error: unknown) => {
  console.error('Project skill sync failed:', error);
  process.exit(1);
});
