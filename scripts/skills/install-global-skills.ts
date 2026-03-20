#!/usr/bin/env -S npx tsx

import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadSkillInstallConfig } from './manifest.ts';

const execFileAsync = promisify(execFile);

function parseArgs(argv: string[]): void {
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      console.error('Usage: scripts/skills/install-global-skills.ts');
      process.exit(2);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
}

async function ensureTool(command: string): Promise<void> {
  try {
    await execFileAsync('sh', ['-lc', `command -v ${command}`], { maxBuffer: 1024 * 1024 });
  } catch {
    throw new Error(`Missing required tool: ${command}`);
  }
}

async function runCommand(command: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(command, args, {
      cwd: process.cwd(),
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    if (error instanceof Error) {
      const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
      const stdout = 'stdout' in error && typeof error.stdout === 'string' ? error.stdout.trim() : '';
      const detail = stderr || stdout;
      if (detail.length > 0) {
        throw new Error(detail);
      }
    }
    throw error;
  }
}

async function syncDirectory(sourceDir: string, destDir: string): Promise<void> {
  const current = await lstat(destDir).catch(() => null);
  if (current && !current.isDirectory()) {
    await rm(destDir, { recursive: true, force: true });
  }

  await mkdir(destDir, { recursive: true });
  await runCommand('rsync', ['-a', '--delete', `${sourceDir}/`, `${destDir}/`]);
}

function getAgentRoot(agent: string): string {
  if (agent === 'codex') {
    const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
    return path.join(codexHome, 'skills');
  }
  if (agent === 'claude-code') {
    const claudeHome = process.env.CLAUDE_HOME?.trim() || path.join(os.homedir(), '.claude');
    return path.join(claudeHome, 'skills');
  }

  throw new Error(`Unsupported global skill agent: ${agent}`);
}

function ensureRelativeSkillPath(skillPath: string): string {
  if (path.isAbsolute(skillPath)) {
    throw new Error(`Global skill path must be repository-relative: ${skillPath}`);
  }

  const normalized = path.normalize(skillPath);
  if (normalized.startsWith('..')) {
    throw new Error(`Global skill path cannot traverse outside the source repo: ${skillPath}`);
  }

  return normalized;
}

async function validateExternalSkillDir(skillDir: string): Promise<void> {
  const statResult = await lstat(skillDir).catch(() => null);
  if (!statResult?.isDirectory()) {
    throw new Error(`Missing external skill directory: ${skillDir}`);
  }

  const skillFile = path.join(skillDir, 'SKILL.md');
  const content = await readFile(skillFile, 'utf8').catch(() => {
    throw new Error(`Missing SKILL.md in external skill directory: ${skillDir}`);
  });

  if (!content.startsWith('---\n')) {
    throw new Error(`External SKILL.md is missing YAML frontmatter: ${skillFile}`);
  }
}

async function cloneSource(source: string): Promise<string> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'trends-global-skills-'));
  const repoDir = path.join(tempRoot, 'repo');

  try {
    await runCommand('git', ['clone', '--depth', '1', source, repoDir]);
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }

  return tempRoot;
}

async function main(): Promise<void> {
  parseArgs(process.argv.slice(2));
  await ensureTool('git');
  await ensureTool('rsync');

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..', '..');
  const config = await loadSkillInstallConfig(repoRoot);

  if (config.global.length === 0) {
    console.log('No global skill installs configured.');
    return;
  }

  const sourceRoots = new Map<string, string>();

  try {
    for (const entry of config.global) {
      let tempRoot = sourceRoots.get(entry.source);
      if (!tempRoot) {
        console.log(`Cloning global skill source: ${entry.source}`);
        tempRoot = await cloneSource(entry.source);
        sourceRoots.set(entry.source, tempRoot);
      }

      const skillDir = path.join(tempRoot, 'repo', ensureRelativeSkillPath(entry.path));
      await validateExternalSkillDir(skillDir);

      for (const agent of entry.agents) {
        const targetRoot = getAgentRoot(agent);
        const targetDir = path.join(targetRoot, entry.skill);

        console.log(`Installing global skill ${entry.skill} -> ${targetDir}`);
        await syncDirectory(skillDir, targetDir);
      }
    }
  } finally {
    for (const tempRoot of sourceRoots.values()) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error: unknown) => {
  console.error('Global skill install failed:', error);
  process.exit(1);
});
