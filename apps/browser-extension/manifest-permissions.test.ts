/// <reference types="node" />

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const manifestPath = path.join(process.cwd(), "apps/browser-extension/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
};

describe("browser extension manifest server permissions", () => {
  it("grants built-in access to both production and preview Trends hosts", () => {
    expect(manifest.host_permissions).toEqual(
      expect.arrayContaining([
        "*://trends.pt-mes.com/*",
        "*://preview.pt-mes.com/*",
      ]),
    );
  });

  it("declares optional host permissions for ad-hoc HTTPS servers", () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining(["permissions"]));
    expect(manifest.optional_host_permissions).toEqual(
      expect.arrayContaining([
        "https://*/*",
        "http://localhost/*",
        "http://127.0.0.1/*",
      ]),
    );
  });
});
