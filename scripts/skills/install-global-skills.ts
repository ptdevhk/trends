#!/usr/bin/env -S npx tsx

import { execFile } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadSkillInstallConfig } from './manifest.ts';

const execFileAsync = promisify(execFile);

type CommandRunner = {
  command: string;
  baseArgs: string[];
};

function parseArgs(argv: string[]): void {
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      console.error('Usage: scripts/skills/install-global-skills.ts');
      process.exit(2);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync('sh', ['-lc', `command -v ${command}`], {
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function getRunner(): Promise<CommandRunner> {
  if (await commandExists('bunx')) {
    return { command: 'bunx', baseArgs: ['skills', 'add'] };
  }

  return { command: 'npx', baseArgs: ['--yes', 'skills', 'add'] };
}

async function runInstall(
  runner: CommandRunner,
  source: string,
  agents: string[],
  skills: string[],
): Promise<void> {
  const args = [...runner.baseArgs, source, '-g', '-y'];
  for (const agent of agents) {
    args.push('--agent', agent);
  }
  for (const skill of skills) {
    args.push('--skill', skill);
  }

  console.log(`Installing global skills from ${source}: ${skills.join(', ')} -> ${agents.join(', ')}`);
  try {
    await execFileAsync(runner.command, args, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
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

async function main(): Promise<void> {
  parseArgs(process.argv.slice(2));

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..', '..');
  const config = await loadSkillInstallConfig(repoRoot);

  if (config.global.length === 0) {
    console.log('No global skill installs configured.');
    return;
  }

  const runner = await getRunner();
  const groupedInstalls = new Map<string, { source: string; agents: string[]; skills: string[] }>();

  for (const entry of config.global) {
    const key = `${entry.source}\u0000${entry.agents.join('\u0000')}`;
    const existing = groupedInstalls.get(key);
    if (existing) {
      if (!existing.skills.includes(entry.skill)) {
        existing.skills.push(entry.skill);
      }
      continue;
    }

    groupedInstalls.set(key, {
      source: entry.source,
      agents: [...entry.agents],
      skills: [entry.skill],
    });
  }

  for (const entry of groupedInstalls.values()) {
    await runInstall(runner, entry.source, entry.agents, entry.skills);
  }
}

main().catch((error: unknown) => {
  console.error('Global skill install failed:', error);
  process.exit(1);
});
