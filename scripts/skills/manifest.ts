import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

export type ProjectSkillConfig = {
  sourceDir: string;
  canonicalDir: string;
  claudeDir: string;
  skills: string[];
};

export type GlobalSkillInstall = {
  source: string;
  skill: string;
  agents: string[];
};

export type SkillInstallConfig = {
  version: number;
  project: ProjectSkillConfig;
  global: GlobalSkillInstall[];
};

type RawSkillInstallConfig = {
  version?: unknown;
  project?: unknown;
  global?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function readSkillName(value: unknown, label: string): string {
  const skill = readString(value, label);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(skill)) {
    throw new Error(`${label} must match /^[a-z0-9][a-z0-9-]*$/`);
  }
  return skill;
}

function readRelativeDir(value: unknown, label: string): string {
  const dir = readString(value, label);
  if (path.isAbsolute(dir)) {
    throw new Error(`${label} must be a repository-relative path`);
  }
  return dir;
}

function dedupeStrings(values: string[], label: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`${label} contains a duplicate entry: ${value}`);
    }
    seen.add(value);
    result.push(value);
  }

  return result;
}

function parseProjectConfig(value: unknown): ProjectSkillConfig {
  if (!isRecord(value)) {
    throw new Error('project must be a YAML object');
  }

  const skillsValue = value.skills;
  if (!Array.isArray(skillsValue) || skillsValue.length === 0) {
    throw new Error('project.skills must be a non-empty array');
  }

  return {
    sourceDir: readRelativeDir(value.source_dir, 'project.source_dir'),
    canonicalDir: readRelativeDir(value.canonical_dir, 'project.canonical_dir'),
    claudeDir: readRelativeDir(value.claude_dir, 'project.claude_dir'),
    skills: dedupeStrings(
      skillsValue.map((skill, index) => readSkillName(skill, `project.skills[${index}]`)),
      'project.skills',
    ),
  };
}

function parseGlobalConfig(value: unknown): GlobalSkillInstall[] {
  if (typeof value === 'undefined') {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('global must be an array');
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`global[${index}] must be a YAML object`);
    }

    const agentsValue = entry.agents;
    if (!Array.isArray(agentsValue) || agentsValue.length === 0) {
      throw new Error(`global[${index}].agents must be a non-empty array`);
    }

    return {
      source: readString(entry.source, `global[${index}].source`),
      skill: readSkillName(entry.skill, `global[${index}].skill`),
      agents: dedupeStrings(
        agentsValue.map((agent, agentIndex) =>
          readString(agent, `global[${index}].agents[${agentIndex}]`),
        ),
        `global[${index}].agents`,
      ),
    };
  });
}

export function getSkillInstallConfigPath(repoRoot: string): string {
  return path.join(repoRoot, 'config', 'skills', 'install.yaml');
}

export async function loadSkillInstallConfig(repoRoot: string): Promise<SkillInstallConfig> {
  const configPath = getSkillInstallConfigPath(repoRoot);
  const content = await readFile(configPath, 'utf8');
  const parsed = YAML.parse(content) as RawSkillInstallConfig;

  if (!isRecord(parsed)) {
    throw new Error(`${path.relative(repoRoot, configPath)} must parse to a YAML object`);
  }

  if (parsed.version !== 1) {
    throw new Error('config/skills/install.yaml version must be 1');
  }

  return {
    version: 1,
    project: parseProjectConfig(parsed.project),
    global: parseGlobalConfig(parsed.global),
  };
}
