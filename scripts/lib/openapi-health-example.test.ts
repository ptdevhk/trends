import { describe, expect, it } from "vitest";

import {
  apiTypesSemverExample,
  configTsVersion,
  healthExampleFromOpenApiJson,
  healthExampleFromOpenApiYaml,
  infoVersionFromOpenApiJson,
  infoVersionFromOpenApiYaml,
  e2eQuotedVersion,
  packageJsonVersion,
} from "./openapi-health-example.ts";

const YAML_MATCH = `components:
  schemas:
    HealthResponse:
      properties:
        version:
          type: string
          example: '0.4.23'
`;

const JSON_MATCH = JSON.stringify({
  components: {
    schemas: {
      HealthResponse: {
        properties: { version: { type: "string", example: "0.4.23" } },
      },
    },
  },
});

describe("healthExampleFromOpenApiYaml", () => {
  it("reads a HealthResponse example", () => {
    expect(healthExampleFromOpenApiYaml(YAML_MATCH)).toBe("0.4.23");
  });

  it("returns null when the example is missing", () => {
    expect(healthExampleFromOpenApiYaml("openapi: 3.1.0\ninfo:\n  version: 0.4.23\n")).toBeNull();
  });
});

describe("healthExampleFromOpenApiJson", () => {
  it("reads a HealthResponse example", () => {
    expect(healthExampleFromOpenApiJson(JSON_MATCH)).toBe("0.4.23");
  });

  it("returns null when HealthResponse.version.example is missing", () => {
    expect(healthExampleFromOpenApiJson(JSON.stringify({ info: { version: "0.4.23" } }))).toBeNull();
  });

  it("returns null when the example is not a semver string", () => {
    const staleShape = JSON.stringify({
      components: {
        schemas: {
          HealthResponse: { properties: { version: { example: 0.4 } } },
        },
      },
    });
    expect(healthExampleFromOpenApiJson(staleShape)).toBeNull();
  });

  it("returns null for unreadable JSON", () => {
    expect(healthExampleFromOpenApiJson("{")).toBeNull();
  });
});

describe("infoVersionFromOpenApiJson", () => {
  it("reads info.version", () => {
    expect(infoVersionFromOpenApiJson(JSON.stringify({ info: { version: "0.4.23" } }))).toBe("0.4.23");
  });

  it("returns null when info.version is missing", () => {
    expect(infoVersionFromOpenApiJson(JSON.stringify({ openapi: "3.1.0" }))).toBeNull();
  });

  it("returns null when info.version is not a semver string", () => {
    expect(infoVersionFromOpenApiJson(JSON.stringify({ info: { version: 0.4 } }))).toBeNull();
  });
});

describe("infoVersionFromOpenApiYaml", () => {
  it("reads info.version and ignores nested operation versions", () => {
    const text = `info:\n  version: 0.4.23\npaths:\n  x:\n    version: 9.9.9\n`;
    expect(infoVersionFromOpenApiYaml(text)).toBe("0.4.23");
  });

  it("returns null when info.version is missing", () => {
    expect(infoVersionFromOpenApiYaml("openapi: 3.1.0\ninfo:\n  title: Trends API\n")).toBeNull();
  });
});

describe("apiTypesSemverExample", () => {
  it("reads the first semver @example", () => {
    expect(apiTypesSemverExample("/** @example healthy */\n/** @example 0.4.23 */\n")).toBe("0.4.23");
  });

  it("returns null when no semver @example is present", () => {
    expect(apiTypesSemverExample("/** @example healthy */\nversion?: string;\n")).toBeNull();
  });
});

describe("configTsVersion", () => {
  it("reads the config version prop", () => {
    expect(configTsVersion('export const config = {\n  version: "0.4.23",\n};\n')).toBe("0.4.23");
  });

  it("returns null when the version prop is missing", () => {
    expect(configTsVersion("export const config = {\n  timezone: \"UTC\",\n};\n")).toBeNull();
  });

  it("returns null when the version is not a semver string", () => {
    expect(configTsVersion('export const config = {\n  version: "next",\n};\n')).toBeNull();
  });
});

describe("packageJsonVersion", () => {
  it("reads the package version", () => {
    expect(packageJsonVersion('{\n  "name": "@trends/api",\n  "version": "0.4.23"\n}\n')).toBe(
      "0.4.23",
    );
  });

  it("returns null when version is missing", () => {
    expect(packageJsonVersion('{\n  "name": "@trends/api"\n}\n')).toBeNull();
  });

  it("returns null when version is not a semver string", () => {
    expect(packageJsonVersion('{\n  "version": "next"\n}\n')).toBeNull();
  });

  it("returns null for unreadable JSON", () => {
    expect(packageJsonVersion("{")).toBeNull();
  });
});

describe("e2eQuotedVersion", () => {
  const snippet = `            appVersion: '0.4.23',\n            apiVersion: '0.4.23',\n            webVersion: '0.4.23',\n`;

  it("reads each e2e quoted version key", () => {
    expect(e2eQuotedVersion(snippet, "appVersion")).toBe("0.4.23");
    expect(e2eQuotedVersion(snippet, "apiVersion")).toBe("0.4.23");
    expect(e2eQuotedVersion(snippet, "webVersion")).toBe("0.4.23");
  });

  it("returns null when the key is missing", () => {
    expect(e2eQuotedVersion("            apiVersion: '0.4.23',\n", "appVersion")).toBeNull();
  });

  it("returns null when the value is not a semver string", () => {
    expect(e2eQuotedVersion("            appVersion: 'next',\n", "appVersion")).toBeNull();
  });
});
