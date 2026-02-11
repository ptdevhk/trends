#!/usr/bin/env -S npx tsx

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const skillRoot = path.join(repoRoot, 'dev-docs', 'skills', 'trends-agent-governance');
const claudeCommandPath = path.join(repoRoot, '.claude', 'commands', 'trends-agent-governance.md');

const requiredFiles = [
  'SKILL.md',
  path.join('agents', 'openai.yaml'),
];

const optionalFiles = [
  path.join('references', 'source-matrix.md'),
  path.join('references', 'evidence-template.md'),
];

type Frontmatter = {
  name: string;
  description: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function ensureFileExists(relativePath: string): Promise<void> {
  const absolutePath = path.join(skillRoot, relativePath);
  await access(absolutePath);
}

function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    throw new Error('SKILL.md must start with YAML frontmatter');
  }

  const parsed = YAML.parse(match[1]);
  if (!isRecord(parsed)) {
    throw new Error('SKILL.md frontmatter must be a YAML object');
  }

  const keys = Object.keys(parsed).sort();
  const expectedKeys = ['description', 'name'];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('SKILL.md frontmatter must contain only "name" and "description" keys');
  }

  const nameValue = parsed.name;
  const descriptionValue = parsed.description;

  if (typeof nameValue !== 'string' || nameValue.trim().length === 0) {
    throw new Error('SKILL.md frontmatter "name" must be a non-empty string');
  }
  if (typeof descriptionValue !== 'string' || descriptionValue.trim().length === 0) {
    throw new Error('SKILL.md frontmatter "description" must be a non-empty string');
  }

  return {
    name: nameValue.trim(),
    description: descriptionValue.trim(),
  };
}

function validateDescriptionCoverage(description: string): void {
  const lowered = description.toLowerCase();
  const requiredTerms = ['architecture', 'design', 'library', 'api'];
  const missing = requiredTerms.filter((term) => !lowered.includes(term));
  if (missing.length > 0) {
    throw new Error(`SKILL.md description must include trigger terms: ${missing.join(', ')}`);
  }
}

async function run(): Promise<void> {
  const missingRequired: string[] = [];
  for (const file of requiredFiles) {
    try {
      await ensureFileExists(file);
    } catch {
      missingRequired.push(file);
    }
  }

  if (missingRequired.length > 0) {
    throw new Error(`Missing required skill files: ${missingRequired.join(', ')}`);
  }

  const skillContent = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const frontmatter = parseFrontmatter(skillContent);
  if (frontmatter.name !== 'trends-agent-governance') {
    throw new Error('SKILL.md frontmatter name must be "trends-agent-governance"');
  }
  validateDescriptionCoverage(frontmatter.description);

  const missingOptional: string[] = [];
  for (const file of optionalFiles) {
    try {
      await ensureFileExists(file);
    } catch {
      missingOptional.push(file);
    }
  }

  if (missingOptional.length > 0) {
    console.warn(`Optional skill files are missing: ${missingOptional.join(', ')}`);
  }

  try {
    await access(claudeCommandPath);
  } catch {
    throw new Error(`Missing Claude Code command file: ${claudeCommandPath}`);
  }

  const claudeCommandContent = await readFile(claudeCommandPath, 'utf8');
  if (claudeCommandContent.trim().length === 0) {
    throw new Error(`Claude Code command file is empty: ${claudeCommandPath}`);
  }

  const requiredSections = ['Source Matrix', 'Evidence Template', 'Workflow'];
  const missingSections = requiredSections.filter((section) => !claudeCommandContent.includes(section));
  if (missingSections.length > 0) {
    throw new Error(`Claude Code command missing sections: ${missingSections.join(', ')}`);
  }

  console.log(`Skill validation passed: ${skillRoot}`);
}

run().catch((error: unknown) => {
  console.error('Skill validation failed:', error);
  process.exit(1);
});
