#!/usr/bin/env -S npx tsx

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { validateSkillFromRepo } from './skill-validation.ts';

function parseArgs(argv: string[]): { skill: string } {
  let skill: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--skill') {
      const next = argv[index + 1];
      if (typeof next !== 'string' || next.trim().length === 0) {
        throw new Error('Missing value for --skill');
      }
      skill = next.trim();
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      throw new Error('USAGE');
    }
  }

  if (typeof skill !== 'string') {
    throw new Error('--skill is required');
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(skill)) {
    throw new Error(`Invalid skill name: ${skill} (expected /^[a-z0-9][a-z0-9-]*$/)`);
  }

  return { skill };
}

async function run(): Promise<void> {
  const { skill } = parseArgs(process.argv.slice(2));

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..', '..');
  const skillRoot = path.join(repoRoot, 'dev-docs', 'skills', skill);
  await validateSkillFromRepo(repoRoot, skill);

  console.log(`Skill validation passed: ${skillRoot}`);
}

run().catch((error: unknown) => {
  if (error instanceof Error && error.message === 'USAGE') {
    console.error('Usage: scripts/skills/validate-skill.ts --skill <skill-name>');
    process.exit(2);
  }
  console.error('Skill validation failed:', error);
  process.exit(1);
});
