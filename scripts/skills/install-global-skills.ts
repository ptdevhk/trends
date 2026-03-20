#!/usr/bin/env -S npx tsx

import { execFile } from 'node:child_process';
import { lstat, rm } from 'node:fs/promises';
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

function getCodexLegacyInstallPath(skill: string): string {
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
  return path.join(codexHome, 'skills', skill);
}

async function cleanupLegacyCodexInstall(skill: string): Promise<void> {
  const target = getCodexLegacyInstallPath(skill);
  const stats = await lstat(target).catch(() => null);
  if (!stats) {
    return;
  }

  console.log(`Removing stale Codex-specific copy: ${target}`);
  await rm(target, { recursive: true, force: true });
}

async function installGlobalSkill(source: string, agents: string[]): Promise<void> {
  const args = ['--yes', 'skills', 'add', '-g', source];
  for (const agent of agents) {
    args.push('--agent', agent);
  }
  args.push('-y');

  await runCommand('npx', args);
}

async function main(): Promise<void> {
  parseArgs(process.argv.slice(2));
  await ensureTool('npx');

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..', '..');
  const config = await loadSkillInstallConfig(repoRoot);

  if (config.global.length === 0) {
    console.log('No global skill installs configured.');
    return;
  }

  for (const entry of config.global) {
    if (entry.agents.includes('codex')) {
      await cleanupLegacyCodexInstall(entry.skill);
    }

    console.log(`Installing global skill via skills CLI: ${entry.source}`);
    await installGlobalSkill(entry.source, entry.agents);
  }
}

main().catch((error: unknown) => {
  console.error('Global skill install failed:', error);
  process.exit(1);
});
