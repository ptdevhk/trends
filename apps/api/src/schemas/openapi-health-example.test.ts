import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  apiTypesSemverExample,
  configTsVersion,
  healthExampleFromOpenApiJson,
  healthExampleFromOpenApiYaml,
  infoVersionFromOpenApiJson,
  infoVersionFromOpenApiYaml,
  packageJsonVersion,
} from "../../../../scripts/lib/openapi-health-example";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..", "..");

function canonicalVersion(): string {
  return readFileSync(resolve(repoRoot, "version"), "utf8").trim();
}

describe("OpenAPI HealthResponse version example", () => {
  it("locks yaml, json, and schema examples to the canonical version (fail if missing or stale)", () => {
    const expected = canonicalVersion();
    expect(expected).toMatch(/^\d+\.\d+\.\d+$/);

    const yamlText = readFileSync(resolve(repoRoot, "apps/api/openapi.yaml"), "utf8");
    const yamlExample = healthExampleFromOpenApiYaml(yamlText);
    const yamlInfo = infoVersionFromOpenApiYaml(yamlText);
    expect(yamlInfo, "apps/api/openapi.yaml info.version missing").not.toBeNull();
    expect(yamlInfo, "apps/api/openapi.yaml info.version stale").toBe(expected);
    expect(yamlExample, "apps/api/openapi.yaml HealthResponse example missing").not.toBeNull();
    expect(yamlExample, "apps/api/openapi.yaml HealthResponse example stale").toBe(expected);

    const jsonText = readFileSync(resolve(repoRoot, "apps/api/openapi.json"), "utf8");
    const jsonExample = healthExampleFromOpenApiJson(jsonText);
    expect(jsonExample, "apps/api/openapi.json HealthResponse example missing").not.toBeNull();
    expect(jsonExample, "apps/api/openapi.json HealthResponse example stale").toBe(expected);
    expect(yamlExample, "openapi.yaml vs openapi.json HealthResponse example disagree").toBe(
      jsonExample,
    );
    const jsonInfo = infoVersionFromOpenApiJson(jsonText);
    expect(jsonInfo, "apps/api/openapi.json info.version missing").not.toBeNull();
    expect(jsonInfo, "apps/api/openapi.json info.version stale").toBe(expected);
    expect(yamlInfo, "openapi.yaml vs openapi.json info.version disagree").toBe(jsonInfo);

    const schema = readFileSync(resolve(repoRoot, "apps/api/src/schemas/health.ts"), "utf8");
    const schemaExample = schema.match(/version:[\s\S]*?example:\s*"(\d+\.\d+\.\d+)"/)?.[1];
    expect(schemaExample, "apps/api/src/schemas/health.ts OpenAPI example").toBe(expected);
    expect(schemaExample, "health.ts vs openapi.json HealthResponse example disagree").toBe(
      jsonExample,
    );

    const apiTypes = readFileSync(resolve(repoRoot, "apps/web/src/lib/api-types.ts"), "utf8");
    const apiTypesExample = apiTypesSemverExample(apiTypes);
    expect(apiTypesExample, "api-types @example missing").not.toBeNull();
    expect(apiTypesExample, "api-types vs openapi.json HealthResponse example disagree").toBe(
      jsonExample,
    );
    expect(apiTypesExample, "api-types vs openapi.yaml HealthResponse example disagree").toBe(
      yamlExample,
    );
    expect(apiTypesExample, "api-types vs health.ts example disagree").toBe(schemaExample);

    const config = readFileSync(resolve(repoRoot, "apps/api/src/services/config.ts"), "utf8");
    const configVersion = configTsVersion(config);
    expect(configVersion, "apps/api/src/services/config.ts version missing").not.toBeNull();
    expect(configVersion, "apps/api/src/services/config.ts version stale").toBe(expected);

    const schemaValidation = readFileSync(
      resolve(repoRoot, "apps/api/src/schemas/schemas-validation.test.ts"),
      "utf8",
    );
    const schemaValidationVersion = configTsVersion(schemaValidation);
    expect(schemaValidationVersion, "schemas-validation.test.ts version missing").not.toBeNull();
    expect(schemaValidationVersion, "schemas-validation.test.ts version stale").toBe(expected);

    const apiPackage = readFileSync(resolve(repoRoot, "apps/api/package.json"), "utf8");
    const apiPackageVersion = packageJsonVersion(apiPackage);
    expect(apiPackageVersion, "apps/api/package.json version missing").not.toBeNull();
    expect(apiPackageVersion, "apps/api/package.json version stale").toBe(expected);

    for (const rel of [
      "package.json",
      "apps/web/package.json",
      "packages/shared/package.json",
      "packages/convex/package.json",
      "apps/browser-extension/package.json",
    ]) {
      const pkgVersion = packageJsonVersion(readFileSync(resolve(repoRoot, rel), "utf8"));
      expect(pkgVersion, `${rel} version missing`).not.toBeNull();
      expect(pkgVersion, `${rel} version stale`).toBe(expected);
    }

    const e2e = readFileSync(resolve(repoRoot, "apps/web/e2e/resume-role-filter.spec.ts"), "utf8");
    const e2eVersions = [...e2e.matchAll(/(?:app|api|web)Version: '(\d+\.\d+\.\d+)'/g)].map((m) => m[1]);
    expect(e2eVersions.length, "e2e system-metadata version fixtures missing").toBe(3);
    expect(new Set(e2eVersions), "e2e system-metadata version fixtures stale").toEqual(new Set([expected]));
  });

  it("bump-version.sh updates and fail-closes openapi.json HealthResponse example", () => {
    const bump = readFileSync(resolve(repoRoot, "scripts/bump-version.sh"), "utf8");
    expect(bump).toContain("apps/api/openapi.json");
    expect(bump).toMatch(/--include='openapi\.json'/);
    expect(bump).toMatch(/--include='package\.json'/);
    expect(bump).toMatch(/ERROR: OpenAPI JSON info\.version is missing/);
    expect(bump).toMatch(/ERROR: OpenAPI yaml\/json info\.version disagree/);
    expect(bump).toMatch(/ERROR: OpenAPI JSON HealthResponse example is missing/);
    expect(bump).toMatch(/ERROR: OpenAPI JSON HealthResponse example is /);
    expect(bump).not.toMatch(/grep -v 'openapi\\.json'/);
    expect(bump).toMatch(/ERROR: Stale '\$CURRENT' references remain/);
    expect(bump).not.toMatch(/WARNING: Stale '\$CURRENT' references remain/);
    expect(bump).toContain("apps/web/e2e/resume-role-filter.spec.ts");
    expect(bump).toContain("apps/api/src/schemas/schemas-validation.test.ts");
    expect(bump).toMatch(/ERROR: api-types @example is missing/);
    expect(bump).toMatch(/ERROR: api-types @example is not \$NEW_VERSION/);
    expect(bump).toMatch(/ERROR: health\.ts example is missing/);
    expect(bump).toMatch(/ERROR: health\.ts example is not \$NEW_VERSION/);
    expect(bump).toMatch(/ERROR: OpenAPI yaml HealthResponse example is missing/);
    expect(bump).toMatch(/ERROR: OpenAPI yaml HealthResponse example is not \$NEW_VERSION/);
    expect(bump).toMatch(/ERROR: config\.ts version is missing/);
    expect(bump).toMatch(/ERROR: config\.ts version is not \$NEW_VERSION/);
    expect(bump).toMatch(/ERROR: schemas-validation\.test\.ts version is missing/);
    expect(bump).toMatch(/ERROR: schemas-validation\.test\.ts version is not \$NEW_VERSION/);
    expect(bump).toMatch(/ERROR: e2e appVersion is missing/);
    expect(bump).toMatch(/ERROR: e2e appVersion is not \$NEW_VERSION/);
    expect(bump).toMatch(/ERROR: e2e apiVersion is missing/);
    expect(bump).toMatch(/ERROR: e2e apiVersion is not \$NEW_VERSION/);
    expect(bump).toMatch(/ERROR: e2e webVersion is missing/);
    expect(bump).toMatch(/ERROR: e2e webVersion is not \$NEW_VERSION/);
    expect(bump).toMatch(/ERROR: pyproject.toml version is missing/);
    expect(bump).toMatch(/ERROR: pyproject.toml version is not \$NEW_VERSION/);
    expect(bump).toMatch(/ERROR: worker pyproject.toml version is missing/);
    expect(bump).toMatch(/ERROR: worker pyproject.toml version is not \$NEW_VERSION/);
    expect(bump).toMatch(/ERROR: worker __init__\.py __version__ is missing/);
    expect(bump).toMatch(/ERROR: worker __init__\.py __version__ is not \$NEW_VERSION/);
    expect(bump).toMatch(/ERROR: trendradar __init__\.py __version__ is missing/);
    expect(bump).toMatch(/ERROR: trendradar __init__\.py __version__ is not \$NEW_VERSION/);
    expect(bump).toMatch(/ERROR: package.json version is missing/);
    expect(bump).toMatch(/ERROR: package.json version is not \$NEW_VERSION/);
    expect(bump).toMatch(/ERROR: apps\/api\/package.json version is missing/);
    expect(bump).toMatch(/ERROR: apps\/api\/package.json version is not \$NEW_VERSION/);
    expect(bump).toMatch(/ERROR: apps\/web\/package.json version is missing/);
    expect(bump).toMatch(/ERROR: apps\/web\/package.json version is not \$NEW_VERSION/);
    expect(bump).toMatch(/ERROR: packages\/shared\/package.json version is missing/);
    expect(bump).toMatch(/ERROR: packages\/shared\/package.json version is not \$NEW_VERSION/);
    expect(bump).toMatch(/ERROR: packages\/convex\/package.json version is missing/);
    expect(bump).toMatch(/ERROR: packages\/convex\/package.json version is not \$NEW_VERSION/);
    expect(bump).toMatch(/ERROR: apps\/browser-extension\/package.json version is missing/);
    expect(bump).toMatch(/ERROR: apps\/browser-extension\/package.json version is not \$NEW_VERSION/);
  });
});
