#!/usr/bin/env -S npx tsx

import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

type ValidationFileRule = {
  path: string;
  requiredSections: string[];
};

type ValidationConfig = {
  descriptionTerms?: string[];
  command?: ValidationFileRule;
  rules?: ValidationFileRule;
};

type Frontmatter = {
  name: string;
  description: string;
  validation?: ValidationConfig;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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

async function ensureFileExists(absolutePath: string): Promise<void> {
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
  const allowedKeys = ['description', 'name', 'validation'];
  const unexpected = keys.filter((key) => !allowedKeys.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`SKILL.md frontmatter has unexpected keys: ${unexpected.join(', ')}`);
  }

  const nameValue = parsed.name;
  const descriptionValue = parsed.description;
  if (typeof nameValue !== 'string' || nameValue.trim().length === 0) {
    throw new Error('SKILL.md frontmatter "name" must be a non-empty string');
  }
  if (typeof descriptionValue !== 'string' || descriptionValue.trim().length === 0) {
    throw new Error('SKILL.md frontmatter "description" must be a non-empty string');
  }

  const validationValue = parsed.validation;
  let validation: ValidationConfig | undefined;
  if (typeof validationValue !== 'undefined') {
    if (!isRecord(validationValue)) {
      throw new Error('SKILL.md frontmatter "validation" must be a YAML object');
    }

    const descriptionTermsValue = validationValue.descriptionTerms;
    const commandValue = validationValue.command;
    const rulesValue = validationValue.rules;

    const result: ValidationConfig = {};

    if (typeof descriptionTermsValue !== 'undefined') {
      if (!Array.isArray(descriptionTermsValue) || !descriptionTermsValue.every((term) => typeof term === 'string' && term.trim().length > 0)) {
        throw new Error('"validation.descriptionTerms" must be a non-empty string array');
      }
      result.descriptionTerms = descriptionTermsValue.map((term) => term.trim());
    }

    const parseFileRule = (value: unknown, label: 'command' | 'rules'): ValidationFileRule => {
      if (!isRecord(value)) {
        throw new Error(`"validation.${label}" must be a YAML object`);
      }
      const pathValue = value.path;
      const requiredSectionsValue = value.requiredSections;
      if (typeof pathValue !== 'string' || pathValue.trim().length === 0) {
        throw new Error(`"validation.${label}.path" must be a non-empty string`);
      }
      if (!Array.isArray(requiredSectionsValue) || requiredSectionsValue.length === 0) {
        throw new Error(`"validation.${label}.requiredSections" must be a non-empty string array`);
      }
      if (!requiredSectionsValue.every((section) => typeof section === 'string' && section.trim().length > 0)) {
        throw new Error(`"validation.${label}.requiredSections" must contain only non-empty strings`);
      }
      return {
        path: pathValue.trim(),
        requiredSections: requiredSectionsValue.map((section) => section.trim()),
      };
    };

    if (typeof commandValue !== 'undefined') {
      result.command = parseFileRule(commandValue, 'command');
    }
    if (typeof rulesValue !== 'undefined') {
      result.rules = parseFileRule(rulesValue, 'rules');
    }

    validation = result;
  }

  return {
    name: nameValue.trim(),
    description: descriptionValue.trim(),
    validation,
  };
}

function validateDescriptionTerms(description: string, terms: string[]): void {
  const lowered = description.toLowerCase();
  const missing = terms.filter((term) => !lowered.includes(term.toLowerCase()));
  if (missing.length > 0) {
    throw new Error(`SKILL.md description must include trigger terms: ${missing.join(', ')}`);
  }
}

async function validateFileRule(repoRoot: string, rule: ValidationFileRule, label: string): Promise<void> {
  const absolutePath = path.join(repoRoot, rule.path);
  try {
    await access(absolutePath);
  } catch {
    throw new Error(`Missing ${label} file: ${rule.path}`);
  }

  const content = await readFile(absolutePath, 'utf8');
  if (content.trim().length === 0) {
    throw new Error(`${label} file is empty: ${rule.path}`);
  }

  const missingSections = rule.requiredSections.filter((section) => !content.includes(section));
  if (missingSections.length > 0) {
    throw new Error(`${label} file missing sections: ${missingSections.join(', ')} (${rule.path})`);
  }
}

async function warnIfReferencesMissing(skillRoot: string): Promise<void> {
  const referencesDir = path.join(skillRoot, 'references');
  try {
    const stats = await stat(referencesDir);
    if (!stats.isDirectory()) {
      console.warn('Optional skill references directory is not a directory:', referencesDir);
      return;
    }
  } catch {
    console.warn('Optional skill references directory is missing:', referencesDir);
    return;
  }

  const entries = await readdir(referencesDir, { withFileTypes: true });
  const hasFiles = entries.some((entry) => entry.isFile());
  if (!hasFiles) {
    console.warn('Optional skill references directory has no files:', referencesDir);
  }
}

async function run(): Promise<void> {
  const { skill } = parseArgs(process.argv.slice(2));

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..', '..');
  const skillRoot = path.join(repoRoot, 'dev-docs', 'skills', skill);

  const requiredFiles = [
    'SKILL.md',
    path.join('agents', 'openai.yaml'),
  ];

  const missingRequired: string[] = [];
  for (const relativePath of requiredFiles) {
    try {
      await ensureFileExists(path.join(skillRoot, relativePath));
    } catch {
      missingRequired.push(relativePath);
    }
  }
  if (missingRequired.length > 0) {
    throw new Error(`Missing required skill files: ${missingRequired.join(', ')}`);
  }

  const skillContent = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const frontmatter = parseFrontmatter(skillContent);
  if (frontmatter.name !== skill) {
    throw new Error(`SKILL.md frontmatter name must be "${skill}"`);
  }

  if (frontmatter.validation?.descriptionTerms) {
    validateDescriptionTerms(frontmatter.description, frontmatter.validation.descriptionTerms);
  }

  await warnIfReferencesMissing(skillRoot);

  if (frontmatter.validation?.command) {
    await validateFileRule(repoRoot, frontmatter.validation.command, 'Claude command');
  }

  if (frontmatter.validation?.rules) {
    await validateFileRule(repoRoot, frontmatter.validation.rules, 'Claude rules');
  }

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

