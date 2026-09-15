/**
 * OpenAPI version-surface extractors.
 * Missing or non-semver values are unverifiable (null), not green.
 */

const SEMVER = /^\d+\.\d+\.\d+$/;

function asSemver(value: unknown): string | null {
  return typeof value === "string" && SEMVER.test(value) ? value : null;
}

export function healthExampleFromOpenApiYaml(text: string): string | null {
  const match = text.match(
    /HealthResponse:[\s\S]*?version:\s*\n\s*type:\s*string\s*\n\s*example:\s*'(\d+\.\d+\.\d+)'/,
  );
  return match?.[1] ?? null;
}

export function healthExampleFromOpenApiJson(text: string): string | null {
  try {
    const doc = JSON.parse(text) as {
      components?: {
        schemas?: {
          HealthResponse?: { properties?: { version?: { example?: unknown } } };
        };
      };
    };
    return asSemver(doc.components?.schemas?.HealthResponse?.properties?.version?.example);
  } catch {
    return null;
  }
}

export function infoVersionFromOpenApiJson(text: string): string | null {
  try {
    const doc = JSON.parse(text) as { info?: { version?: unknown } };
    return asSemver(doc.info?.version);
  } catch {
    return null;
  }
}

export function infoVersionFromOpenApiYaml(text: string): string | null {
  const match = text.match(/^\s{2}version:\s*(\d+\.\d+\.\d+)\s*$/m);
  return match?.[1] ?? null;
}

export function apiTypesSemverExample(text: string): string | null {
  const match = text.match(/@example\s+(\d+\.\d+\.\d+)/);
  return match?.[1] ?? null;
}

export function configTsVersion(text: string): string | null {
  const match = text.match(/^\s*version:\s*"(\d+\.\d+\.\d+)"/m);
  return match?.[1] ?? null;
}

export function packageJsonVersion(text: string): string | null {
  try {
    const doc = JSON.parse(text) as { version?: unknown };
    return asSemver(doc.version);
  } catch {
    return null;
  }
}

export type E2eVersionKey = "appVersion" | "apiVersion" | "webVersion";

export function e2eQuotedVersion(text: string, key: E2eVersionKey): string | null {
  const match = text.match(new RegExp(`${key}:\\s*'(\\d+\\.\\d+\\.\\d+)'`));
  return match?.[1] ?? null;
}
